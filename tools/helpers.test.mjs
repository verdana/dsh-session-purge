/**
 * Regression tests for the two bugs that made every delete fail:
 *  1. snapshots from `sessionPersistence.list()` carry the id at `header.id`;
 *  2. `location.path` is a NATIVE path, so it must not be split on `/`.
 *
 * Run: node --test tools/*.test.mjs   (or: npm test)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    findSessionSnapshot,
    service,
    sessionDirectoryFromLogPath,
    snapshotSessionId,
} from '../lib/index.js';

// Which Node/platform/path flavor this run actually used. Important in WSL:
// Node from the Windows side reports process.platform === 'win32', so a "Linux"
// shell there still tests Windows path semantics.
const HOST = {
    windows: process.platform === 'win32',
    flavor: process.platform === 'win32' ? 'win32' : 'posix',
};
console.log(`# host: node ${process.version} on ${process.platform} — path flavor ${HOST.flavor}`);
// The suite intentionally drives refusal paths; show their diagnostics.
process.env.DSH_PURGE_DEBUG = '1';

/**
 * The browser half's source, read once. Several suites below assert on it
 * directly: the client module is a `window.__ModuleLoader__.load({...})` browser
 * bundle, so there is nothing to import — it is either evaluated (menu helpers)
 * or inspected (dictionary keys, dialog variant classes).
 */
const clientSrc = readFileSync(fileURLToPath(new URL('../client/client.js', import.meta.url)), 'utf8');

test('snapshotSessionId reads the id from the snapshot header', () => {
    // Exact shape returned by @deepseek-ai/dsh-session-persistence-jsonl.
    const snapshot = {
        header: { id: 'session-abc', cwd: 'D:\\deepseek-harness', version: 3 },
        revision: 'file:1:2',
        sizeBytes: 1234,
    };
    assert.equal(snapshotSessionId(snapshot), 'session-abc');
});

test('snapshotSessionId tolerates a flattened snapshot and refuses junk', () => {
    assert.equal(snapshotSessionId({ id: 'session-flat' }), 'session-flat');
    assert.equal(snapshotSessionId({}), undefined);
    assert.equal(snapshotSessionId(null), undefined);
    assert.equal(snapshotSessionId(undefined), undefined);
    assert.equal(snapshotSessionId('session-abc'), undefined);
    assert.equal(snapshotSessionId({ header: { id: 42 } }), undefined);
});

test('findSessionSnapshot finds the session in a real list() result', () => {
    const list = [
        { header: { id: 'session-one' }, revision: 'r1' },
        { header: { id: 'session-two' }, revision: 'r2' },
    ];
    assert.equal(findSessionSnapshot(list, 'session-two')?.revision, 'r2');
    // This is the pre-fork lookup: `h.id` — it never matched anything.
    assert.equal(findSessionSnapshot(list, 'session-two')?.id, undefined);
    assert.equal(findSessionSnapshot(list, 'session-missing'), undefined);
    assert.equal(findSessionSnapshot(undefined, 'session-one'), undefined);
});

// The default path flavor follows the HOST, so a cross-platform assertion must
// name the flavor it is asserting — otherwise the same test passes on Windows
// and fails on Linux (a Windows path is not absolute to path.posix).
test('sessionDirectoryFromLogPath uses the host path flavor by default', () => {
    const windowsHost = HOST.windows;
    const hostPath = windowsHost ? win32 : posix;

    // Absolute in the host's own flavor (a relative spelling is refused by design).
    const sessionDir = hostPath.resolve(
        windowsHost ? 'C:\\root' : '/root',
        'sessions', '--proj--', 'session-abc',
    );
    const log = hostPath.join(sessionDir, 'session.v3.jsonl.zstd');
    assert.equal(sessionDirectoryFromLogPath(log), sessionDir);

    // Plain relative spellings are never accepted.
    assert.equal(sessionDirectoryFromLogPath('sessions/--p--/session-abc/session.v3.jsonl.zstd'), undefined);
    // A POSIX absolute spelling parses on POSIX and on Windows too
    // (path.win32 reads a leading `/` as the current drive's root) — the
    // resolved DIRECTORY is what matters, and both keep the same spelling.
    assert.equal(
        sessionDirectoryFromLogPath('/home/v/.dsh/sessions/--proj--/session-abc/session.v3.jsonl.zstd'),
        '/home/v/.dsh/sessions/--proj--/session-abc',
    );
    // A drive-qualified spelling only parses where drives exist.
    assert.equal(
        sessionDirectoryFromLogPath('C:\\Users\\v\\.dsh\\sessions\\--D-proj--\\session-abc\\session.v3.jsonl.zstd'),
        windowsHost ? 'C:\\Users\\v\\.dsh\\sessions\\--D-proj--\\session-abc' : undefined,
    );
});

