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
    const clientPath = fileURLToPath(new URL('../client/client.js', import.meta.url));
    const src = readFileSync(clientPath, 'utf8');
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
});
