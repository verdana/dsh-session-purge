/**
 * Client-half regression tests for the recycle bin (milestone M2).
 *
 * The browser bundle is a `window.__ModuleLoader__.load({...})` module, so it is
 * evaluated the way the browser evaluates it and its `__test` surface is driven
 * directly. No DOM and no server are involved: these cases cover the pure
 * helpers (anchor choice, formatting, expiry) and the store flows behind the
 * panel (load, restore, purge, empty) against a stubbed `fetch`.
 *
 * The DOM-facing half — that the icon really lands in the workspace row and the
 * panel really renders — is covered by tools/trash-panel-probe.mjs (real React +
 * real theme CSS) and by the isolated-instance probe.
 *
 * Run: node --test tools/*.test.mjs   (or: npm test)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const clientSrc = readFileSync(fileURLToPath(new URL('../client/client.js', import.meta.url)), 'utf8');

/** Resolve any plugin dependency to a minimal stub — no component is rendered here. */
function stubRequire(name) {
    void name;
    return {
        createElement: () => null,
        useState: () => [null, () => {}],
        useEffect: () => {},
        createRoot: () => ({ render: () => {}, unmount: () => {} })
    };
}

let clientModule = null;
new Function('window', 'require', clientSrc)(
    { __ModuleLoader__: { load: (entry) => { clientModule = entry.factory(stubRequire); } } },
    stubRequire,
);
const BIN = clientModule.__test;

/** The module-level store, reset to a known state before each case. */
function resetStore() {
    BIN.binStore.set({
        open: false,
        phase: 'idle',
        entries: [],
        totalBytes: 0,
        settings: null,
        sweep: null,
        notice: null,
        error: null,
        visible: 50,
        busyId: null,
        rowErrors: {},
        confirm: null,
    });
}

/** Install one stub `fetch`; returns the recorded requests. */
function stubFetch(replies) {
    const calls = [];
    globalThis.fetch = async (path, init) => {
        calls.push({ path, init });
        const reply = replies[path] ?? replies.default ?? { status: 200, body: { ok: true } };
        const body = typeof reply === 'function' ? reply(path, init) : reply;
        return {
            status: body.status,
            json: async () => body.body,
        };
    };
    return calls;
}

/** The client half wires `sessionsService` in apply(); run it with stubs. */
const refreshCalls = [];
clientModule.apply({
    sessions: {
        list: { getSnapshot: () => ({ ids: [], byId: {} }) },
        refresh: () => { refreshCalls.push(true); return Promise.resolve(); },
    },
    get: () => undefined,
    effect: (body) => body(),
});

// ── anchor choice ──────────────────────────────────────────────────────────

test('pickTrashAnchor prefers add-workspace, then view options, and skips hidden twins', () => {
    // The wide sidebar renders add-workspace; the rail renders a hidden twin.
    assert.equal(BIN.pickTrashAnchor([
        { index: 3, label: '添加工作区', visible: false, inMenu: false },
        { index: 7, label: '添加工作区', visible: true, inMenu: false },
    ]), 7);
    // No add-workspace (composition without a directory-flow occupant): fall
    // back to the view-options icon, which the collector already ordered second.
    assert.equal(BIN.pickTrashAnchor([
        { index: 4, label: '视图选项', visible: true, inMenu: false },
    ]), 4);
    // A same-labelled button inside an open menu is never the anchor.
    assert.equal(BIN.pickTrashAnchor([
        { index: 9, label: '添加工作区', visible: true, inMenu: true },
    ]), -1);
    assert.equal(BIN.pickTrashAnchor([]), -1);
});

test('collectTrashAnchorCandidates keeps the documented priority order', () => {
    const buttons = [
        { getAttribute: (name) => (name === 'aria-label' ? '搜索会话' : null), getClientRects: () => [1], closest: () => null },
        { getAttribute: (name) => (name === 'aria-label' ? '视图选项' : null), getClientRects: () => [1], closest: () => null },
        { getAttribute: (name) => (name === 'aria-label' ? '添加工作区' : null), getClientRects: () => [1], closest: () => null },
    ];
    const candidates = BIN.collectTrashAnchorCandidates(buttons);
    assert.deepEqual(candidates.map((candidate) => candidate.label), ['添加工作区', '视图选项']);
    assert.deepEqual(candidates.map((candidate) => candidate.index), [2, 1]);
    // English labels are collected the same way.
    const english = BIN.collectTrashAnchorCandidates([
        { getAttribute: () => 'Add workspace', getClientRects: () => [1], closest: () => null },
    ]);
    assert.equal(english.length, 1);
    assert.equal(english[0].index, 0);
});

// ── entry placement ───────────────────────────────────────────────────────