test('sessionDirectoryFromLogPath handles Windows and POSIX log paths', () => {
    // Explicit flavors: valid on every host, which is the point of the injection.
    // POSIX assertions run against `path.posix` even on a Windows host, so a
    // Windows checkout/CI still proves the Linux/macOS branch.
    assert.equal(HOST.flavor === 'win32' || HOST.flavor === 'posix', true);
    assert.equal(
        sessionDirectoryFromLogPath(
            'C:\\Users\\v\\.dsh\\sessions\\--D-proj--\\session-abc\\session.v3.jsonl.zstd',
            win32,
        ),
        'C:\\Users\\v\\.dsh\\sessions\\--D-proj--\\session-abc',
    );
    assert.equal(
        sessionDirectoryFromLogPath(
            '/home/v/.dsh/sessions/--proj--/session-abc/session.v3.jsonl.zstd',
            posix,
        ),
        '/home/v/.dsh/sessions/--proj--/session-abc',
    );
    // Uncompressed and unversioned generations are still log artifacts.
    assert.equal(
        sessionDirectoryFromLogPath('/tmp/root/--p--/session-abc/session.jsonl', posix),
        '/tmp/root/--p--/session-abc',
    );
});

test('sessionDirectoryFromLogPath refuses anything it cannot prove', () => {
    // Pre-fork behaviour: a Windows path has no `/`, so this returned undefined
    // and the UI reported "storage backend does not support this operation".
    assert.equal(
        sessionDirectoryFromLogPath('C:\\Users\\v\\.dsh\\sessions\\proj\\session.lock', win32),
        undefined,
    );
    assert.equal(sessionDirectoryFromLogPath('/tmp/root/session-abc/anything.txt', posix), undefined);
    assert.equal(sessionDirectoryFromLogPath('/tmp/root/session-abc', posix), undefined);
    assert.equal(sessionDirectoryFromLogPath('session.v3.jsonl.zstd', posix), undefined);
    assert.equal(sessionDirectoryFromLogPath('', posix), undefined);
    assert.equal(sessionDirectoryFromLogPath(undefined, posix), undefined);
    assert.equal(sessionDirectoryFromLogPath(null, posix), undefined);
    assert.equal(sessionDirectoryFromLogPath(42, posix), undefined);
    // A log file whose parent is the filesystem root has no session directory.
    assert.equal(sessionDirectoryFromLogPath('/session.v3.jsonl.zstd', posix), undefined);
});

/**
 * Platform-parameterized cases: each path flavor is checked with its own
 * algorithm regardless of the host, so POSIX behaviour is covered on Windows
 * CI and Windows behaviour on Linux/macOS CI.
 */
const PLATFORM_CASES = [
    {
        flavor: 'posix',
        pathApi: posix,
        log: '/home/u/.dsh/sessions/--srv-app--/session-7f3a/session.v3.jsonl.zstd',
        dir: '/home/u/.dsh/sessions/--srv-app--/session-7f3a',
        reject: [
            'relative/session.v3.jsonl.zstd',
            './session.v3.jsonl.zstd',
            '/session.v3.jsonl.zstd',
            '/session.lock',
            '/home/u/.dsh/sessions/--srv-app--/session-7f3a/session.lock',
        ],
    },
    {
        flavor: 'win32',
        pathApi: win32,
        log: 'C:\\Users\\u\\.dsh\\sessions\\--D-app--\\session-7f3a\\session.v3.jsonl.zstd',
        dir: 'C:\\Users\\u\\.dsh\\sessions\\--D-app--\\session-7f3a',
        reject: [
            'relative\\session.v3.jsonl.zstd',
            '\\session.v3.jsonl.zstd',
            'C:\\session.v3.jsonl.zstd',
            'C:\\Users\\u\\.dsh\\sessions\\--D-app--\\session-7f3a\\session.lock',
        ],
    },
];

