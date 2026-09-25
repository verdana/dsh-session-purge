/**
 * End-to-end proof harness: runs the FIXED `removeSessionLog` from `lib/index.js`
 * against the REAL dsh-session-persistence-jsonl backend, over a throwaway copy
 * of a real session log directory.
 *
 * It prints the pre-fork lookup decision side by side, so the difference between
 * "always reports unknown / unsupported" and "actually deletes" is observed
 * rather than asserted.
 *
 * Run: node tools/repro-delete.mjs
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessionDirectoryFromLogPath, snapshotSessionId } from '../lib/index.js';

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const SESSIONS_ROOT = join(DSH_HOME, 'sessions');

/** Locate the JSONL backend inside an installed dsh-web-app bundle. */
async function resolveBackend() {
    const explicit = process.env.DSH_WEB_APP_DIR;
    if (explicit !== undefined && explicit !== '') {
        const found = await findBackendUnder(explicit);
        if (found !== undefined) return found;
    }
    // Preferred on a checkout and in CI: the dev dependency installed here.
    const local = fileURLToPath(new URL(
        '../node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js',
        import.meta.url,
    ));
    if (existsSync(local)) return local;
    // Otherwise the pnpm global layout, by platform:
    //   Windows  %LOCALAPPDATA%\pnpm\global\v11\<hash>\node_modules\.pnpm\...
    //   Linux    $XDG_DATA_HOME|~/.local/share/pnpm/global/v11/<hash>/...
    //   macOS    ~/Library/pnpm/global/v11/<hash>/...
    const globalRoots = [
        process.env.PNPM_GLOBAL_DIR,
        process.env.LOCALAPPDATA === undefined
            ? undefined
            : join(process.env.LOCALAPPDATA, 'pnpm', 'global', 'v11'),
        join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'pnpm', 'global', 'v11'),
        join(homedir(), 'Library', 'pnpm', 'global', 'v11'),
    ].filter((root) => root !== undefined && existsSync(root));
    for (const global of globalRoots) {
        for (const entry of await safeReaddir(global)) {
            if (!entry.isDirectory()) continue;
            const found = await findBackendUnder(join(global, entry.name, 'node_modules', '.pnpm'));
            if (found !== undefined) return found;
        }
    }
    throw new Error(
        'could not locate dsh-session-persistence-jsonl; run `pnpm install` (dev dependency) '
        + 'or set DSH_WEB_APP_DIR to the directory containing node_modules/@deepseek-ai '
        + `(searched: ${globalRoots.join(', ') || 'nothing'})`,
    );
}

async function findBackendUnder(dir) {
    const nested = join(dir, 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js');
    if (existsSync(nested)) return nested;
    for (const entry of await safeReaddir(dir)) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('@deepseek-ai+dsh-session-pe')) continue;
        const candidate = join(
            dir, entry.name, 'node_modules', '@deepseek-ai',
            'dsh-session-persistence-jsonl', 'lib', 'index.js',
        );
        if (existsSync(candidate)) return candidate;
    }
    return undefined;
}