test('placementOf follows the closed set and defaults to the icon shape', () => {
    assert.equal(BIN.placementOf({ entryPlacement: 'menu' }), 'menu');
    assert.equal(BIN.placementOf({ entryPlacement: 'icon' }), 'icon');
    // Anything the host might hand us that is not the menu value keeps the
    // shipped shape, so a hand-edited settings file cannot blank the entry.
    assert.equal(BIN.placementOf({ entryPlacement: 'sidebar' }), 'icon');
    assert.equal(BIN.placementOf({}), 'icon');
    assert.equal(BIN.placementOf(null), 'icon');
    assert.equal(BIN.placementOf(undefined), 'icon');
});

test('entryInstallDecision waits while loading, never strands the entry', () => {
    // 请求还在路上：先不装，免得菜单用户刷新时闪一下图标。
    assert.equal(BIN.entryInstallDecision({ phase: 'idle', settings: null }), null);
    assert.equal(BIN.entryInstallDecision({ phase: 'loading', settings: null }), null);
    // 读到 menu 就装菜单，读到 icon/未知值就装图标。
    assert.equal(BIN.entryInstallDecision({ phase: 'ready', settings: { entryPlacement: 'menu' } }), 'menu');
    assert.equal(BIN.entryInstallDecision({ phase: 'ready', settings: {} }), 'icon');
    // 失败时按默认图标装，而不是"再等等"。
    assert.equal(BIN.entryInstallDecision({ phase: 'failed', settings: null }), 'icon');
    // 成功但载荷里没有 settings（异常宿主/被改坏的响应）：同样要装一个出来，
    // 否则侧栏会彻底没有回收站入口。
    assert.equal(BIN.entryInstallDecision({ phase: 'ready', settings: null }), 'icon');
    assert.equal(BIN.entryInstallDecision(null), 'icon');
});

test('a failed main registration rolls back the sidebar row', () => {
    // 只注册到行、页面失败是最坏的一种半吊子状态：点击行会让 shell 抛错。
    const disposals = [];
    clientModule.__testMountLocale({
        get: () => undefined,
        inject: (names, cb) => cb({
            slots: {
                inject: (key, factory) => factory(),
                register: (options) => {
                    if (options.name === 'main') throw new Error('layout is not here');
                    return () => disposals.push(options.name);
                },
            },
        }),
    });
    const dispose = BIN.installMenuEntry();
    assert.equal(typeof dispose, 'function');
    assert.deepEqual(disposals, ['sidebar.panellist']);
    dispose(); // 幂等：失败的安装不重复撤销
    assert.deepEqual(disposals, ['sidebar.panellist']);
    clientModule.__testMountLocale({ get: () => undefined });
});

test('a cancelled menu install undoes a late registration', () => {
    // slots 可能在 teardown 之后才就绪：迟到的注册必须自我撤销，不能在图标
    // 形态下再冒出一行。
    let late = null;
    const disposals = [];
    clientModule.__testMountLocale({
        get: () => undefined,
        inject: (names, cb) => { late = cb; },
    });
    const dispose = BIN.installMenuEntry();
    dispose();
    late({
        slots: {
            inject: (key, factory) => factory(),
            register: (options) => () => disposals.push(options.name),
        },
    });
    assert.deepEqual(disposals.sort(), ['main', 'sidebar.panellist']);
    clientModule.__testMountLocale({ get: () => undefined });
});

test('iconMarkup keeps the glyph geometry at the size the panel row asks for', () => {
    // The row passes 16 while wide and 18 in the collapsed rail (same as the
    // shipped global-panel glyphs).
    assert.match(BIN.iconMarkup(16), /^<svg width="16" height="16"/);
    assert.match(BIN.iconMarkup(18), /^<svg width="18" height="18"/);
    assert.match(BIN.iconMarkup(undefined), /^<svg width="16" height="16"/);
    // The page id is shared by the panel row and the `main` key; a mismatch makes
    // layout.selectPanel throw, so it is pinned here.
    assert.equal(BIN.TRASH_PANEL_ID, 'session-purge-trash');
});

// ── settings-entry launchers ───────────────────────────────────────────────

/** One fake launcher button for the DOM-free trigger lookup. */
function fakeLauncher(label, visible, inMenu) {
    return {
        getAttribute: (name) => (name === 'aria-label' ? label : null),
        getClientRects: () => (visible ? [1] : []),
        closest: () => (inMenu ? {} : null),
    };
}

test('pickSettingsMenuItem presses only an exact Settings row', () => {
    assert.equal(BIN.pickSettingsMenuItem(['回收站', '设置', '意见反馈']), 1);
    assert.equal(BIN.pickSettingsMenuItem(['Recycle bin', 'Settings']), 1);
    // A different row that merely starts with 设置 must never be pressed.
    assert.equal(BIN.pickSettingsMenuItem(['设置工作区', '回收站']), -1);
    assert.equal(BIN.pickSettingsMenuItem([]), -1);
    assert.equal(BIN.pickSettingsMenuItem(null), -1);
    assert.equal(typeof BIN.openSettingsViaAccountMenu, 'function');
});