for (const c of PLATFORM_CASES) {
    test(`${c.flavor}: derives the session directory from a located log`, () => {
        assert.equal(sessionDirectoryFromLogPath(c.log, c.pathApi), c.dir);
    });

    test(`${c.flavor}: refuses every unprovable path`, () => {
        for (const bad of [...c.reject, '', undefined, null, 42]) {
            assert.equal(sessionDirectoryFromLogPath(bad, c.pathApi), undefined,
                `expected refusal for ${String(bad)}`);
        }
    });

    test(`${c.flavor}: a directory that only looks like a log is not removed`, () => {
        // The log-shaped name must be the ARTIFACT name, not a directory name:
        // the derived directory is the artifact's parent.
        const nested = c.pathApi.join(c.dir, 'session.v3.jsonl.zstd');
        assert.equal(sessionDirectoryFromLogPath(nested, c.pathApi), c.dir);
        assert.equal(sessionDirectoryFromLogPath(c.dir, c.pathApi), undefined);
    });
}

test('service() degrades a throwing or unusable provider to "missing"', () => {
    const good = { list: () => [] };
    assert.equal(service({ get: (name) => (name === 'x' ? good : undefined) }, 'x'), good);
    // A service that does not implement the required method is unusable.
    assert.equal(service({ get: () => good }, 'x', 'locate'), undefined);
    assert.equal(service({ get: () => good }, 'x', 'list'), good);
    // A faulted runtime must not turn a lookup into a request failure.
    assert.equal(service({ get() { throw new Error('fiber disposed'); } }, 'x'), undefined);
    // Absent context/service.
    assert.equal(service(undefined, 'x'), undefined);
    assert.equal(service({}, 'x'), undefined);
    assert.equal(service({ get: () => null }, 'x'), undefined);
});