async function safeReaddir(dir) {
    try {
        return await readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
}

/** Minimal cordis-ish context: the backend and the plugin only need these. */
function fakeCtx(snapshot, location) {
    return {
        on() {},
        effect(callback) {
            return callback();
        },
        reflect: { provide() {} },
        logger: { warn() {}, info() {}, debug() {} },
        get(name) {
            if (name === 'sessionPersistence') {
                return {
                    list: async () => snapshot.list(),
                    locate: (meta) => location.locate(meta),
                };
            }
            if (name === 'workspaceRegistry') return undefined;
            return undefined;
        },
    };
}

/**
 * Pick a small real session directory to copy, when the machine has one.
 * Returns undefined on a clean checkout (CI): the harness then materializes its
 * own fixture through the backend, so a run never depends on user data.
 */
async function pickSourceSession() {
    for (const project of await safeReaddir(SESSIONS_ROOT)) {
        if (!project.isDirectory()) continue;
        const projectDir = join(SESSIONS_ROOT, project.name);
        for (const entry of await safeReaddir(projectDir)) {
            if (!entry.isDirectory()) continue;
            const dir = join(projectDir, entry.name);
            if (existsSync(join(dir, 'session.v3.jsonl.zstd'))) {
                return { id: entry.name, dir, project: project.name };
            }
        }
    }
    return undefined;
}

const backendPath = await (async () => {
    try {
        return await resolveBackend();
    }
    catch (error) {
        // A checkout without a reachable dsh install cannot run this check.
        // Say so plainly and exit 0, so `npm test`-style runs stay meaningful.
        console.log(`SKIP: ${String(error?.message ?? error)}`);
        console.log('      (install dsh, or set DSH_WEB_APP_DIR, to run the end-to-end check)');
        process.exit(0);
    }
})();
const { default: JsonlSessionPersistence } = await import(`file://${backendPath.replace(/\\/g, '/')}`);
const { removeSessionLog } = await import('../lib/index.js');

// Throwaway root laid out exactly like ~/.dsh/sessions.
const root = await mkdtemp(join(tmpdir(), 'dsh-purge-'));
const backend = new JsonlSessionPersistence(
    { on() {}, effect: (cb) => cb(), reflect: { provide() {} }, logger: console },
    { root, compression: 'zstd' },
);

const source = await pickSourceSession();
let realUntouched = true;
if (source !== undefined) {
    const projectDir = join(root, source.project);
    await mkdir(projectDir, { recursive: true });
    await cp(source.dir, join(projectDir, source.id), { recursive: true });
}
else {
    // No user log available: materialize a fixture with the backend itself, so
    // CI exercises the same list()/locate()/delete path without any user data.
    const project = join(root, '--dsh-purge-fixture--');
    await mkdir(project, { recursive: true });
    const handle = await backend.create({
        version: 3,
        id: `session-${randomUUID()}`,
        createdAt: Date.now(),
        cwd: project,
        isSeeded: false,
        delegationDepth: 0,
    });
    await handle.flush();
    await handle.close();
}

const snapshots = await backend.list();
const snapshot = snapshots[0];
const sessionId = snapshotSessionId(snapshot);
const located = backend.locate(snapshot.header);
const derived = sessionDirectoryFromLogPath(located.path);

console.log('backend           :', backendPath.replace(/\\/g, '/').split('/.pnpm/')[1] ?? backendPath);
console.log('fixture           :', source === undefined
    ? 'created by the backend (no user log needed)'
    : `copied from ${source.id}`);
console.log('list() snapshot   :', Object.keys(snapshot).join(', '));
console.log('snapshotSessionId :', sessionId);
console.log('locate().path     :', located.path);
console.log('derived dir       :', derived);

// The pre-fork logic, for contrast: match on the snapshot root and split on "/".
const preForkMatched = snapshots.some((h) => h?.id === sessionId);
console.log('\n[before] h.id === sessionId            :', preForkMatched, '-> would report "unknown"');
console.log('[before] path.lastIndexOf("/")         :', located.path.lastIndexOf('/'));

const ctx = fakeCtx(backend, backend);
const result = await removeSessionLog(ctx, sessionId);
console.log('\n[after ] removeSessionLog ->', JSON.stringify(result));
console.log('[after ] directory gone       :', derived !== undefined && !existsSync(derived));
console.log('[after ] backend.list() length:', (await backend.list()).length);

if (source !== undefined) {
    // Only a copy is ever deleted; the user's real log must be untouched.
    realUntouched = existsSync(join(source.dir, 'session.v3.jsonl.zstd'));
    console.log('real log untouched            :', realUntouched);
}

await rm(root, { recursive: true, force: true });
if (!result.ok || derived === undefined || existsSync(derived) || !realUntouched) {
    process.exitCode = 1;
}