test('findLabeledTrigger resolves both launcher generations and skips menu rows', () => {
    const accountHidden = fakeLauncher('账号菜单', false, false);
    const accountInMenu = fakeLauncher('账号菜单', true, true);
    const accountVisible = fakeLauncher('账号菜单', true, false);
    const directSettings = fakeLauncher('设置', true, false);
    const previous = globalThis.document;
    try {
        // 0.2.1: the account menu is the launcher; Settings is a row, not a button.
        globalThis.document = {
            querySelectorAll: () => [accountHidden, accountInMenu, accountVisible, directSettings],
        };
        assert.equal(BIN.findAccountMenuTrigger(), accountVisible);
        assert.equal(BIN.findSettingsTrigger(), directSettings);
        // ≤ 0.2.0: the direct Settings button wins and no account menu exists.
        globalThis.document = { querySelectorAll: () => [directSettings] };
        assert.equal(BIN.findSettingsTrigger(), directSettings);
        assert.equal(BIN.findAccountMenuTrigger(), null);
        // English labels resolve the same way.
        globalThis.document = { querySelectorAll: () => [fakeLauncher('Account menu', true, false)] };
        assert.equal(BIN.findAccountMenuTrigger().getAttribute('aria-label'), 'Account menu');
        // No document at all degrades to no launcher.
        delete globalThis.document;
        assert.equal(BIN.findSettingsTrigger(), null);
        assert.equal(BIN.findAccountMenuTrigger(), null);
    }
    finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
});

// ── formatting ─────────────────────────────────────────────────────────────

test('formatBytes renders bytes, kilobytes and megabytes', () => {
    assert.equal(BIN.formatBytes(0), '0 B');
    assert.equal(BIN.formatBytes(undefined), '0 B');
    assert.equal(BIN.formatBytes(-4), '0 B');
    assert.equal(BIN.formatBytes(512), '512 B');
    assert.equal(BIN.formatBytes(2048), '2 KB');
    assert.equal(BIN.formatBytes(1024 * 1024 * 12.4), '12.4 MB');
    assert.equal(BIN.formatBytes(1024 * 1024 * 128.3), '128.3 MB');
    assert.equal(BIN.formatBytes(1024 * 1024 * 1024 * 3), '3 GB');
});

test('formatRelativeTime follows the active locale', () => {
    const now = Date.UTC(2026, 9, 14, 12, 0, 0);
    const at = (ms) => new Date(now - ms).toISOString();
    clientModule.__testMountLocale({ get: () => undefined });
    assert.equal(BIN.formatRelativeTime(at(5_000), now), '刚刚');
    assert.equal(BIN.formatRelativeTime(at(5 * 60_000), now), '5 分钟前');
    assert.equal(BIN.formatRelativeTime(at(3 * 3_600_000), now), '3 小时前');
    assert.equal(BIN.formatRelativeTime(at(3 * 86_400_000), now), '3 天前');
    assert.equal(BIN.formatRelativeTime('not-a-date', now), '');

    clientModule.__testMountLocale({ get: (name) => (name === 'locale' ? { getLocale: () => ({ active: 'en' }) } : undefined) });
    assert.equal(BIN.formatRelativeTime(at(5 * 60_000), now), '5 min ago');
    assert.equal(BIN.formatRelativeTime(at(2 * 86_400_000), now), '2 days ago');
    clientModule.__testMountLocale({ get: () => undefined });
});

test('displayTitle and shortSessionId never render an empty row', () => {
    assert.equal(BIN.displayTitle({ title: '重构回收站' }), '重构回收站');
    assert.equal(BIN.displayTitle({ title: '   ' }), '未命名会话');
    assert.equal(BIN.displayTitle({ title: null }), '未命名会话');
    assert.equal(BIN.displayTitle(undefined), '未命名会话');
    assert.equal(BIN.shortSessionId('session-a22fa2ed-d0aa-4797-b4c6-38a90d65f2e6'), 'session-a22fa2ed…');
    assert.equal(BIN.shortSessionId('short'), 'short');
    assert.equal(BIN.shortSessionId(undefined), '');
});

test('isExpiringEntry follows the live policy, not a stored flag', () => {
    resetStore();
    const old = { id: 'a', deletedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() };
    const fresh = { id: 'b', deletedAt: new Date().toISOString() };
    // Unknown settings: nothing is announced as expiring.
    assert.equal(BIN.isExpiringEntry(old), false);
    BIN.binStore.set({ settings: { autoClean: true, retentionDays: 30 } });
    assert.equal(BIN.isExpiringEntry(old), true);
    assert.equal(BIN.isExpiringEntry(fresh), false);
    // Auto-clean off, or "keep forever": no expiry is promised.
    BIN.binStore.set({ settings: { autoClean: false, retentionDays: 30 } });
    assert.equal(BIN.isExpiringEntry(old), false);
    BIN.binStore.set({ settings: { autoClean: true, retentionDays: 0 } });
    assert.equal(BIN.isExpiringEntry(old), false);
});

// ── store flows ────────────────────────────────────────────────────────────