test('a real session root layout maps to the session directory, not its parent', async () => {
    // Built with real fs operations so the check exercises the host platform's
    // own separators — the CI matrix then covers POSIX and Windows for real.
    const root = await mkdtemp(join(tmpdir(), 'dsh-purge-test-'));
    try {
        const sessionDir = join(root, '--D-deepseek-harness--', 'session-abc');
        await mkdir(sessionDir, { recursive: true });
        const log = join(sessionDir, 'session.v3.jsonl.zstd');
        await writeFile(log, 'header\n');
        assert.equal(sessionDirectoryFromLogPath(log), sessionDir);
        assert.equal(dirname(log), sessionDir);
        // And the removal step this function feeds really does remove it.
        await rm(sessionDirectoryFromLogPath(log), { recursive: true, force: true });
        assert.equal(existsSync(sessionDir), false);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('client dictionaries stay in sync (a missing key renders as the raw key)', () => {
    const src = clientSrc;
    const section = (name) => src.match(new RegExp(`${name}: \\{([\\s\\S]*?)\\n\\t\\t\\},`))[1];
    const keysOf = (text) => [...text.matchAll(/"([^"]+)":/g)].map((m) => m[1]).sort();

    const zh = keysOf(section('zh'));
    const en = keysOf(section('en'));
    assert.deepEqual(en, zh, 'zh/en dictionary keys must match');
    // Every literal tr("...") key resolves; the dynamic ones are "error." + code.
    for (const key of [...src.matchAll(/tr\("([^"]+)"/g)].map((m) => m[1])) {
        if (key === 'error.') continue;
        assert.ok(zh.includes(key), `dictionary is missing "${key}"`);
    }
    // Keys chosen through a ternary are invisible to that scan: the dialog title
    // picks its key from the outcome, so name the success one explicitly.
    for (const key of [...src.matchAll(/"?([a-z][\w.]*\.[a-z][\w]*)"?\s*:\s*"([a-z][\w.]*\.[a-z][\w]*)"/gu)].map((m) => m[1])) {
        assert.ok(zh.includes(key), `a ternary picks "${key}" but the dictionary has no such key`);
    }
});

// ── terminal dialog semantics ──────────────────────────────────────────────
//
// The dialog serves two moments: "confirm this irreversible delete" (danger)
// and "it is done" (success). They must not look alike, or the report reads as
// another warning.

/** The dialog's JSX-ish render body, which is where the variant classes are chosen. */
const dialogRender = clientSrc.slice(clientSrc.indexOf('var succeeded ='), clientSrc.indexOf('// ── module state bound in apply()'));

test('a completed delete switches the dialog to its success variant', () => {
    assert.match(dialogRender, /succeeded\s*=\s*done !== null/u);
    assert.match(dialogRender, /succeeded \? "sd-dlg sd-dlg-success" : "sd-dlg"/u);
    assert.match(dialogRender, /succeeded \? "sd-dlg-btn sd-dlg-btn-success" : "sd-dlg-btn sd-dlg-btn-danger"/u);
});

test('the success variant is green and the danger variant stays red', () => {
    assert.match(clientSrc, /\.sd-dlg-btn-success\{background:var\(--dsw-alias-state-success-primary/u);
    assert.match(clientSrc, /\.sd-dlg-success \.sd-dlg-title \.sd-icon\{color:var\(--dsw-alias-state-success-primary/u);
    // The confirmation keeps the destructive colour.
    assert.match(clientSrc, /\.sd-dlg-btn-danger\{background:var\(--dsw-alias-state-error-primary/u);
    // The two variants must not share a colour: that was the reported bug.
    const green = clientSrc.slice(clientSrc.indexOf('.sd-dlg-btn-success'), clientSrc.indexOf('.sd-dlg-btn-success') + 160);
    assert.equal(green.includes('state-error-primary'), false, 'the success button went back to red');
});

test('the success heading uses the tick icon and its own title key', () => {
    assert.match(dialogRender, /__html: succeeded \? OK_ICON : ICON/u);
    assert.match(dialogRender, /titleKey = succeeded \? "dialog\.doneTitle" : "dialog\.title"/u);
    // OK_ICON must be a distinct drawing, not a recoloured bin.
    const ok = clientSrc.match(/var OK_ICON = '([^']+)'/u);
    assert.notEqual(ok, null);
    assert.equal(ok[1].includes('M2.5 4.2h11'), false, 'OK_ICON still draws the bin');
});

// ── session-row menu detection across DSH generations ──────────────────────
//
// The menu is sniffed from the DOM because dsh-client-ui-workspace exposes no
// extension point. These labels were captured from real renders:
//   0.1.5-rc.3  the three built-in verbs, plain text, nothing else
//   0.1.7-rc.2  置顶会话 prepended, every verb carrying a shortcut keycap, and
//               plugin-registered rows appended after the built-in block
// A regression here means the delete item is silently never injected — the
// exact failure that made the plugin dead on 0.1.7.

/** The pure helpers, read out of the REAL client module (never a mirror copy). */
/** Resolve any plugin dependency to a stub — the helpers under test never call one. */
const stubRequire = () => ({ createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, createRoot: () => ({}) });
let clientModule = null;
// The client half is a `window.__ModuleLoader__.load({...})` browser module, so
// evaluate it the way the browser would and keep the loaded exports.
new Function('window', 'require', clientSrc)(
    { __ModuleLoader__: { load: (entry) => { clientModule = entry.factory(stubRequire) } } },
    stubRequire,
);
const MENU = clientModule.__test;

test('the client module exposes its menu helpers to this suite', () => {
    assert.equal(typeof MENU.isSessionMenuDom, 'function');
    assert.equal(typeof MENU.archiveIndex, 'function');
    assert.equal(typeof MENU.nodeFromFiber, 'function');
    assert.equal(MENU.SESSION_MENU_SEQUENCES.length, 2);
});

test('0.1.5 menu labels are detected and anchor the insert after archive', () => {
    const labels = ['重命名', '分叉会话', '归档会话'];
    assert.equal(labels.length, 3);
    assert.equal(MENU.matchesSequence(labels), true);
    assert.equal(MENU.archiveIndex(labels), 2);
});

test('0.1.5 English menu labels are detected', () => {
    const labels = ['Rename', 'Fork session', 'Archive session'];
    assert.equal(MENU.matchesSequence(labels), true);
    assert.equal(MENU.archiveIndex(labels), 2);
});

test('0.1.7 menu labels (pin row + shortcut keycaps) are still detected', () => {
    // Captured verbatim from a live 0.1.7-rc.2 render, before the aria-hidden
    // shortcut spans are excluded.
    const raw = ['置顶会话', '重命名Ctrl+Shift+R', '分叉会话Ctrl+Shift+F', '归档会话Ctrl+Alt+A'];
    assert.equal(raw.length !== 3, true, 'precondition: the menu is no longer exactly three rows');
    assert.equal(MENU.matchesSequence(raw), true, 'the subsequence match must tolerate extra rows and keycaps');
    assert.equal(MENU.archiveIndex(raw), 3, 'the delete entry belongs right after archive');
});

test('0.1.7 English menu labels are still detected', () => {
    const raw = ['Pin session', 'RenameCtrl+Shift+R', 'Fork sessionCtrl+Shift+F', 'Archive sessionCtrl+Alt+A'];
    assert.equal(MENU.matchesSequence(raw), true);
    assert.equal(MENU.archiveIndex(raw), 3);
});

test('plugin rows appended after the built-in block do not break detection', () => {
    const raw = [
        '置顶会话', '重命名Ctrl+Shift+R', '分叉会话Ctrl+Shift+F', '归档会话Ctrl+Alt+A',
        'Export action', 'Last action',
    ];
    assert.equal(MENU.matchesSequence(raw), true);
    // Archive is still the anchor, so the delete entry does not land below the
    // separator that opens the plugin group.
    assert.equal(MENU.archiveIndex(raw), 3);
});

test('an archived row anchors on the unarchive verb', () => {
    assert.equal(MENU.archiveIndex(['取消归档Ctrl+Alt+A']), 0);
    assert.equal(MENU.archiveIndex(['Unarchive session']), 0);
});

test('unrelated menus are refused, so no delete item is injected into them', () => {
    // The workspace row menu (rename/delete-workspace) shares the rename verb.
    assert.equal(MENU.matchesSequence(['重命名', '删除工作区']), false);
    // The view-options menu.
    assert.equal(MENU.matchesSequence(['隐藏已归档会话', '仅显示已归档会话']), false);
    // A submenu or an empty menu.
    assert.equal(MENU.matchesSequence([]), false);
    assert.equal(MENU.matchesSequence(['重命名']), false);
    // Order matters: archive before fork is not the built-in sequence.
    assert.equal(MENU.matchesSequence(['归档会话', '分叉会话', '重命名']), false);
    assert.equal(MENU.archiveIndex([]), -1);
    assert.equal(MENU.archiveIndex(['重命名', '分叉会话']), -1);
});

test('the exact-three-item gate that broke 0.1.7 is gone from the source', () => {
    assert.equal(/btns\.length !== 3/.test(clientSrc), false);
});

/**
 * Minimal stand-ins for the two menu DOM shapes, used to drive the REAL
 * `menuItemLabels` (not a copy of it):
 *   ≤ 0.1.5  `<button role=menuitem><span>icon</span><span>label</span></button>`
 *   0.1.7    the same plus `<span aria-hidden="true"><kbd>…</kbd></span>`
 * In both, `div[role=menu] > div[role=presentation] > div.itemWrap > button`.
 */
function fakeElement({ text = '', ariaHidden = false, children = [], buttons = [] } = {}) {
    return {
        textContent: text,
        children,
        getAttribute: (name) => (name === 'aria-hidden' && ariaHidden ? 'true' : null),
        querySelectorAll: (selector) => (selector === 'button[role=menuitem]' ? buttons : []),
    };
}
function fakeMenu(rows) {
    const buttons = rows.map((row) => fakeElement({
        text: row.label + (row.keys ?? ''),
        children: [
            fakeElement({ text: row.icon ?? '' }),
            fakeElement({ text: row.label }),
            ...(row.keys === undefined ? [] : [fakeElement({ text: row.keys, ariaHidden: true })]),
        ],
    }));
    return fakeElement({ buttons });
}

test('menuItemLabels reads the verb alone with a shortcut keycap present (0.1.7)', () => {
    const menu = fakeMenu([
        { label: '置顶会话' },
        { label: '重命名', keys: 'Ctrl+Shift+R' },
        { label: '分叉会话', keys: 'Ctrl+Shift+F' },
        { label: '归档会话', keys: 'Ctrl+Alt+A' },
    ]);
    assert.deepEqual(MENU.menuItemLabels(menu), ['置顶会话', '重命名', '分叉会话', '归档会话']);
    // That is the real 0.1.7 DOM, so detection and anchoring must both land.
    assert.equal(MENU.isSessionMenuDom(menu), true);
    assert.equal(MENU.archiveIndex(MENU.menuItemLabels(menu)), 3);
});

test('menuItemLabels reads plain labels unchanged (0.1.5)', () => {
    const menu = fakeMenu([{ label: '重命名' }, { label: '分叉会话' }, { label: '归档会话' }]);
    assert.deepEqual(MENU.menuItemLabels(menu), ['重命名', '分叉会话', '归档会话']);
    assert.equal(MENU.isSessionMenuDom(menu), true);
    assert.equal(MENU.archiveIndex(MENU.menuItemLabels(menu)), 2);
});

test('a menu without a shortcut keycap does not lose its labels', () => {
    // The English 0.1.7 set, and a menu whose rows carry no keycap span at all.
    const english = fakeMenu([
        { label: 'Pin session' },
        { label: 'Rename', keys: 'Ctrl+Shift+R' },
        { label: 'Fork session', keys: 'Ctrl+Shift+F' },
        { label: 'Archive session', keys: 'Ctrl+Alt+A' },
    ]);
    assert.equal(MENU.isSessionMenuDom(english), true);
    assert.equal(MENU.archiveIndex(MENU.menuItemLabels(english)), 3);

    const noKeycaps = fakeMenu([{ label: 'Rename' }, { label: 'Fork session' }, { label: 'Archive session' }]);
    assert.deepEqual(MENU.menuItemLabels(noKeycaps), ['Rename', 'Fork session', 'Archive session']);
    assert.equal(MENU.isSessionMenuDom(noKeycaps), true);
});

/**
 * SessionNodeItem prop shapes, as both generations actually pass them:
 *   0.1.5  node + onOpen/onRename/onFork/onArchive
 *   0.1.7  node + onOpen/onRenameRequest only (verbs moved into a render slot)
 * The fiber walk must identify the row in BOTH, or the delete dialog loses the
 * session id and falls back to a title lookup.
 */
test('nodeFromFiber identifies the session row when verbs are props (0.1.5)', () => {
    const node = { id: 'session-a', title: '问候交流', running: false, pinned: false, archived: false };
    const fiber = { memoizedProps: { node, onOpen: () => {}, onRename: () => {}, onFork: () => {}, onArchive: () => {} }, return: null };
    assert.equal(MENU.nodeFromFiber(fiber), node);
});

test('nodeFromFiber identifies the session row after the slot rewrite (0.1.7)', () => {
    const node = { id: 'session-b', title: '问候交流', running: true, pinned: true, archived: false };
    const fiber = { memoizedProps: { node, currentId: undefined, onOpen: () => {}, onRenameRequest: () => {} }, return: null };
    assert.equal(MENU.nodeFromFiber(fiber), node);
});

test('nodeFromFiber walks up and refuses unrelated fibers', () => {
    const node = { id: 'session-c', title: 'x', running: false };
    const row = { memoizedProps: { node, onOpen: () => {} }, return: null };
    const leaf = { memoizedProps: { className: 'title' }, return: row };
    assert.equal(MENU.nodeFromFiber(leaf), node);
    // An object that merely carries an `id` is not a SessionNode.
    assert.equal(MENU.nodeFromFiber({ memoizedProps: { node: { id: 'session-d' }, onOpen: () => {} }, return: null }), null);
    assert.equal(MENU.nodeFromFiber(null), null);
});


