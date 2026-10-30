/**
 * Render the plugin's REAL recycle-bin panel — real React, the plugin's own
 * stylesheet, the shipped DSH theme tokens — in every state the user can see
 * (empty, list, expiring entry, permanent-delete confirmation) and report the
 * computed colours. This is the exit gate for the panel's own surface: a wrong
 * token, a typo'd class or a state that silently renders nothing fails here,
 * which the static assertions in the unit suites cannot see.
 *
 * The panel prefers the shell's `Modal`/`Tooltip` primitives, which only exist
 * in a running shell; this probe deliberately exercises the BUNDLED fallback
 * (own card + mask), which is exactly what an older shell renders — the live
 * isolated instance covers the primitives path.
 *
 * Needs the DSH source checkout (for React and the theme CSS), not a running
 * server. Set DSH_REPO when the checkout lives elsewhere.
 *
 * Usage: node tools/trash-panel-probe.mjs
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = (process.env.DSH_REPO ?? 'D:/deepseek-harness').replace(/\\/g, '/');
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const require = createRequire(join(repo, 'apps/web/package.json'));
const { chromium } = require('playwright');

const PNPM = join(repo, 'node_modules/.pnpm');
const REACT = join(PNPM, 'react@18.3.1/node_modules/react/umd/react.development.js');
const REACT_DOM = join(PNPM, 'react-dom@18.3.1_react@18.3.1/node_modules/react-dom/umd/react-dom.development.js');
const THEME = join(repo, 'packages/client/ui-theme/src/styles/design-platform.css');

const dir = join(tmpdir(), 'dsh-purge-bin');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
copyFileSync(REACT, join(dir, 'react.js'));
copyFileSync(REACT_DOM, join(dir, 'react-dom.js'));
copyFileSync(join(plugin, 'client/client.js'), join(dir, 'plugin-client.js'));
copyFileSync(THEME, join(dir, 'theme.css'));

const now = Date.now();
const PAYLOAD = {
    ok: true,
    entries: [
        {
            id: 'session-11111111-2222-3333-4444-555555555555',
            title: '重构回收站',
            cwd: 'D:\\deepseek-harness\\dsh-session-purge',
            deletedAt: new Date(now - 3 * 86_400_000).toISOString(),
            sizeBytes: 1024 * 1024 * 12.4,
            wasArchived: false,
            status: 'trashed',
        },
        {
            id: 'session-99999999-8888-7777-6666-555555555555',
            title: null,
            cwd: 'D:\\work\\old-experiment',
            deletedAt: new Date(now - 40 * 86_400_000).toISOString(),
            sizeBytes: 4096,
            wasArchived: false,
            status: 'trashed',
        },
        {
            // A long title is the case the narrow shell card used to ruin.
            id: 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            title: '重构回收站的产品设计与实现细节：会话列表标题在多宽的面板里才不会被挤成一团',
            cwd: 'D:\\deepseek-harness\\dsh-session-purge',
            deletedAt: new Date(now - 6 * 3_600_000).toISOString(),
            sizeBytes: 1024 * 512,
            wasArchived: false,
            status: 'trashed',
        },
    ],
    totalBytes: 1024 * 1024 * 12.4 + 4096 + 1024 * 512,
    settings: { schema: 1, autoClean: true, retentionDays: 30, sweepOnBoot: true, sweepIntervalHours: 6 },
    sweep: { lastSweepAt: now - 3_600_000, lastSweepRemoved: 0, count: 2 },
};

writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/theme.css">
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
</head><body><div id="root"></div>
<script>
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  var PAYLOAD = ${JSON.stringify(PAYLOAD)};
  // The plugin drives its own routes; answer them locally so no server and no
  // host state are needed.
  window.fetch = function () {
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve(PAYLOAD); } });
  };
  var loaded = null;
  window.__ModuleLoader__ = { load: function (entry) { loaded = entry.factory(require); } };
  function require(name) {
    if (name === 'react') return window.React;
    if (name === 'react-dom/client') return window.ReactDOM;
    // Deliberately unresolved: the probe exercises the bundled fallback surface.
    throw new Error('unexpected require: ' + name);
  }
</script>
<script src="/plugin-client.js"></script>
<script>
  var React = window.React;
  var effects = [];
  // Drive the real apply(): it installs the stylesheet, mounts the panel host
  // and starts the sidebar entry (which finds no anchor in this bare page).
  loaded.apply({
    sessions: { list: { getSnapshot: function () { return { ids: [], byId: {} }; } }, refresh: function () { return Promise.resolve(); } },
    get: function () { return null; },
    effect: function (body, label) { effects.push(label); var d = body(); if (typeof d === 'function') return d; return function () {}; }
  });
  window.__effects = effects;
  window.__bin = loaded.__test.binStore;
  window.__show = function (state) {
    if (state === 'empty') {
      window.__bin.set({ open: true, phase: 'ready', entries: [], totalBytes: 0, settings: PAYLOAD.settings,
        sweep: PAYLOAD.sweep, notice: null, error: null, visible: 50, busyId: null, rowErrors: {}, confirm: null });
      return;
    }
    if (state === 'list') {
      window.__bin.set({ open: true, phase: 'ready', entries: PAYLOAD.entries, totalBytes: PAYLOAD.totalBytes,
        settings: PAYLOAD.settings, sweep: PAYLOAD.sweep, notice: null, error: null, visible: 50, busyId: null,
        rowErrors: {}, confirm: null });
      return;
    }
    // A restore now reports through the top-center toast, so the panel's own
    // notice line is pinned with the remaining producer: the sweep result.
    if (state === 'swept') {
      window.__bin.set({ open: true, phase: 'ready', entries: [PAYLOAD.entries[1]], totalBytes: 4096,
        settings: PAYLOAD.settings, sweep: PAYLOAD.sweep, notice: '已自动清理 2 个过期会话', error: null,
        visible: 50, busyId: null, rowErrors: {}, confirm: null });
      return;
    }
    if (state === 'confirm') {
      window.__bin.set({ open: true, phase: 'ready', entries: PAYLOAD.entries, totalBytes: PAYLOAD.totalBytes,
        settings: PAYLOAD.settings, sweep: PAYLOAD.sweep, notice: null, error: null, visible: 50, busyId: null,
        rowErrors: {}, confirm: { kind: 'empty', count: PAYLOAD.entries.length, size: '12.9 MB', busy: false, error: null } });
      return;
    }
    if (state === 'failed') {
      window.__bin.set({ open: true, phase: 'failed', entries: [], totalBytes: 0, settings: null, sweep: null,
        notice: null, error: '读取回收站失败', visible: 50, busyId: null, rowErrors: {}, confirm: null });
      return;
    }
    if (state === 'many') {
      // More entries than one page, so the panel's own paging is exercised.
      var many = [];
      for (var i = 0; i < 60; i++) {
        many.push({ id: 'session-many-' + i, title: '批量会话 ' + (i + 1), cwd: 'D:\\\\work\\\\many',
          deletedAt: new Date(Date.now() - (i + 1) * 3600000).toISOString(), sizeBytes: 1024 * (i + 1),
          wasArchived: false, status: 'trashed' });
      }
      window.__bin.set({ open: true, phase: 'ready', entries: many, totalBytes: 1024 * 1830,
        settings: PAYLOAD.settings, sweep: PAYLOAD.sweep, notice: null, error: null, visible: 50,
        busyId: null, rowErrors: {}, confirm: null });
      return;
    }
    if (state === 'closed') window.__bin.set({ open: false });
  };
</script>
</body></html>
`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
    const name = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    try {
        const body = readFileSync(join(dir, name.slice(1)));
        res.writeHead(200, { 'content-type': MIME[extname(name)] ?? 'application/octet-stream' });
        res.end(body);
    }
    catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newContext({ viewport: { width: 1100, height: 820 } }).then((c) => c.newPage());
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const readPanel = () => page.evaluate(() => {
    const card = document.querySelector('.sd-bin-card');
    if (card === null) return null;
    const pick = (selector) => {
        const node = card.querySelector(selector);
        return node === null ? null : { text: node.textContent, color: getComputedStyle(node).color };
    };
    const button = (selector) => {
        const node = card.querySelector(selector);
        if (node === null) return null;
        const style = getComputedStyle(node);
        return { text: node.textContent, background: style.backgroundColor, color: style.color };
    };
    return {
        card: {
            background: getComputedStyle(card).backgroundColor,
            border: getComputedStyle(card).borderTopColor,
            radius: getComputedStyle(card).borderTopLeftRadius,
            width: Math.round(card.getBoundingClientRect().width),
        },
        firstTitleWidth: card.querySelector('.sd-bin-row-title') === null ? null
            : Math.round(card.querySelector('.sd-bin-row-title').getBoundingClientRect().width),
        heading: pick('.sd-bin-head'),
        rows: [...card.querySelectorAll('.sd-bin-row')].map((row) => ({
            title: row.querySelector('.sd-bin-row-title')?.textContent ?? '',
            titleColor: getComputedStyle(row.querySelector('.sd-bin-row-title')).color,
            meta: [...row.querySelectorAll('.sd-bin-row-meta span')].map((n) => n.textContent),
            warn: row.querySelector('.sd-bin-row-warn')?.textContent ?? null,
            restore: [...row.querySelectorAll('button')].map((b) => b.textContent),
        })),
        empty: pick('.sd-bin-empty'),
        status: pick('.sd-bin-status'),
        notice: pick('.sd-bin-notice'),
        error: pick('.sd-bin-error'),
        confirm: pick('.sd-bin-confirm-text'),
        // The inline confirmation row: its affirmative button says "确定" — the
        // row text carries the consequence, so a second "真实删除" would only
        // repeat the button that opened the row.
        confirmButton: button('.sd-bin-confirm .sd-dlg-btn-danger'),
        confirmCancel: button('.sd-bin-confirm .sd-dlg-btn'),
        footer: pick('.sd-bin-footer'),
        more: pick('.sd-bin-more'),
        emptyAll: button('.sd-bin-link'),
        danger: button('.sd-dlg-btn-danger'),
        // Issue #1: rows past the fold were clipped and unreachable because the
        // body gave the list no height to overflow against. Geometry is the only
        // thing that can tell the difference between "the list scrolls" and
        // "the rows are drawn outside the card where nobody can reach them".
        scroll: (() => {
            const body = card.querySelector('.sd-bin-body');
            const list = card.querySelector('.sd-bin-list');
            if (body === null || list === null) return null;
            const footer = card.querySelector('.sd-bin-footer');
            const cardBox = card.getBoundingClientRect();
            const listBox = list.getBoundingClientRect();
            const footBox = footer === null ? null : footer.getBoundingClientRect();
            return {
                clientHeight: list.clientHeight,
                scrollHeight: list.scrollHeight,
                scrollable: list.scrollHeight > list.clientHeight + 1,
                listBottom: Math.round(listBox.bottom),
                cardBottom: Math.round(cardBox.bottom),
                // Nothing below the list may fall outside the card.
                footerInside: footBox === null ? null : Math.round(footBox.bottom) <= Math.round(cardBox.bottom),
                cardInsideViewport: Math.round(cardBox.bottom) <= window.innerHeight,
            };
        })(),
    };
});

const readTokens = () => page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return {
        warn: s.getPropertyValue('--dsw-alias-state-warn-primary').trim(),
        error: s.getPropertyValue('--dsw-alias-state-error-primary').trim(),
        success: s.getPropertyValue('--dsw-alias-state-success-primary').trim(),
    };
});

const states = {};
for (const state of ['closed', 'empty', 'list', 'many', 'swept', 'confirm', 'failed']) {
    await page.evaluate((name) => window.__show(name), state);
    await page.waitForTimeout(220);
    states[state] = await readPanel();
    if (state === 'list') {
        // Archived for review: this is the state whose width was reported.
        await page.screenshot({ path: join(dir, 'panel-list.png') });
        await page.locator('.sd-bin-footer').screenshot({ path: join(dir, 'panel-footer.png') });
    }
}

// Paging: one page of 50 plus the "load more" control, and the rest on demand.
// (Re-shown explicitly: the loop above leaves the panel in its last state.)
await page.evaluate(() => window.__show('many'));
await page.waitForTimeout(260);
const manyBefore = await readPanel();
await page.evaluate(() => document.querySelector('.sd-bin-more')?.click());
await page.waitForTimeout(260);
const manyAfter = await readPanel();

// Drive the list to the bottom: the point of issue #1 is that those rows were
// unreachable, and only a real scroll proves they are not anymore.
const manyScrolled = await page.evaluate(() => {
    const list = document.querySelector('.sd-bin-list');
    if (list === null) return null;
    if (list.scrollHeight <= list.clientHeight + 1) return { scrollable: false };
    list.scrollTop = list.scrollHeight;
    const rows = [...document.querySelectorAll('.sd-bin-row')];
    const last = rows[rows.length - 1];
    const listBox = list.getBoundingClientRect();
    const lastBox = last.getBoundingClientRect();
    return {
        scrollable: true,
        scrollTop: Math.round(list.scrollTop),
        lastRowTitle: last.querySelector('.sd-bin-row-title')?.textContent ?? null,
        // The last row must end up inside the list's own box, not below it.
        lastRowReachable: lastBox.bottom <= listBox.bottom + 2 && lastBox.top >= listBox.top - 2,
    };
});

const light = { tokens: await readTokens(), states };
await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
await page.evaluate(() => window.__show('list'));
await page.waitForTimeout(260);
const dark = { tokens: await readTokens(), states: { list: await readPanel() } };

const report = {
    url,
    pluginStylesInstalled: await page.evaluate(() => document.querySelector('style[data-plugin-css="dsh-session-purge/panel.css"]') !== null),
    pluginEffects: await page.evaluate(() => window.__effects),
    pageErrors,
    light,
    dark,
};

// ── assertions (exit gate) ─────────────────────────────────────────────────
const failures = [];
const check = (label, condition, detail) => {
    if (condition === true) return;
    failures.push(label + (detail === undefined ? '' : ` (${detail})`));
};
check('the plugin installed its stylesheet', report.pluginStylesInstalled);
check('no page error while rendering every state', pageErrors.length === 0, pageErrors.join(' | '));
check('closed renders nothing', light.states.closed === null);
check('empty state renders its title and hint',
    light.states.empty !== null && light.states.empty.rows.length === 0 && light.states.empty.empty !== null,
    JSON.stringify(light.states.empty?.empty));
check('the list renders both entries with title, meta and actions',
    light.states.list !== null && light.states.list.rows.length === 3
    && light.states.list.rows[0].restore.join('/') === '复原/真实删除',
    JSON.stringify(light.states.list?.rows?.[0]?.restore));
// The card must be wide enough that a session title is not a sliver of
// ellipsis: the shell's own modal width (380px) was the reported problem.
check('the panel card is wide (>= 700px), not the shell default',
    light.states.list.card.width >= 700, `${light.states.list.card.width}px`);
check('a session title column gets most of that width',
    light.states.list.firstTitleWidth >= 500, `${light.states.list.firstTitleWidth}px`);
check('the untitled entry falls back to the placeholder',
    light.states.list.rows[1].title === '未命名会话', light.states.list.rows[1].title);
check('the expiring entry is announced', light.states.list.rows[1].warn !== null,
    String(light.states.list.rows[1].warn));
check('the footer carries the policy and the stats',
    light.states.list.footer !== null && light.states.list.footer.text.includes('自动清理：保留 30 天')
    && light.states.list.footer.text.includes('共 3 个会话'),
    light.states.list.footer?.text);
check('permanent delete is offered and tinted with the error token',
    light.states.list.danger !== null
    && light.states.list.danger.background === light.tokens.error.replace('rgb', 'rgb'),
    `${light.states.list.danger?.background} vs ${light.tokens.error}`);
check('a sweep reports the outcome', light.states.swept.notice !== null
    && light.states.swept.notice.text.includes('已自动清理'), String(light.states.swept.notice?.text));
check('the confirm strip states the consequence',
    light.states.confirm.confirm !== null && light.states.confirm.confirm.text.includes('永久删除全部 3 个会话'),
    String(light.states.confirm.confirm?.text));
check('its affirmative button says "确定" while cancel says "取消"',
    light.states.confirm.confirmButton?.text === '确定' && light.states.confirm.confirmCancel?.text === '取消',
    JSON.stringify({ confirm: light.states.confirm.confirmButton?.text, cancel: light.states.confirm.confirmCancel?.text }));
check('the failed state offers a retry', light.states.failed.status !== null
    && light.states.failed.status.text.includes('读取回收站失败'), String(light.states.failed.status?.text));
check('a long bin shows one page plus "load more"',
    manyBefore !== null && manyBefore.rows.length === 50 && manyBefore.more !== null,
    JSON.stringify({ rows: manyBefore?.rows?.length, more: manyBefore?.more?.text }));
check('"load more" reveals the rest and then disappears',
    manyAfter !== null && manyAfter.rows.length === 60 && manyAfter.more === null,
    JSON.stringify({ rows: manyAfter?.rows?.length, more: manyAfter?.more }));
// ── issue #1: the list scrolls, the card and footer stay put ───────────────
check('a long list scrolls inside the card instead of overflowing it',
    manyBefore.scroll !== null && manyBefore.scroll.scrollable === true,
    JSON.stringify(manyBefore?.scroll));
check('the card stays in the viewport and the footer stays inside the card',
    manyBefore.scroll?.cardInsideViewport === true && manyBefore.scroll?.footerInside === true,
    JSON.stringify(manyBefore?.scroll));
check('scrolling really reaches the rows past the fold',
    manyScrolled !== null && manyScrolled.scrollable === true && manyScrolled.lastRowReachable === true,
    JSON.stringify(manyScrolled));
check('the panel renders under the dark palette too',
    dark.states.list !== null && dark.states.list.rows.length === 3
    && dark.states.list.card.background !== light.states.list.card.background,
    `${dark.states.list?.card?.background} vs ${light.states.list.card.background}`);

console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();

if (failures.length > 0) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
}
else {
    console.log('\nOK: every panel state rendered with the expected surface');
}