test('refreshBin loads entries, totals and the policy', async () => {
    resetStore();
    const calls = stubFetch({
        '/session-purge/trash': {
            status: 200,
            body: {
                ok: true,
                entries: [{ id: 'session-a', title: 'A', deletedAt: new Date().toISOString(), sizeBytes: 2048 }],
                totalBytes: 2048,
                settings: { autoClean: true, retentionDays: 30 },
                sweep: { lastSweepAt: 1000, lastSweepRemoved: 0 },
            },
        },
    });
    await BIN.refreshBin();
    const state = BIN.binStore.get();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/session-purge/trash');
    assert.equal(state.phase, 'ready');
    assert.equal(state.entries.length, 1);
    assert.equal(state.totalBytes, 2048);
    assert.equal(state.settings.retentionDays, 30);
});

test('refreshBin that fails keeps the panel usable and reports it', async () => {
    resetStore();
    stubFetch({ '/session-purge/trash': { status: 503, body: { ok: false, code: 'storage' } } });
    await BIN.refreshBin();
    assert.equal(BIN.binStore.get().phase, 'failed');
    assert.equal(BIN.binStore.get().error, '读取回收站失败');
});

test('a later sweep is reported once, not treated as a silent change', async () => {
    resetStore();
    BIN.binStore.set({ sweep: { lastSweepAt: 1000, lastSweepRemoved: 0 } });
    stubFetch({
        '/session-purge/trash': {
            status: 200,
            body: {
                ok: true,
                entries: [],
                totalBytes: 0,
                settings: { autoClean: true, retentionDays: 30 },
                sweep: { lastSweepAt: 2000, lastSweepRemoved: 2 },
            },
        },
    });
    await BIN.refreshBin();
    assert.equal(BIN.binStore.get().notice, '已自动清理 2 个过期会话');
});

test('open and close toggle the panel and clear a pending confirm', () => {
    resetStore();
    stubFetch({ '/session-purge/trash': { status: 200, body: { ok: true, entries: [], totalBytes: 0, settings: null, sweep: null } } });
    BIN.openTrashPanel();
    assert.equal(BIN.binStore.get().open, true);
    BIN.binStore.set({ confirm: { kind: 'empty', count: 3, size: '1.0 KB', busy: false, error: null } });
    BIN.closeTrashPanel();
    assert.equal(BIN.binStore.get().open, false);
    assert.equal(BIN.binStore.get().confirm, null);
});

test('restoring an entry drops the row, re-baselines sessions and reports by toast', async () => {
    resetStore();
    refreshCalls.length = 0;
    const entry = { id: 'session-a', title: 'A', deletedAt: new Date().toISOString(), sizeBytes: 10 };
    BIN.binStore.set({ open: true, phase: 'ready', entries: [entry] });
    stubFetch({
        '/session-purge/restore': { status: 200, body: { ok: true, restoredTo: '/x', wasArchived: false, cwdMissing: false } },
    });
    await BIN.restoreBinEntry(entry);
    const state = BIN.binStore.get();
    assert.deepEqual(state.entries, []);
    assert.equal(state.busyId, null);
    // The toast is the only report for a restore: the row is already gone from
    // the panel, so the panel must not repeat the same sentence underneath it.
    assert.equal(state.notice, null);
    assert.equal(refreshCalls.length, 1, 'the session list must be re-baselined');
});

test('the restore toast text names the session and carries the missing-folder caveat', () => {
    // Same copy the panel used to render inline, now carried by the banner.
    assert.equal(BIN.restoreNoticeText({ cwdMissing: false }, { id: 's', title: 'A' }, true), '已复原「A」');
    const missing = BIN.restoreNoticeText({ cwdMissing: true }, { id: 's', title: null }, true);
    assert.equal(missing.includes('已复原「未命名会话」'), true, missing);
    assert.equal(missing.includes('原始目录已不存在'), true, missing);
    // A failed re-baseline replaces the whole sentence: the session is back on
    // disk but the sidebar cannot show it until the page reloads.
    assert.equal(
        BIN.restoreNoticeText({ cwdMissing: false }, { id: 's', title: 'A' }, null),
        '已复原，刷新页面（Ctrl+Shift+R）后可见');
});

test('a refused restore keeps the row and shows the row-level reason', async () => {
    resetStore();
    const entry = { id: 'session-c', title: 'C', deletedAt: new Date().toISOString() };
    BIN.binStore.set({ open: true, entries: [entry] });
    stubFetch({ '/session-purge/restore': { status: 409, body: { ok: false, code: 'conflict' } } });
    await BIN.restoreBinEntry(entry);
    const state = BIN.binStore.get();
    assert.equal(state.entries.length, 1, 'the entry must survive a refusal');
    assert.equal(state.rowErrors['session-c'], '该会话已存在，无法复原');
});

