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
import { after, test } from 'node:test';

import {
    deleteSession,
    diskSessionReport,
    findSessionSnapshot,
    hasActiveJob,
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

/**
 * The host half's source, read once. A few invariants live in the wiring rather
 * than in an exported helper (which argument a service call receives, which
 * member a getter is read from), so they are pinned by inspecting the source.
 * This is deliberately not a whole-module snapshot: only these exact call
 * shapes are asserted.
 */
const hostSrc = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8');

/**
 * `hostSrc` with comments removed. The regression checks below assert that a
 * DEFECT is absent, and the fixes' own explanatory comments quote the defective
 * spellings (`header.title`, `status !== 'finished'`), so scanning the raw
 * source would match the documentation. Stripping comments keeps the assertion
 * about executable code. Crude on purpose: `lib/index.js` contains no regex or
 * string literal that a `//` or `/*` could appear inside.
 */
const hostCode = hostSrc
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');

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

// ── the background-job gate ────────────────────────────────────────────────
//
// `jobs.list(caller?)` takes a SessionId and returns the jobs owned by that
// session PLUS every unowned job — and the registry RETAINS settled jobs. Three
// independent defects made this gate useless or harmful: passing the Agent
// OBJECT matched no owner (so only unowned jobs were ever seen), treating an
// unowned job as this session's work would let a stray job refuse an unrelated
// delete forever, and `status !== 'finished'` tested a value that does not exist
// in `JobStatus` ('running' | 'stopping' | 'completed' | 'killed' | 'failed').
// Either way a session with live background work could be torn down, or a clean
// one refused with `busy` forever.

test("hasActiveJob counts only this session's in-flight jobs", () => {
    const own = (status) => ({ owner: 'session-a', status });
    assert.equal(hasActiveJob([own('running')], 'session-a'), true);
    assert.equal(hasActiveJob([own('stopping')], 'session-a'), true);
    // Terminal states never block a delete.
    assert.equal(hasActiveJob([own('completed')], 'session-a'), false);
    assert.equal(hasActiveJob([own('killed')], 'session-a'), false);
    assert.equal(hasActiveJob([own('failed')], 'session-a'), false);
    // 'finished' is NOT a JobStatus; a settled row must not be treated as active.
    assert.equal(hasActiveJob([own('finished')], 'session-a'), false);
    // One live job among settled ones still blocks.
    assert.equal(hasActiveJob([own('completed'), own('running')], 'session-a'), true);
});

test('hasActiveJob ignores jobs this session does not own', () => {
    // Jobs owned by another session, and unowned jobs — which `list()` returns
    // to EVERY caller because they "belong to nobody" — must never refuse a
    // delete; they would otherwise block an unrelated session forever.
    const other = { owner: 'session-b', status: 'running' };
    const unowned = { status: 'running' };
    assert.equal(hasActiveJob([other], 'session-a'), false);
    assert.equal(hasActiveJob([unowned], 'session-a'), false);
    assert.equal(hasActiveJob([other, unowned], 'session-a'), false);
    // The same rows DO block their actual owner, so the filter is not a no-op.
    assert.equal(hasActiveJob([other], 'session-b'), true);
    // A row with no owner at all never matches any session.
    assert.equal(hasActiveJob([{ status: 'running' }], 'session-a'), false);
    assert.equal(hasActiveJob([{ status: 'running' }], 'session-b'), false);
});

test('hasActiveJob degrades safely on malformed or empty input', () => {
    assert.equal(hasActiveJob([], 'session-a'), false);
    assert.equal(hasActiveJob(undefined, 'session-a'), false);
    assert.equal(hasActiveJob(null, 'session-a'), false);
    assert.equal(hasActiveJob('nonsense', 'session-a'), false);
    assert.equal(hasActiveJob([null, undefined], 'session-a'), false);
    // An unreadable status on an OWNED job counts as in flight: refusing is the
    // safe side of this gate.
    assert.equal(hasActiveJob([{ owner: 'session-a' }], 'session-a'), true);
    assert.equal(hasActiveJob([{ owner: 'session-a', status: 42 }], 'session-a'), true);
});

test('the job gate passes the session id, not the agent object', () => {
    // Structural: the call site must pass a branded SessionId. Passing `agent`
    // compared an object against `job.owner` and never matched.
    assert.match(hostCode, /jobs\.list\(sessionId\)/u);
    assert.match(hostCode, /hasActiveJob\(snapshots, sessionId\)/u);
    assert.equal(/jobs\.list\(agent\)/u.test(hostCode), false, 'the job gate went back to passing the Agent object');
    // And it must not resurrect the non-existent status.
    assert.equal(/'finished'/u.test(hostCode), false, "the job gate went back to testing 'finished'");
});

// ── the archive set is registry-global ─────────────────────────────────────
//
// `workspaceRegistry.list()` returns `Workspace` entries carrying only
// id/path/title/createdAt/updatedAt/sessionIds + methods — no
// `archivedSessionIds`. Reading it per entry always yielded nothing, so the
// state report claimed every session was unarchived.

test('the archived set is read from the registry, not from workspace entries', () => {
    assert.match(hostSrc, /workspaces\.archivedSessionIds/u);
});

// ── SessionHeader carries no title ─────────────────────────────────────────
//
// SessionHeader is version/id/createdAt/cwd?/parentSession?/isSeeded/origin?/
// delegationDepth?/agentPreset?. Titles are session EVENTS written by
// dsh-session-title, so `header.title` can never resolve.

test('nothing reads a non-existent header title', () => {
    assert.equal(/header\??\.title/u.test(hostCode), false, 'a header.title read came back');
});

test('the state report reads the archived flag from the registry-level set', async () => {
    // The registry exposes `archivedSessionIds`; a `Workspace` ENTRY does not,
    // which is why the earlier per-entry read reported every session as
    // unarchived. The stub gives each source a DIFFERENT member so the
    // assertions can tell which one was read.
    const ctx = {
        get: (name) => {
            if (name === 'sessionPersistence') {
                return {
                    list: async () => [
                        { header: { id: 'session-registry', cwd: 'D:\\proj' }, revision: 'r1', sizeBytes: 10 },
                        { header: { id: 'session-plain', cwd: 'D:\\proj' }, revision: 'r2', sizeBytes: 20 },
                        { header: { id: 'session-entry', cwd: 'D:\\proj' }, revision: 'r3', sizeBytes: 30 },
                    ],
                };
            }
            if (name === 'workspaceRegistry') {
                return {
                    archivedSessionIds: ['session-registry'],
                    // Not a shape upstream has; kept only as a union fallback.
                    list: () => [{ id: 'ws', archivedSessionIds: ['session-entry'] }],
                };
            }
            return undefined;
        },
    };
    const report = await diskSessionReport(ctx);
    assert.equal(report.persistence, true);
    const byId = Object.fromEntries(report.sessions.map((s) => [s.id, s]));
    // The registry-level set is what decides: this is the case that used to be
    // reported as false.
    assert.equal(byId['session-registry'].archived, true,
        'the registry-level archive set must mark this session archived');
    // The union fallback keeps a per-entry value; it never un-archives.
    assert.equal(byId['session-entry'].archived, true,
        'the union fallback must not drop a per-entry value');
    assert.equal(byId['session-plain'].archived, false);
    // SessionHeader has no title, so the report must say so rather than pretend.
    assert.equal(byId['session-registry'].title, null);
    assert.equal(byId['session-registry'].cwd, 'D:\\proj');
    assert.equal(byId['session-plain'].sizeBytes, 20);
    // A missing registry still reports the sessions it can see.
    const noRegistry = await diskSessionReport({
        get: (name) => (name === 'sessionPersistence'
            ? { list: async () => [{ header: { id: 'x' }, revision: 'r' }] }
            : undefined),
    });
    assert.equal(noRegistry.sessions[0].archived, false);
});

test('the state report degrades when services are missing', async () => {
    assert.deepEqual(await diskSessionReport({ get: () => undefined }),
        { persistence: false, sessions: [] });
});

// ── the background-job gate, driven for real ───────────────────────────────
//
// The source assertions above pin the call SHAPE; this drives the actual
// residency + job gate with stub services, which is what catches the class of
// regression that mattered: the old call received the Agent object instead of
// the session id, so the gate never saw the session's own jobs at all.

/**
 * A context whose only services are `agents` (one strictly-idle resident) and
 * a recording `jobs` service. `sessions` is deliberately absent: a session is
 * still considered resident through `agents`, which is the path the job gate
 * guards.
 */

// A `deleteSession` run below falls back to the durable restart queue when the
// job gate lets the session through, and that queue is written under the
// resolved harness home. Point it at a temp directory so the suite never touches
// the real `~/.dsh` (the deliverable's core promise).
const gateHome = await mkdtemp(join(tmpdir(), 'dsh-purge-gate-'));
const priorDshHome = process.env.DSH_HOME;
process.env.DSH_HOME = gateHome;
after(() => {
    if (priorDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = priorDshHome;
    return rm(gateHome, { recursive: true, force: true });
});

/** @see the doc comment above for the shape this returns. */
function stubResidentCtx(jobRows) {
    const seenCallers = [];
    const agent = {
        id: 'session-gate',
        // The gate prefers `agent.session.id`, the exact branded SessionId the
        // job registry compares `job.owner` against.
        session: { id: 'session-gate' },
        status: 'idle',
        phase: { kind: 'idle' },
        scope: { dispose: async () => {} },
    };
    const services = {
        agents: { get: (id) => (id === agent.id ? agent : undefined), list: () => [agent] },
        jobs: {
            list: (caller) => {
                seenCallers.push(caller);
                return jobRows;
            },
        },
    };
    return { ctx: { get: (name) => services[name] }, agent, seenCallers };
}

/** One job row owned by `session-gate`, as `JobView` actually projects it. */
const ownedJob = (status) => ({ id: 'job-1', kind: 'bash', label: 'x', owner: 'session-gate', status });

test('an in-flight background job blocks the delete and the gate is asked for this session', async () => {
    for (const status of ['running', 'stopping']) {
        const stub = stubResidentCtx([ownedJob(status)]);
        const result = await deleteSession(stub.ctx, 'session-gate');
        assert.deepEqual(result, { ok: false, code: 'busy' }, `${status} must refuse with busy`);
        // The gate must be asked about THIS session. Registering the Agent
        // object made `job.owner === caller` never match, so a session's own
        // live jobs were invisible and the teardown proceeded.
        assert.deepEqual(stub.seenCallers, ['session-gate'],
            'jobs.list must receive the session id, never the agent object');
    }
});

test('a settled background job does not block the delete', async () => {
    // The registry RETAINS settled jobs, so a delete must not be refused forever
    // because some long-finished job is still listed.
    for (const status of ['completed', 'killed', 'failed', 'finished']) {
        const stub = stubResidentCtx([ownedJob(status)]);
        const result = await deleteSession(stub.ctx, 'session-gate');
        // No persistence service here, so the delete itself cannot proceed and
        // the runtime fallback queues it — the point is that the job gate did
        // NOT refuse it with 'busy'.
        assert.notEqual(result.code, 'busy', `${status} must not be treated as in-flight`);
        assert.equal(result.ok, true);
        assert.equal(result.mode, 'queued');
    }
});

test('a live job this session does not own cannot refuse its delete', async () => {
    // `jobs.list(id)` also returns UNOWNED jobs (visible to every caller), so
    // the gate must filter by owner first: otherwise any stray unowned job, or
    // another session's job, would refuse this delete forever.
    for (const rows of [
        [{ id: 'job-open', kind: 'bash', label: 'x', status: 'running' }],
        [{ id: 'job-other', kind: 'bash', label: 'x', owner: 'session-elsewhere', status: 'running' }],
        [ownedJob('completed'), { id: 'job-open', kind: 'bash', label: 'x', status: 'running' }],
    ]) {
        const stub = stubResidentCtx(rows);
        const result = await deleteSession(stub.ctx, 'session-gate');
        assert.notEqual(result.code, 'busy', 'a job this session does not own must not block it');
        assert.equal(result.mode, 'queued');
    }
});

test('an unreadable job status refuses rather than guessing', async () => {
    // Owned, so it is this session's work and an unknown status is unsafe.
    const stub = stubResidentCtx([{ id: 'job-1', kind: 'bash', label: 'x', owner: 'session-gate' }]);
    assert.deepEqual(await deleteSession(stub.ctx, 'session-gate'), { ok: false, code: 'busy' });
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

// ── locale resolution must not depend on entry activation order ────────────
//
// `apply()` captures `ctx.get("locale")`, but the client entry graph does not
// guarantee the locale row is active first. Before this suite existed the
// service was bound once in apply() and never re-resolved, so a plugin mounted
// early would fall back to Chinese forever. `tr` now resolves through a lazy
// lookup; these cases drive the REAL `tr` with a context whose locale appears
// only after mount.

test('tr follows a locale service that is not active yet at mount time', () => {
    assert.equal(typeof clientModule.__testMountLocale, 'function');
    assert.equal(typeof MENU.tr, 'function');

    // Mount with NO locale service at all, the way an early entry sees it.
    clientModule.__testMountLocale({ get: () => undefined });
    assert.equal(MENU.tr('menu.deleteSession'), '删除会话');

    // The locale row activates after mount; a later render must pick it up.
    clientModule.__testMountLocale({ get: (name) => (name === 'locale' ? { getLocale: () => ({ active: 'en' }) } : undefined) });
    assert.equal(MENU.tr('menu.deleteSession'), 'Delete session');
    assert.equal(MENU.tr('error.live'), 'Session is running — stop it (or let it finish), then delete');
    // Interpolation and the unknown-key fallback still work in the en path.
    assert.equal(MENU.tr('dialog.done', { name: 'Alpha' }), 'Deleted session “Alpha”.');
    assert.equal(MENU.tr('no.such.key'), 'no.such.key');
});

test('tr tolerates a broken or missing locale service', () => {
    // A throwing accessor must not break a dialog render.
    clientModule.__testMountLocale({ get() { throw new Error('fiber disposed'); } });
    assert.equal(MENU.tr('menu.deleteSession'), '删除会话');
    // A locale service without getLocale(), and a snapshot with no `active`.
    clientModule.__testMountLocale({ get: () => ({}) });
    assert.equal(MENU.tr('menu.deleteSession'), '删除会话');
    clientModule.__testMountLocale({ get: () => ({ getLocale: () => null }) });
    assert.equal(MENU.tr('menu.deleteSession'), '删除会话');
    // No mounting at all is still safe (the fallback path is a dictionary hit).
    assert.equal(typeof MENU.tr('menu.deleteSession'), 'string');
});

test('the locale lookup is lazy, not a one-shot capture at apply time', () => {
    // Structural backstop: `tr` must reach the locale through `liveLocale()`.
    // Re-binding `localeService` directly inside `tr` would reintroduce the
    // apply-time capture this fix removed.
    assert.match(clientSrc, /function liveLocale\(\)/u);
    assert.match(clientSrc, /var locale = liveLocale\(\);/u);
    assert.match(clientSrc, /ctxRef\.get\("locale"\)/u);
});

test('the client inject list names only packages that exist', () => {
    // `@deepseek-ai/dsh-client-runtime` was removed upstream; an unknown inject
    // name is skipped silently at boot, so a stale entry is invisible dead
    // metadata. The client module requires only react and react-dom/client, so
    // the locale entry is the one dependency edge worth declaring.
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const inject = pkg.dsh.client.inject;
    assert.deepEqual(inject, ['@deepseek-ai/dsh-client-locale']);
    assert.equal(inject.includes('@deepseek-ai/dsh-client-runtime'), false,
        'the removed dsh-client-runtime package came back into the inject list');
});

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