test('permanent delete asks first, then removes exactly that entry', async () => {
    resetStore();
    const kept = { id: 'session-keep', title: 'keep', deletedAt: new Date().toISOString() };
    const doomed = { id: 'session-doomed', title: 'doomed', deletedAt: new Date().toISOString() };
    BIN.binStore.set({ open: true, entries: [kept, doomed] });

    // Asking does not delete anything: it stages the confirmation only.
    BIN.requestBinPurge(doomed);
    assert.deepEqual(BIN.binStore.get().confirm, {
        kind: 'purge', id: 'session-doomed', name: 'doomed', busy: false, error: null,
    });
    assert.equal(BIN.binStore.get().entries.length, 2);

    // Cancelling leaves the bin untouched.
    BIN.cancelBinConfirm();
    assert.equal(BIN.binStore.get().confirm, null);
    assert.equal(BIN.binStore.get().entries.length, 2);

    // Confirming deletes exactly the staged entry.
    const calls = stubFetch({ '/session-purge/purge': { status: 200, body: { ok: true, freedBytes: 10 } } });
    BIN.requestBinPurge(doomed);
    await BIN.confirmBinAction();
    assert.equal(calls[0].path, '/session-purge/purge');
    assert.equal(JSON.parse(calls[0].init.body).sessionId, 'session-doomed');
    assert.deepEqual(BIN.binStore.get().entries.map((entry) => entry.id), ['session-keep']);
    assert.equal(BIN.binStore.get().confirm, null);
});

test('a refused permanent delete keeps the confirmation open with the reason', async () => {
    resetStore();
    const entry = { id: 'session-locked', title: 'locked', deletedAt: new Date().toISOString() };
    BIN.binStore.set({ open: true, entries: [entry] });
    BIN.requestBinPurge(entry);
    stubFetch({ '/session-purge/purge': { status: 503, body: { ok: false, code: 'rm' } } });
    await BIN.confirmBinAction();
    const confirm = BIN.binStore.get().confirm;
    assert.equal(confirm.busy, false);
    assert.equal(confirm.error, '文件操作失败（文件可能被占用，请稍后重试）');
    assert.equal(BIN.binStore.get().entries.length, 1);
});

test('emptying the bin clears the list once confirmed', async () => {
    resetStore();
    BIN.binStore.set({
        open: true,
        entries: [{ id: 'session-a', deletedAt: new Date().toISOString(), sizeBytes: 5 }],
        totalBytes: 5,
    });
    BIN.requestBinEmpty();
    assert.equal(BIN.binStore.get().confirm.kind, 'empty');
    assert.equal(BIN.binStore.get().confirm.count, 1);
    assert.equal(BIN.binStore.get().confirm.size, '5 B');

    const calls = stubFetch({ '/session-purge/empty': { status: 200, body: { ok: true, removed: 1, freedBytes: 5, failed: [] } } });
    await BIN.confirmBinAction();
    assert.equal(JSON.parse(calls[0].init.body).confirm, true);
    assert.deepEqual(BIN.binStore.get().entries, []);
    assert.equal(BIN.binStore.get().totalBytes, 0);
    assert.equal(BIN.binStore.get().confirm, null);
});

test('a partly failed "empty" keeps the rows it could not remove', async () => {
    resetStore();
    const now = new Date().toISOString();
    BIN.binStore.set({
        open: true,
        entries: [
            { id: 'session-a', trashId: 't-1', deletedAt: now, sizeBytes: 5 },
            { id: 'session-b', trashId: 't-2', deletedAt: now, sizeBytes: 7 },
        ],
        totalBytes: 12,
    });
    BIN.requestBinEmpty();
    // The host processed the batch but reports one entry it could not purge
    // (a hand-edited payload escaping the bin is the real-world case).
    stubFetch({
        '/session-purge/empty': {
            status: 200,
            body: { ok: true, removed: 1, freedBytes: 5, failed: [{ trashId: 't-2', code: 'unsupported' }] },
        },
    });
    await BIN.confirmBinAction();

    const state = BIN.binStore.get();
    assert.deepEqual(state.entries.map((entry) => entry.id), ['session-b'],
        'the failed entry must stay visible');
    assert.equal(state.totalBytes, 7, 'the footer stops counting what was reclaimed');
    assert.equal(state.confirm, null);
    assert.equal(state.notice, '有 1 个会话未能删除，已保留在列表中');
    assert.equal(state.rowErrors['session-b'], '存储后端不支持该操作，或无法确认会话目录');
});

test('the policy line follows the host settings, and hides when they are unknown', () => {
    resetStore();
    assert.equal(BIN.binPolicyText(), null);
    BIN.binStore.set({ settings: { autoClean: true, retentionDays: 90 } });
    assert.equal(BIN.binPolicyText(), '自动清理：保留 90 天');
    BIN.binStore.set({ settings: { autoClean: false, retentionDays: 90 } });
    assert.equal(BIN.binPolicyText(), '自动清理：已关闭');
    BIN.binStore.set({ settings: { autoClean: true, retentionDays: 0 } });
    assert.equal(BIN.binPolicyText(), '自动清理：已关闭');
    resetStore();
});

// ── the settings page (M3) ─────────────────────────────────────────────────

/** The settings page's own store, reset to a known state. */
function resetSettings() {
    BIN.settingsStore.set({
        phase: 'idle', settings: null, stats: null, version: null, update: null,
        saving: null, error: null, notice: null,
    });
}

test('the retention picker offers exactly the host-accepted choices', () => {
    const options = BIN.retentionOptions();
    assert.deepEqual(options.map((option) => option.value), ['7', '30', '90', '365', '0']);
    assert.deepEqual(options.map((option) => option.label), ['7 天', '30 天', '90 天', '365 天', '永久']);
    assert.equal(BIN.retentionLabel(0), '永久');
    assert.equal(BIN.retentionLabel(90), '90 天');
});

test('the stats line says "never" until the host has swept once', () => {
    assert.equal(BIN.lastSweepText(null), '从未');
    assert.equal(BIN.lastSweepText({}), '从未');
    const twoHoursAgo = Date.now() - 2 * 3_600_000;
    assert.equal(BIN.lastSweepText({ lastSweepAt: twoHoursAgo }), '2 小时前');
});

test('pickLabeledButton ignores hidden twins and menu entries', () => {
    const candidates = [
        { index: 2, label: '设置', visible: false, inMenu: false },
        { index: 5, label: '设置', visible: true, inMenu: true },
        { index: 8, label: '设置', visible: true, inMenu: false },
        { index: 9, label: 'Settings', visible: true, inMenu: false },
    ];
    assert.equal(BIN.pickLabeledButton(candidates, ['设置', 'Settings']), 8);
    // English shells resolve through the same list.
    assert.equal(BIN.pickLabeledButton([candidates[3]], ['设置', 'Settings']), 9);
    assert.equal(BIN.pickLabeledButton([], ['设置']), -1);
    assert.equal(BIN.pickLabeledButton(candidates, ['Nope']), -1);
});

test('opening settings from the bin presses the shell launcher', () => {
    resetStore();
    // No DOM in this runner, so the pure pickers are exercised above and the
    // degradation path here: a missing launcher becomes a hint, never a dead click.
    BIN.openSettingsFromBin();
    assert.equal(BIN.binStore.get().notice, '打开左下角账号菜单 → 设置 → 回收站');
    assert.equal(BIN.binStore.get().open, false, 'the panel must not close on a failed jump');
});

test('refreshSettings loads the policy, the stats and the bin policy line', async () => {
    resetSettings();
    resetStore();
    const calls = stubFetch({
        '/session-purge/settings': {
            status: 200,
            body: {
                ok: true,
                version: '0.5.2',
                settings: { schema: 1, autoClean: false, retentionDays: 7, sweepOnBoot: true, sweepIntervalHours: 12 },
                stats: { count: 3, totalBytes: 2048, lastSweepAt: 1000, lastSweepRemoved: 1 },
            },
        },
    });
    await BIN.refreshSettings();
    const state = BIN.settingsStore.get();
    assert.equal(calls[0].path, '/session-purge/settings');
    assert.equal(state.phase, 'ready');
    assert.equal(state.version, '0.5.2', 'the footer shows the host-reported version');
    assert.equal(state.settings.retentionDays, 7);
    assert.equal(state.stats.count, 3);
    // The bin panel's footer reads the same policy.
    assert.equal(BIN.binStore.get().settings.retentionDays, 7);
    assert.equal(BIN.binPolicyText(), '自动清理：已关闭');
});

test('a failed settings read still adopts the version in its error body', async () => {
    resetSettings();
    stubFetch({
        '/session-purge/settings': {
            status: 503,
            body: { ok: false, version: '0.5.2', code: 'storage' },
        },
    });
    await BIN.refreshSettings();
    assert.equal(BIN.settingsStore.get().phase, 'failed');
    assert.equal(BIN.settingsStore.get().version, '0.5.2');
});

test('update hints need a real semver answer, and only a newer one shows', () => {
    assert.equal(BIN.compareVersions('0.5.2', '0.5.2'), 0);
    assert.equal(BIN.compareVersions('0.5.3', '0.5.2'), 1);
    assert.equal(BIN.compareVersions('0.5.2', '0.5.3'), -1);
    assert.equal(BIN.compareVersions('0.6.0', '0.5.99'), 1);
    assert.equal(BIN.compareVersions('v1.0.0', '0.9.9'), 1);
    assert.equal(BIN.compareVersions('1.0.0-beta.1', '1.0.0'), -1);
    assert.equal(BIN.compareVersions('1.0.0', '1.0.0-beta.1'), 1);
    assert.equal(BIN.compareVersions('garbage', '1.0.0'), null);
    assert.equal(BIN.compareVersions('1.0.0', null), null);
});

test('the npm update check stays offline in a DOM-free runner', () => {
    resetSettings();
    BIN.settingsStore.set({ version: '0.5.2' });
    const calls = stubFetch({});
    BIN.maybeCheckForUpdate();
    assert.equal(calls.length, 0);
    assert.equal(BIN.settingsStore.get().update, null);
});

test('markSettingsNavIcon marks only our localized row inside a nav', () => {
    const makeRow = (text) => {
        const values = new Map();
        return {
            textContent: text,
            getAttribute: (name) => values.has(name) ? values.get(name) : null,
            setAttribute: (name, value) => { values.set(name, value); },
            removeAttribute: (name) => { values.delete(name); },
        };
    };
    const other = makeRow('通用');
    const ours = makeRow(' 回收站 ');
    const fakeDocument = {
        querySelectorAll: (selector) => {
            assert.equal(selector, '[role="dialog"] nav button');
            return [other, ours];
        },
    };
    globalThis.document = fakeDocument;
    try {
        BIN.markSettingsNavIcon();
    } finally {
        delete globalThis.document;
    }
    assert.equal(ours.getAttribute('data-sd-settings-nav'), 'trash');
    assert.equal(other.getAttribute('data-sd-settings-nav'), null);
});

test('a newer registry version turns into the footer hint', async () => {
    resetSettings();
    BIN.settingsStore.set({ version: '0.5.2' });
    globalThis.document = {};
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '0.6.0' }) });
    try {
        BIN.maybeCheckForUpdate();
        await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
        delete globalThis.document;
    }
    assert.deepEqual(BIN.settingsStore.get().update, { latest: '0.6.0', newer: true, same: false });
});

test('a failed settings read reports it without losing the page', async () => {
    resetSettings();
    stubFetch({ '/session-purge/settings': { status: 503, body: { ok: false, code: 'storage' } } });
    await BIN.refreshSettings();
    assert.equal(BIN.settingsStore.get().phase, 'failed');
    assert.equal(BIN.settingsStore.get().error, '暂时读不到回收站设置，请重试');
});

test('saveSetting writes one field and adopts what the host stored', async () => {
    resetSettings();
    resetStore();
    BIN.settingsStore.set({
        phase: 'ready',
        settings: { autoClean: true, retentionDays: 30, sweepOnBoot: true, sweepIntervalHours: 6 },
        stats: { count: 0, totalBytes: 0, lastSweepAt: null },
    });
    const calls = stubFetch({
        '/session-purge/settings': {
            status: 200,
            body: { ok: true, settings: { schema: 1, autoClean: true, retentionDays: 90, sweepOnBoot: true, sweepIntervalHours: 6 } },
        },
    });
    await BIN.saveSetting('retentionDays', 90);
    const patch = JSON.parse(calls[0].init.body);
    assert.deepEqual(patch, { retentionDays: 90 });
    assert.equal(BIN.settingsStore.get().saving, null);
    assert.equal(BIN.settingsStore.get().settings.retentionDays, 90);
    assert.equal(BIN.binStore.get().settings.retentionDays, 90, 'the panel policy must follow');
});

test('a refused write surfaces the error and clears the in-flight lock', async () => {
    resetSettings();
    BIN.settingsStore.set({
        phase: 'ready',
        settings: { autoClean: true, retentionDays: 30, sweepOnBoot: true, sweepIntervalHours: 6 },
        stats: null,
    });
    stubFetch({ '/session-purge/settings': { status: 400, body: { ok: false, code: 'settings-invalid' } } });
    await BIN.saveSetting('sweepIntervalHours', 999);
    const state = BIN.settingsStore.get();
    assert.equal(state.saving, null);
    assert.equal(state.error, '设置保存失败，请重试');
    assert.equal(state.settings.retentionDays, 30, 'the page keeps the last known good values');
});

test('sweeping now reports what was removed, and off says why nothing ran', async () => {
    resetSettings();
    stubFetch({ '/session-purge/sweep': { status: 200, body: { ok: true, removed: 2, failed: [] } } });
    await BIN.runSweepNow();
    assert.equal(BIN.settingsStore.get().notice, '已自动清理 2 个过期会话');

    resetSettings();
    stubFetch({ '/session-purge/sweep': { status: 200, body: { ok: true, removed: 0, failed: [], skipped: 'disabled' } } });
    await BIN.runSweepNow();
    assert.equal(BIN.settingsStore.get().notice, '自动清理：已关闭');
});

test('the settings page registers into the shell domain once, at the documented order', () => {
    const injections = [];
    const registrations = [];
    clientModule.apply({
        sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) }, refresh: () => Promise.resolve() },
        get: () => undefined,
        effect: (body) => body(),
        inject: (deps, callback) => {
            if (!deps.includes('slots')) return;
            callback({
                slots: {
                    inject: (key, register) => { injections.push(key); register(); },
                    register: (options, component) => {
                        registrations.push({ options, component });
                        return () => {};
                    },
                },
            });
        },
    });
    assert.deepEqual(injections, ['settings.section']);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].options.name, 'settings.section');
    assert.equal(registrations[0].options.id, 'session-purge');
    assert.equal(registrations[0].options.order, 50);
    assert.equal(typeof registrations[0].options.label, 'function', 'the label must be re-readable per locale');
    assert.equal(registrations[0].options.label(), '回收站');
    assert.equal(typeof registrations[0].component, 'function');
});

test('a shell without the settings domain leaves the plugin working', () => {
    // No `inject` at all (the oldest shells): apply() must not throw.
    clientModule.apply({
        sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
        get: () => undefined,
        effect: (body) => body(),
    });
    // And a slots service that never declares the section must not break it.
    clientModule.apply({
        sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
        get: () => undefined,
        effect: (body) => body(),
        inject: (deps, callback) => {
            if (deps.includes('slots')) callback({ slots: { inject: () => undefined, register: () => () => {} } });
        },
    });
    assert.equal(typeof BIN.SettingsSection, 'function');
});

// ── move-to-bin outcome → toast ────────────────────────────────────────────

test('a trashed response leaves the dialog to the toast, with the display name', () => {
    // The title the DOM capture found wins; the response's own name is the
    // fallback, and the bare id is the last resort.
    assert.deepEqual(
        BIN.trashOutcome({ ok: true, mode: 'trashed', name: 'Host Name' }, { id: 's1', title: 'Captured' }),
        { kind: 'trashed', name: 'Captured' });
    assert.deepEqual(
        BIN.trashOutcome({ ok: true, mode: 'trashed', name: 'Host Name' }, { id: 's1' }),
        { kind: 'trashed', name: 'Host Name' });
    assert.deepEqual(
        BIN.trashOutcome({ ok: true, mode: 'trashed' }, { id: 's1' }),
        { kind: 'trashed', name: 's1' });
});

test('a queued or refused /trash response keeps the dialog open', () => {
    assert.deepEqual(BIN.trashOutcome({ ok: true, mode: 'queued' }, { id: 's1' }), { kind: 'queued' });
    assert.deepEqual(
        BIN.trashOutcome({ ok: false, code: 'live' }, { id: 's1' }),
        { kind: 'error', code: 'live' });
    // An unparseable body must not be mistaken for success.
    assert.deepEqual(BIN.trashOutcome(null, { id: 's1' }), { kind: 'error', code: 'fallback' });
});

test('the toast copy reuses the dialog keys, and the success-dialog title is gone', () => {
    // The banner text and its action are the exact strings the dialog used to
    // render — the copy survives the redesign, the modal does not.
    assert.equal(BIN.tr('dialog.trash.done', { name: '会话甲' }), '已移入回收站「会话甲」。');
    assert.equal(BIN.tr('dialog.trash.openBin'), '打开回收站');
    // A removed key resolves to itself: this pins the cleanup, so a leftover
    // render of the old success dialog would shout rather than hide.
    assert.equal(BIN.tr('dialog.trash.doneTitle'), 'dialog.trash.doneTitle');
});

// ── panel scrolling (issue #1) ─────────────────────────────────────────────
//
// Rows past the fold must be reachable by scrolling, and the confirm strip and
// footer below the list must stay put. That rests on three things a static read
// can pin: the body being a flex column allowed to shrink, the list having a
// bounded height, and the render actually using the body class. What it cannot
// prove here is the pixel outcome — tools/trash-panel-probe.mjs renders the
// panel against the real theme for that.

/** Read one declaration set out of the CSS block by selector. */
function cssRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = clientSrc.match(new RegExp('"' + escaped + '\\{([^}]*)\\}"'));
    assert.ok(match !== null, `missing a CSS rule for ${selector}`);
    return Object.fromEntries(match[1].split(';').filter(Boolean).map((decl) => {
        const colon = decl.indexOf(':');
        return [decl.slice(0, colon), decl.slice(colon + 1)];
    }));
}

test('the panel body is a shrinkable flex column, not an anonymous block', () => {
    const body = cssRule('.sd-bin-body');
    assert.equal(body.display, 'flex');
    assert.equal(body['flex-direction'], 'column');
    assert.equal(body['flex'], '1 1 auto');
    // The load-bearing one: without it the body refuses to shrink below its
    // content, so nothing ever gets short enough to scroll (issue #1).
    assert.equal(body['min-height'], '0');
    // The class is inert unless the body render actually uses it.
    assert.match(clientSrc, /createElement\("div", \{ className: "sd-bin-body" \}, children\)/);
});

test('the list owns the scrolling, bounded even when the Modal passes no height down', () => {
    const list = cssRule('.sd-bin-list');
    assert.equal(list.overflow, 'auto');
    assert.equal(list['flex'], '1 1 auto');
    assert.equal(list['min-height'], '56px', 'a short list must not collapse');
    // The shell caps its own card but does not necessarily hand that bound to
    // our children, so the list carries its own viewport-relative ceiling.
    assert.equal(list['max-height'], 'calc(100vh - 280px)');
    assert.equal(list['overscroll-behavior'], 'contain');
});
