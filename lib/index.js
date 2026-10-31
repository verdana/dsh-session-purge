/**
 * dsh-session-purge — host half.
 *
 * Two layers live here:
 *
 * 1. The **recycle bin** (default path for "delete a session"): the session's
 *    directory is moved aside, byte-for-byte, into `<DSH_HOME>/session-purge/
 *    trash/`; it can be restored to its exact original path or permanently
 *    deleted, and a retention policy sweeps expired entries.
 * 2. The original **permanent delete** primitives, kept for the internal
 *    permanent-delete path and for regression tests.
 *
 * Routes:
 *  - GET  /session-purge/trash      → every recycle-bin entry + settings + sweep state.
 *  - POST /session-purge/trash      → move one session into the bin (soft delete).
 *  - POST /session-purge/restore    → move one entry back to its original directory.
 *  - POST /session-purge/purge      → permanently delete one entry.
 *  - POST /session-purge/empty      → permanently delete every entry.
 *  - POST /session-purge/sweep      → run the retention sweep now.
 *  - GET  /session-purge/settings   → the plugin's own settings.
 *  - POST /session-purge/settings   → validated partial settings update.
 *  - GET  /session-purge/state      → disk ground truth (sessions + bin summary).
 *  - POST /session-purge/delete     → DEPRECATED alias of /trash (kept so an
 *    already-loaded browser bundle cannot hard-delete by accident).
 *  - POST /session-purge/undo       → removes a session from the fallback queue.
 *
 * Recycle-bin model:
 *  - Moving a session aside changes only the filesystem: the persistence
 *    backend discovers sessions by scanning `sessions/`, so a moved directory
 *    disappears from every listing and a restored one reappears — no index to
 *    invalidate. Restoring must land on the session's EXACT original path:
 *    the backend verifies a log against the path its own header derives and
 *    rejects (throws, failing the whole listing) on a mismatch, so the entry
 *    metadata stores the proven original directory rather than re-deriving the
 *    project key.
 *  - The bin lives OUTSIDE `sessions/`: the backend treats every subdirectory
 *    of the sessions root as a project and every directory below that as a
 *    session, so a bin inside it would be listed as normal sessions.
 *  - A resident session is torn down first (the kernel write lock follows the
 *    moved directory). A busy/live session is refused; when the runtime
 *    internals needed to release it are missing, the session is queued for the
 *    next boot exactly as the permanent path does.
 *
 * Permanent-delete model (unchanged):
 *  - No resident agent → delete the log directory directly.
 *  - Resident agent, strictly idle (phase.kind === 'idle', no running jobs) →
 *    reproduce the official AgentHandle.dispose() teardown sequence through
 *    the same runtime primitives it drives:
 *      1. flush the session's pending durable writes;
 *      2. dispose the agent's scope fiber (the driver can no longer wake);
 *      3. detach the agent from the agents registry (emits agent/disposed);
 *      4. detach the session from the sessions store (emits session/disposed,
 *         so the UI drops the row immediately);
 *    then remove the log directory. Nothing can append afterwards: message
 *    routing goes through the registries and the driver lives in the disposed
 *    fiber.
 *  - Resident agent mid-turn or in maintenance (compaction etc.) → refuse
 *    with 'live'/'busy': stop the session (or let it finish) and retry.
 *  - If the runtime internals this relies on are missing (future dsh build),
 *    fall back to the persistent queue processed at next boot.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
    basename as pathBasename,
    dirname as pathDirname,
    isAbsolute as pathIsAbsolute,
    join as pathJoin,
    parse as pathParse,
    relative as pathRelative,
    resolve as pathResolve,
} from 'node:path';

export const name = 'session-purge';

/**
 * The host half's own version, read from the package manifest at load time.
 *
 * The settings page shows it in the footer, so it must be the version the
 * running host actually shipped, not a value copied into the browser bundle
 * (the two halves are loaded independently and a stale bundle is exactly the
 * case an update hint should catch). Reading package.json is cheap and works
 * both from the repo checkout and from an installed npm package (npm always
 * ships package.json, even when `files` lists only the runtime directories).
 */
export const version = (() => {
    try {
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        return typeof manifest.version === 'string' ? manifest.version : null;
    }
    catch {
        return null;
    }
})();

const MAX_BODY_BYTES = 8192;
const SCOPE_TEARDOWN_TIMEOUT_MS = 5000;

/**
 * Routine, expected refusals (a missing optional service, an unprovable path)
 * are worth a line only while diagnosing — otherwise they read as faults in an
 * otherwise healthy boot log. Faults that invalidate a user action still log
 * unconditionally. The flag is read per call so a test harness can set it.
 */
function debugLog(...args) {
    const value = process.env.DSH_PURGE_DEBUG;
    if (value === '1' || value === 'true' || value === 'yes') {
        console.error('[session-purge]', ...args);
    }
}

/**
 * Canonical physical log filename inside a session directory
 * (`session.v3.jsonl.zstd` today; the version and compression suffixes vary).
 * Used to prove a located path really is a session log artifact before its
 * directory is removed.
 */
const LOG_FILENAME_RE = /^session(\.v\d+)?\.jsonl(\.zstd)?$/;

/**
 * The `JobStatus` values that mean "work is still in flight"
 * (`@deepseek-ai/dsh-jobs`: `'running' | 'stopping' | 'completed' | 'killed' |
 * 'failed'`). Only these two block a delete; the three terminal states do not,
 * and a settled job's row is RETAINED by the registry until someone removes it,
 * so treating an unrecognized status as active would refuse forever.
 */
const ACTIVE_JOB_STATUSES = ['running', 'stopping'];

/**
 * Resolve the DeepSeek Harness home the way the harness itself does
 * (`@deepseek-ai/dsh-home-paths`): the boot-provided `dshHomePath` accessor
 * first, then `$DSH_HOME`, then `~/.dsh`. Mirroring that precedence matters for
 * the durable fallback queue — writing it to `~/.dsh` while the running
 * harness uses a relocated home would queue a deletion nobody ever processes.
 *
 * `dshHomePath` is a FUNCTION (from dsh-app-boot), not a string: resolve it
 * through `ctx.get()` (a `ctx.dshHomePath` property read throws when the fiber
 * lacks the inject declaration) and call it. The string form is still accepted
 * for older shells and for tests.
 * @param ctx - host context; may expose `dshHomePath` (from dsh-app-boot).
 * @returns the absolute harness home directory.
 */
export function resolveHome(ctx) {
    let provided;
    // dsh-app-boot provides `dshHomePath` as a function; ctx.get() is readable
    // without the inject declaration, and the call expands $DSH_HOME / ~.
    try {
        provided = typeof ctx?.get === 'function' ? ctx.get('dshHomePath') : undefined;
        if (typeof provided === 'function') provided = provided();
    }
    catch {
        provided = undefined;
    }
    if (typeof provided !== 'string' || provided.trim() === '') {
        // Legacy contexts (and the regression suite) expose the resolved home as
        // a plain property. A real Cordis service proxy throws on this read when
        // the fiber lacks the inject declaration, so it must stay guarded.
        try {
            provided = ctx?.dshHomePath;
        }
        catch {
            provided = undefined;
        }
    }
    if (typeof provided === 'string' && provided.trim() !== '') return provided;
    const fromEnv = process.env.DSH_HOME;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
    return pathJoin(homedir(), '.dsh');
}

/**
 * Queue locations, in read order: the current file first, then the file the
 * pre-rename plugin wrote, so an upgrade never loses a pending deletion.
 * @returns the absolute pending-queue paths.
 */
function pendingPaths(ctx) {
    const home = resolveHome(ctx);
    return {
        current: pathJoin(home, 'session-purge', 'pending.json'),
        legacy: pathJoin(home, 'session-delete', 'pending.json'),
    };
}

function sendJson(response, status, value) {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(JSON.stringify(value));
}

/** A present Origin must match the request Host (same-origin browsers only). */
function sameOrigin(request) {
    const origin = request.headers.origin;
    if (origin === undefined || origin === '') return true;
    try {
        const host = request.headers.host;
        return host !== undefined && new URL(origin).host === host;
    }
    catch {
        return false;
    }
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        request.on('data', (chunk) => {
            if (tooLarge) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                // Do NOT destroy the socket here. The route still has to answer,
                // and writing to a destroyed request is what turned a contract
                // refusal into an ECONNRESET on the client. Stop buffering (memory
                // stays capped), let the rest of the body drain, and reject at
                // 'end' so the response reaches a live socket. Draining an
                // over-limit body is cheap on a same-origin local route; a
                // cross-origin POST never reaches here (sameOrigin refuses it).
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (tooLarge) {
                const error = new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
                error.code = 'too-large';
                reject(error);
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch (error) {
                reject(error);
            }
        });
        request.on('error', reject);
    });
}

/** HTTP status for a body read that threw: over the cap is 413, malformed is 400. */
function bodyStatus(error) {
    return error?.code === 'too-large' ? 413 : 400;
}

/** The JSON body a route sends back when `readJsonBody` refused the request. */
function bodyFailure(error) {
    return {
        ok: false,
        code: error?.code === 'too-large' ? 'too-large' : 'bad-request',
        error: String(error?.message ?? error),
    };
}

function validSessionId(id) {
    return typeof id === 'string' && id !== '' &&
        !id.includes('/') && !id.includes('\\');
}

// ── persistence-shape helpers (the two bugs this fork exists to fix) ─────────

/**
 * Read a session id out of one `sessionPersistence.list()` snapshot.
 *
 * The service contract returns `SessionPersistenceSnapshot` objects —
 * `{ header, revision, sizeBytes? }` — so the id lives at `header.id`; a
 * snapshot has no top-level `id` (see
 * `@deepseek-ai/dsh-session-persistence`). Tolerating both shapes keeps the
 * lookup working if a future backend ever flattens it.
 * @param snapshot - one entry of `sessionPersistence.list()`.
 * @returns the id, or undefined when this entry carries none.
 */
export function snapshotSessionId(snapshot) {
    if (snapshot === null || snapshot === undefined || typeof snapshot !== 'object') {
        return undefined;
    }
    const header = snapshot.header;
    if (header !== null && header !== undefined && typeof header.id === 'string') {
        return header.id;
    }
    return typeof snapshot.id === 'string' ? snapshot.id : undefined;
}

/** Find the stored snapshot for one session id. */
export function findSessionSnapshot(snapshots, sessionId) {
    const list = Array.isArray(snapshots) ? snapshots : [];
    return list.find((snapshot) => snapshotSessionId(snapshot) === sessionId);
}

/**
 * Is any job belonging to this session still in flight?
 *
 * Two things make the obvious check wrong:
 *  - `jobs.list(caller)` returns the caller's jobs **plus every unowned job**
 *    (an unowned job is visible to all callers), so the rows must be filtered by
 *    owner first. Otherwise some unrelated unowned job could refuse a delete
 *    forever. Upstream's own archive admission filters the same way.
 *  - Only `running`/`stopping` are in flight. The registry RETAINS settled jobs
 *    until a caller removes them, so an inverted test such as
 *    `status !== 'finished'` would report a long-finished job as active
 *    forever and refuse every delete with `busy`.
 *
 * An entry with no readable status counts as in flight: refusing is the safe
 * side of this gate.
 *
 * Exported as `@internal` for the regression tests; not plugin API.
 * @param jobs - one `jobs.list(sessionId)` result.
 * @param sessionId - the session whose delete is being considered.
 * @returns true when at least one of ITS jobs still has work in flight.
 */
export function hasActiveJob(jobs, sessionId) {
    const list = Array.isArray(jobs) ? jobs : [];
    return list.some((job) => {
        if (job === null || job === undefined || typeof job !== 'object') return false;
        // An owner that names a different session is not this session's work.
        // A missing owner is an unowned job, which no session owns.
        if (job.owner !== sessionId) return false;
        if (typeof job.status !== 'string') return true;
        return ACTIVE_JOB_STATUSES.includes(job.status);
    });
}

/** Host path flavor, so the default parameter stays platform-correct on POSIX too. */
const pathApiDefault = {
    basename: pathBasename,
    dirname: pathDirname,
    isAbsolute: pathIsAbsolute,
    join: pathJoin,
    parse: pathParse,
    relative: pathRelative,
    resolve: pathResolve,
};

/**
 * Derive the session directory to remove from a backend `locate()` path.
 *
 * `location.path` is a native path built by `node:path.join`, so on Windows it
 * is backslash-separated: splitting on `/` (as the pre-fork code did) never
 * finds the session directory and always refused with `unsupported`. This uses
 * `node:path` so the same code works on every platform.
 *
 * Safety: the parent directory is only ever accepted when the artifact itself
 * is a canonical session log filename, so a mis-located path can never turn
 * into a delete of some unrelated directory.
 * @param locationPath - `sessionPersistence.locate(meta).path`.
 * @param pathApi - path flavor to interpret the string with; defaults to the
 *   host's. Injectable so POSIX semantics stay testable from Windows.
 * @returns the session directory, or undefined when it cannot be proven.
 */
export function sessionDirectoryFromLogPath(locationPath, pathApi = pathApiDefault) {
    if (typeof locationPath !== 'string' || locationPath === '' ||
        !pathApi.isAbsolute(locationPath)) {
        return undefined;
    }
    if (!LOG_FILENAME_RE.test(pathApi.basename(locationPath))) return undefined;
    const dir = pathApi.dirname(locationPath);
    // A relative spelling, a bare filename, or a log sitting directly in the
    // filesystem root never identifies a session-owned directory. (`basename`
    // returning a separator catches a trailing-separator root.)
    if (dir === '' || dir === '.' || dir === locationPath ||
        dir === pathApi.parse(dir).root || pathApi.basename(dir) === dir) {
        return undefined;
    }
    return dir;
}

// ── fallback queue (durable; only used when direct teardown is impossible) ──

async function readPending(ctx) {
    const { current, legacy } = pendingPaths(ctx);
    const ids = [];
    // allSettled, not a sequential await: one unreadable queue file must not
    // hide the entries in the other.
    for (const settled of await Promise.allSettled(
        [current, legacy].map((path) => readFile(path, 'utf8')),
    )) {
        if (settled.status !== 'fulfilled') continue;
        try {
            const parsed = JSON.parse(settled.value);
            if (Array.isArray(parsed?.pending)) {
                ids.push(...parsed.pending.filter(validSessionId));
            }
        }
        catch {
            /* malformed queue file → contributes nothing */
        }
    }
    return [...new Set(ids)];
}

async function writePending(ctx, ids) {
    const path = pendingPaths(ctx).current;
    await mkdir(pathDirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ pending: ids }, null, 2)}\n`, 'utf8');
    await rename(tmp, path);
}

/**
 * Read a service, tolerating a provider whose accessors throw (a faulted
 * runtime must degrade to "missing service", never fail the request).
 *
 * Exported as `@internal` for the regression tests; not plugin API.
 * @param ctx - host context.
 * @param name - service name.
 * @param method - required method name, when the caller needs one.
 * @returns the service, or undefined when absent/unusable.
 */
export function service(ctx, name, method) {
    let value;
    try {
        value = typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
    }
    catch (error) {
        // Expected when a provider's fiber is gone; not a fault worth shouting about.
        debugLog(`service "${name}" unavailable:`, error?.message ?? error);
        return undefined;
    }
    if (value === undefined || value === null) return undefined;
    if (method !== undefined && typeof value[method] !== 'function') return undefined;
    return value;
}

/** Collect the session ids that currently have a resident in-memory agent. */
function residentSessionIds(ctx) {
    const held = new Set();
    try {
        const agents = service(ctx, 'agents');
        if (agents !== undefined) {
            for (const agent of agents.list()) held.add(agent.id);
        }
        const sessions = service(ctx, 'sessions');
        if (sessions !== undefined) {
            for (const session of sessions.list()) held.add(session.id);
        }
    }
    catch (error) {
        console.error('[session-purge] resident listing failed:', error);
    }
    return [...held];
}

/**
 * One session as the disk actually holds it right now: what the persistence
 * service lists, whether it is resident, and how it is grouped. This is the
 * ground truth a GUI report can be checked against without reading the logs.
 *
 * Exported as `@internal` so the regression suite can drive it with stub
 * services; not plugin API.
 * @param ctx - host context.
 * @returns `{ persistence, sessions }`, where each session carries the
 *   `archived` flag the registry-level archive set provides.
 */
export async function diskSessionReport(ctx) {
    const persistence = service(ctx, 'sessionPersistence', 'list');
    if (persistence === undefined) {
        return { persistence: false, sessions: [] };
    }
    const resident = new Set(residentSessionIds(ctx));
    const archived = new Set();
    try {
        const workspaces = service(ctx, 'workspaceRegistry', 'list');
        if (workspaces !== undefined) {
            // The archive set is REGISTRY-global: `workspaceRegistry`
            // .archivedSessionIds. A `Workspace` entry (`list()` rows) carries
            // only id/path/title/createdAt/updatedAt/sessionIds and its own
            // methods — it has NO `archivedSessionIds`, so the earlier
            // per-entry read always yielded nothing and this report claimed
            // every session was unarchived.
            //
            // The registry is the SOLE authority here: a per-entry read is kept
            // only as a union fallback for a hypothetical backend that scopes
            // the set that way, and it can never un-archive what the registry
            // archived.
            for (const id of workspaces.archivedSessionIds ?? []) archived.add(id);
            for (const workspace of workspaces.list()) {
                for (const id of workspace.archivedSessionIds ?? []) archived.add(id);
            }
        }
    }
    catch (error) {
        /* grouping is advisory for diagnostics */
        console.error('[session-purge] grouping read failed:', error);
    }
    const snapshots = await persistence.list();
    const sessions = (Array.isArray(snapshots) ? snapshots : []).map((snapshot) => {
        const id = snapshotSessionId(snapshot);
        const header = snapshot?.header ?? {};
        return {
            id: id ?? null,
            // `SessionHeader` carries no display title (id, version, createdAt,
            // cwd?, parentSession?, isSeeded, origin?, delegationDepth?,
            // agentPreset?); titles are session EVENTS written by
            // dsh-session-title, so the persistence layer cannot supply one.
            // Reporting `header.title` here would always be null while looking
            // like a real read — the GUI shows the title it captured from the
            // DOM instead, so this diagnostic names only what storage knows.
            title: null,
            cwd: header.cwd ?? null,
            sizeBytes: snapshot?.sizeBytes ?? null,
            resident: id !== undefined && resident.has(id),
            archived: id !== undefined && archived.has(id),
        };
    });
    return { persistence: true, sessions };
}

// ── deletion core ──────────────────────────────────────────────────────────

/**
 * Resolve one session's on-disk directory through the persistence backend's
 * own `locate()` hook, proving the artifact really is a session log before any
 * caller moves or removes it.
 *
 * Shared by the permanent-delete path and the recycle bin so the safety gate
 * has exactly one implementation. Exported as `@internal` for the regression
 * suite; not plugin API.
 * @param ctx - host context.
 * @param sessionId - the session to locate.
 * @returns `{ ok: true, id, dir, sessionsRoot, cwd, logPath }`, or
 *   `{ ok: false, code: 'invalid' | 'unavailable' | 'unknown' | 'storage' | 'unsupported' }`.
 */
export async function locateSessionDirectory(ctx, sessionId) {
    if (!validSessionId(sessionId)) return { ok: false, code: 'invalid' };
    // `list` and `locate` are both required: a backend without `locate` cannot
    // tell us which directory to act on, and saying "unsupported" is clearer
    // than a TypeError.
    const persistence = service(ctx, 'sessionPersistence', 'list');
    if (persistence === undefined || typeof persistence.locate !== 'function') {
        return { ok: false, code: 'unavailable' };
    }
    let snapshot;
    let location;
    let resolvedId;
    try {
        const snapshots = await persistence.list();
        snapshot = findSessionSnapshot(snapshots, sessionId);
        if (snapshot === undefined) return { ok: false, code: 'unknown' };
        resolvedId = snapshotSessionId(snapshot);
        // `locate` is a backend diagnostic hook and takes the stored header.
        // Flattened snapshots are tolerated, as in `snapshotSessionId`.
        location = persistence.locate(snapshot.header ?? snapshot);
    }
    catch (error) {
        // A storage fault is not "no such session": say so instead of letting
        // the throw become a malformed-request response.
        console.error('[session-purge] persistence lookup failed:', error);
        return { ok: false, code: 'storage' };
    }
    if (location === undefined || typeof location.path !== 'string') {
        return { ok: false, code: 'unsupported' };
    }
    const dir = sessionDirectoryFromLogPath(location.path);
    if (dir === undefined) {
        // Refusing to touch an unprovable directory is a safety decision the
        // operator may need to see.
        console.error('[session-purge] refusing unprovable session directory for',
            resolvedId ?? sessionId, 'from', location.path);
        return { ok: false, code: 'unsupported' };
    }
    // `<sessionsRoot>/<projectKey>/<encodedId>` → two levels above the session
    // directory. The stored entry needs this to prove a restore destination.
    const sessionsRoot = pathDirname(pathDirname(dir));
    const cwd = snapshot?.header?.cwd ?? snapshot?.cwd;
    return {
        ok: true,
        id: resolvedId ?? sessionId,
        dir,
        sessionsRoot,
        cwd: typeof cwd === 'string' && cwd !== '' ? cwd : null,
        logPath: location.path,
    };
}

/**
 * Locate and remove one session's log directory, then archive it away from
 * grouping surfaces. No liveness checks — the caller decides when this is safe.
 *
 * Kept for the permanent-delete path (and its regression tests); the recycle
 * bin moves directories instead of removing them.
 *
 * Exported as `@internal` purely so `tools/repro-delete.mjs` can drive the real
 * deletion path against the real persistence backend; it is not plugin API.
 * @returns { ok: true, dir } or { ok: false, code }.
 */
export async function removeSessionLog(ctx, sessionId) {
    const located = await locateSessionDirectory(ctx, sessionId);
    if (!located.ok) return located;
    const { dir } = located;
    sessionId = located.id;
    try {
        await removeDirectoryWithRetry(dir);
    }
    catch (error) {
        console.error('[session-purge] rm failed:', error);
        return { ok: false, code: 'rm' };
    }
    const workspaces = service(ctx, 'workspaceRegistry');
    let archived = false;
    if (workspaces !== undefined) {
        try {
            await workspaces.archiveSession(sessionId);
            archived = true;
        }
        catch {
            /* best effort: hide the row from grouping surfaces */
        }
    }
    // `name` is part of the response shape but always null: `SessionHeader` has
    // no display title (titles are session events). The dialog prefers the title
    // it captured from the DOM row, so this stays a documented absent field
    // rather than a read that silently never matches.
    console.log('[session-purge] removed', sessionId, 'from', dir, archived ? '(archived)' : '');
    return { ok: true, dir, archived, name: null };
}

/**
 * Tear down a resident, strictly-idle session through the same primitives the
 * official AgentHandle.dispose() teardown drives, so nothing can append to
 * the log after it returns.
 * @returns { ok: true } | { ok: false, code: 'live' | 'busy' } (refuse: stop
 * the session first) | { ok: false, code: 'held' } (internals unavailable).
 */
async function tearDownResident(ctx, sessionId) {
    const agents = service(ctx, 'agents');
    const sessions = service(ctx, 'sessions');
    let agent;
    let session;
    try {
        agent = agents !== undefined ? agents.get(sessionId) : undefined;
        session = sessions !== undefined ? sessions.get(sessionId) : undefined;
    }
    catch (error) {
        console.error('[session-purge] resident lookup failed:', error);
        return { ok: false, code: 'held' };
    }

    if (agent !== undefined) {
        // Strict idle gate: refuse anything mid-turn or in maintenance.
        if (agent.status !== 'idle') return { ok: false, code: 'live' };
        if (agent.phase === undefined || agent.phase === null ||
            agent.phase.kind !== 'idle') {
            return { ok: false, code: 'busy' };
        }
        // Belt and suspenders: a running background job would try to deliver
        // its result into this session; ask the user to let it settle first.
        const jobs = service(ctx, 'jobs', 'list');
        if (jobs !== undefined) {
            try {
                // `jobs.list(caller?)` takes a SessionId and returns the jobs
                // owned by that session PLUS every unowned job. Passing the
                // Agent OBJECT never matched an owner, so this gate silently saw
                // only unowned jobs and let a session with live background work
                // be torn down. `agent.session.id` is the same branded
                // SessionId the registry compares against `job.owner`.
                const sessionId = agent.session !== undefined && agent.session !== null
                    ? agent.session.id
                    : agent.id;
                const snapshots = jobs.list(sessionId);
                if (hasActiveJob(snapshots, sessionId)) return { ok: false, code: 'busy' };
            }
            catch {
                /* jobs listing is advisory; proceed */
            }
        }
    }

    // Internals availability gate — without these, fall back to the queue.
    if (agent !== undefined) {
        if (agents.store === undefined || typeof agents.store.get !== 'function' ||
            typeof agents.detachEntered !== 'function' ||
            agent.scope === undefined || typeof agent.scope.dispose !== 'function') {
            return { ok: false, code: 'held' };
        }
    }
    if (session !== undefined && (sessions.store === undefined ||
        typeof sessions.store.get !== 'function' ||
        typeof sessions.detachEntered !== 'function')) {
        return { ok: false, code: 'held' };
    }

    // 1) Flush any batched durable writes still pending for this session.
    if (sessions !== undefined && session !== undefined && typeof sessions.flush === 'function') {
        try {
            await sessions.flush(session);
        }
        catch {
            /* flush is best effort; the writer detaches below */
        }
    }

    // 2) Dispose the agent's scope fiber — the driver can no longer wake.
    if (agent !== undefined) {
        try {
            await Promise.race([
                agent.scope.dispose(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('scope teardown timeout')),
                        SCOPE_TEARDOWN_TIMEOUT_MS)),
            ]);
        }
        catch (error) {
            console.error('[session-purge] agent scope teardown issue:', error);
            // Continue: registry detach below is what actually stops routing.
        }
    }

    // 3) Detach the agent from its registry (idempotent by entry identity).
    let agentEntry;
    if (agent !== undefined) {
        agentEntry = agents.store.get(sessionId);
        if (agentEntry !== undefined) {
            try {
                agents.detachEntered(agentEntry);
            }
            catch (error) {
                console.error('[session-purge] agent detach failed:', error);
                return { ok: false, code: 'held' };
            }
        }
    }

    // 4) Detach the session from the store — emits session/disposed so the
    //    UI drops the row immediately.
    if (session !== undefined) {
        const entry = sessions.store.get(sessionId);
        if (entry !== undefined) {
            try {
                sessions.detachEntered(entry);
            }
            catch (error) {
                console.error('[session-purge] session detach failed:', error);
                // Roll the agent registration back: leaving it detached while
                // its session survives would strand a live agent in no registry.
                if (agentEntry !== undefined && typeof agents.enter === 'function') {
                    try {
                        agents.enter(agent, agentEntry.owner);
                    }
                    catch (rollbackError) {
                        console.error('[session-purge] agent re-registration failed:',
                            rollbackError);
                    }
                }
                return { ok: false, code: 'held' };
            }
        }
    }

    // Post-teardown verification: nothing resident may remain.
    if ((agents !== undefined && agents.get(sessionId) !== undefined) ||
        (sessions !== undefined && sessions.get(sessionId) !== undefined)) {
        return { ok: false, code: 'held' };
    }
    return { ok: true };
}

/**
 * Decide direct delete vs refusal vs fallback queue, then act.
 *
 * The batch of one session's PERMANENT delete. The recycle bin (the default
 * path) is {@link trashSession}; both share {@link gateAndRelease}.
 *
 * Exported as `@internal` so the regression suite can drive the real
 * residency + job gate with stub services; not plugin API.
 * @param ctx - host context.
 * @param sessionId - the session to delete.
 * @returns the same result shape the HTTP route serializes.
 */
export async function deleteSession(ctx, sessionId) {
    if (!validSessionId(sessionId)) return { ok: false, code: 'invalid' };
    const gate = await gateAndRelease(ctx, sessionId);
    if (!gate.ok) return gate;
    if (gate.queued === true) {
        console.log('[session-purge] queued (fallback)', sessionId);
        return { ok: true, mode: 'queued' };
    }
    const result = await removeSessionLog(ctx, sessionId);
    return { ...result, mode: 'deleted' };
}

/** Process the fallback queue at boot, before any session can be opened. */
async function processPendingQueue(ctx) {
    const pending = await readPending(ctx);
    if (pending.length === 0) return;
    // Ids this pass may drop; everything else stays queued.
    const settled = new Set();
    for (const id of pending) {
        try {
            const result = await trashSession(ctx, id, { reason: 'boot-queue' });
            if (result.ok === true) {
                // `queued` means the gate put the id back for a LATER boot (the
                // session is resident but its internals are unreachable). That is
                // the entire point of this queue, so it must survive this pass.
                if (result.mode !== 'queued') settled.add(id);
                continue;
            }
            // 'unknown' means the log is already gone: nothing left to do.
            if (result.code === 'unknown') settled.add(id);
        }
        catch (error) {
            console.error('[session-purge] boot queue entry failed:', id, error);
        }
    }
    // Re-read before writing: this pass can take a while, and `/undo` (or a
    // second delete) may have rewritten the queue meanwhile. Rebuilding it from
    // the live file — instead of overwriting it with what this pass remembers —
    // is what keeps such a write from being lost.
    const processed = new Set(pending);
    const live = await readPending(ctx);
    const remaining = live.filter((id) => !processed.has(id) || !settled.has(id));
    await writePending(ctx, remaining);
}

// ── recycle bin ────────────────────────────────────────────────────────────
//
// The bin is a directory of MOVED session directories, each paired with a
// sidecar metadata file:
//
//   <DSH_HOME>/session-purge/trash/<trashId>/        ← the session directory, as-is
//   <DSH_HOME>/session-purge/trash/<trashId>.json    ← entry metadata
//   <DSH_HOME>/session-purge/trash/.state.json       ← sweep bookkeeping
//
// The payload directory is named by a generated `trashId` rather than by the
// session id: it keeps the plugin independent of the backend's path encoding
// and makes collisions impossible. The metadata carries the PROVEN original
// directory, so a restore never re-derives (and never mis-derives) the
// lossy project key.
//
// Everything mutating is serialized through one promise chain: a sweep can
// never race a restore of the same entry.

/** Plugin identity recorded in entry metadata. */
const PLUGIN_ID = 'dsh-session-purge';

/** Bin layout under the harness home. */
function binPaths(ctx) {
    const base = pathJoin(resolveHome(ctx), 'session-purge');
    const trash = pathJoin(base, 'trash');
    return {
        base,
        trash,
        settings: pathJoin(base, 'settings.json'),
        sweepState: pathJoin(trash, '.state.json'),
    };
}

/** Settings defaults; the settings page edits exactly these fields. */
export const SETTINGS_DEFAULTS = Object.freeze({
    schema: 1,
    autoClean: true,
    retentionDays: 30,
    sweepOnBoot: true,
    sweepIntervalHours: 6,
    entryPlacement: 'icon',
});

/** Retention choices the settings UI offers (0 = keep forever). */
export const RETENTION_DAYS_CHOICES = Object.freeze([0, 7, 30, 90, 365]);

/**
 * Where the bin entry lives in the sidebar.
 *
 * `icon` is the workspace-row glyph plus the modal panel (the shape shipped
 * before this choice existed); `menu` is a row in the sidebar's global panel
 * list — the same column as 插件 / 自动化任务 — landing on a full page.
 */
export const ENTRY_PLACEMENTS = Object.freeze(['icon', 'menu']);

const DAY_MS = 86_400_000;
const SWEEP_TICK_MS = 15 * 60_000;
const TRASH_ID_RE = /^t-\d{8}T\d{6}-[0-9a-f]{6}$/;

/** Only ever deleted behind a proven containment check. */
const SESSION_ID_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

function isENOENT(error) {
    return error?.code === 'ENOENT';
}

/** Does this path exist? Only ENOENT is "no"; every other fault propagates. */
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch (error) {
        if (isENOENT(error)) return false;
        throw error;
    }
}

/**
 * Is `child` the same directory as `parent`, or inside it?
 *
 * Path flavor is injectable so POSIX semantics stay testable from Windows (the
 * same reason `sessionDirectoryFromLogPath` takes one). A relative or
 * absolute-escaping relationship is never "inside".
 * @param child - candidate descendant.
 * @param parent - candidate ancestor.
 * @param pathApi - path flavor; defaults to the host's.
 * @returns true when child resolves to parent or below it.
 */
export function pathInside(child, parent, pathApi = pathApiDefault) {
    if (typeof child !== 'string' || child === '' ||
        typeof parent !== 'string' || parent === '') {
        return false;
    }
    let relative;
    try {
        relative = pathApi.relative(pathApi.resolve(parent), pathApi.resolve(child));
    }
    catch {
        return false;
    }
    if (relative === '') return true;
    if (pathApi.isAbsolute(relative)) return false;
    return relative !== '..' && !relative.startsWith(`..${'/'}`) && !relative.startsWith(`..${'\\'}`);
}

/** Recursive removal with the retry loop Windows file locks need. */
async function removeDirectoryWithRetry(dir) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await rm(dir, { recursive: true, force: true });
            return;
        }
        catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    throw lastError;
}

/**
 * Build one bin entry id: `t-<UTC yyyyMMddTHHmmss>-<6 hex>`.
 * Exported as `@internal` for the regression suite; not plugin API.
 */
export function makeTrashId(now = Date.now(), token) {
    const at = new Date(now);
    const pad = (value, width = 2) => String(value).padStart(width, '0');
    const stamp = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`
        + `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
    const suffix = typeof token === 'string' && /^[0-9a-f]{6}$/.test(token)
        ? token
        : randomBytes(3).toString('hex');
    return `t-${stamp}-${suffix}`;
}

/** Is this a bin entry id (and therefore a safe path segment)? */
export function isTrashId(value) {
    return typeof value === 'string' && TRASH_ID_RE.test(value);
}

/**
 * Fold arbitrary stored settings onto the defaults.
 *
 * Read-path normalization is deliberately tolerant (clamp, don't throw): a
 * hand-edited file must never brick the plugin. The write path validates
 * strictly instead, so the UI can report a bad value.
 * Exported as `@internal` for the regression suite; not plugin API.
 */
export function normalizeSettings(raw) {
    const source = raw !== null && typeof raw === 'object' ? raw : {};
    const clampInt = (value, min, max, fallback) => (Number.isInteger(value)
        ? Math.min(max, Math.max(min, value))
        : fallback);
    return {
        schema: 1,
        autoClean: typeof source.autoClean === 'boolean'
            ? source.autoClean
            : SETTINGS_DEFAULTS.autoClean,
        retentionDays: RETENTION_DAYS_CHOICES.includes(source.retentionDays)
            ? source.retentionDays
            : SETTINGS_DEFAULTS.retentionDays,
        sweepOnBoot: typeof source.sweepOnBoot === 'boolean'
            ? source.sweepOnBoot
            : SETTINGS_DEFAULTS.sweepOnBoot,
        sweepIntervalHours: clampInt(source.sweepIntervalHours, 1, 168,
            SETTINGS_DEFAULTS.sweepIntervalHours),
        entryPlacement: ENTRY_PLACEMENTS.includes(source.entryPlacement)
            ? source.entryPlacement
            : SETTINGS_DEFAULTS.entryPlacement,
    };
}

/**
 * Validate one settings patch strictly.
 * @returns `{ ok: true, value }` with only the known fields, or
 *   `{ ok: false, code: 'settings-invalid', detail }`.
 */
export function validateSettingsPatch(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, code: 'settings-invalid', detail: 'patch must be an object' };
    }
    const value = {};
    if ('autoClean' in raw) {
        if (typeof raw.autoClean !== 'boolean') {
            return { ok: false, code: 'settings-invalid', detail: 'autoClean must be a boolean' };
        }
        value.autoClean = raw.autoClean;
    }
    if ('sweepOnBoot' in raw) {
        if (typeof raw.sweepOnBoot !== 'boolean') {
            return { ok: false, code: 'settings-invalid', detail: 'sweepOnBoot must be a boolean' };
        }
        value.sweepOnBoot = raw.sweepOnBoot;
    }
    if ('retentionDays' in raw) {
        if (!RETENTION_DAYS_CHOICES.includes(raw.retentionDays)) {
            return {
                ok: false,
                code: 'settings-invalid',
                detail: `retentionDays must be one of ${RETENTION_DAYS_CHOICES.join(', ')}`,
            };
        }
        value.retentionDays = raw.retentionDays;
    }
    if ('sweepIntervalHours' in raw) {
        if (!Number.isInteger(raw.sweepIntervalHours) ||
            raw.sweepIntervalHours < 1 || raw.sweepIntervalHours > 168) {
            return {
                ok: false,
                code: 'settings-invalid',
                detail: 'sweepIntervalHours must be an integer between 1 and 168',
            };
        }
        value.sweepIntervalHours = raw.sweepIntervalHours;
    }
    if ('entryPlacement' in raw) {
        if (!ENTRY_PLACEMENTS.includes(raw.entryPlacement)) {
            return {
                ok: false,
                code: 'settings-invalid',
                detail: `entryPlacement must be one of ${ENTRY_PLACEMENTS.join(', ')}`,
            };
        }
        value.entryPlacement = raw.entryPlacement;
    }
    return { ok: true, value };
}

/** Read settings, falling back to defaults and quarantining a corrupt file. */
export async function readSettings(ctx) {
    const { settings } = binPaths(ctx);
    let text;
    try {
        text = await readFile(settings, 'utf8');
    }
    catch (error) {
        if (isENOENT(error)) return { ...SETTINGS_DEFAULTS };
        console.error('[session-purge] settings read failed:', error);
        return { ...SETTINGS_DEFAULTS };
    }
    try {
        return normalizeSettings(JSON.parse(text));
    }
    catch (error) {
        console.error('[session-purge] settings file is corrupt; falling back to defaults:', error);
        try {
            await rename(settings, `${settings}.bak`);
        }
        catch (backupError) {
            console.error('[session-purge] settings backup failed:', backupError);
        }
        return { ...SETTINGS_DEFAULTS };
    }
}

/** Merge a validated patch into the stored settings and write atomically. */
export async function writeSettings(ctx, patch) {
    const current = await readSettings(ctx);
    const next = normalizeSettings({ ...current, ...patch });
    const { settings } = binPaths(ctx);
    await mkdir(pathDirname(settings), { recursive: true });
    const tmp = `${settings}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(tmp, settings);
    return next;
}

/**
 * Validate one stored entry record.
 * @param raw - parsed metadata file.
 * @param trashId - the id derived from the file name, when known.
 * @returns the normalized entry, or null when the record cannot be trusted.
 * Exported as `@internal` for the regression suite; not plugin API.
 */
export function normalizeEntry(raw, trashId) {
    if (raw === null || typeof raw !== 'object') return null;
    const id = raw.id;
    const { originalDir, sessionsRoot, deletedAt } = raw;
    if (!validSessionId(id)) return null;
    if (typeof originalDir !== 'string' || !pathIsAbsolute(originalDir)) return null;
    if (typeof sessionsRoot !== 'string' || !pathIsAbsolute(sessionsRoot)) return null;
    if (typeof deletedAt !== 'string' || !Number.isFinite(Date.parse(deletedAt))) return null;
    const resolvedId = isTrashId(trashId)
        ? trashId
        : (isTrashId(raw.trashId) ? raw.trashId : null);
    if (resolvedId === null) return null;
    return {
        schema: 1,
        trashId: resolvedId,
        id,
        // `title` is what the browser captured from the session row; the header
        // carries none. A missing title is a legitimate null, not an error.
        title: typeof raw.title === 'string' && raw.title.trim() !== ''
            ? raw.title
            : null,
        cwd: typeof raw.cwd === 'string' && pathIsAbsolute(raw.cwd) ? raw.cwd : null,
        originalDir,
        sessionsRoot,
        deletedAt,
        sizeBytes: Number.isInteger(raw.sizeBytes) && raw.sizeBytes >= 0
            ? raw.sizeBytes
            : null,
        wasArchived: raw.wasArchived === true,
        status: raw.status === 'moving' ? 'moving' : 'trashed',
        trashedBy: typeof raw.trashedBy === 'string' ? raw.trashedBy : undefined,
    };
}

function entryMetaPath(bin, trashId) {
    return pathJoin(bin.trash, `${trashId}.json`);
}

/** Write one entry's metadata atomically (tmp + rename). */
async function writeEntryMeta(ctx, meta) {
    const path = entryMetaPath(binPaths(ctx), meta.trashId);
    await mkdir(pathDirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    await rename(tmp, path);
}

/**
 * Every trustworthy bin entry, newest deletion first.
 *
 * Dot-files are skipped so `.state.json` and `.lock` can share the directory.
 * A metadata file that cannot be trusted is reported and ignored, never
 * deleted: the payload beside it may still be recoverable by hand.
 * @returns an array of normalized entries.
 */
export async function listTrashEntries(ctx) {
    const bin = binPaths(ctx);
    let dirents;
    try {
        dirents = await readdir(bin.trash, { withFileTypes: true });
    }
    catch (error) {
        if (isENOENT(error)) return [];
        throw error;
    }
    const entries = [];
    for (const dirent of dirents) {
        if (!dirent.isFile()) continue;
        const name = dirent.name;
        if (name.startsWith('.') || !name.endsWith('.json')) continue;
        const trashId = name.slice(0, -'.json'.length);
        if (!isTrashId(trashId)) continue;
        try {
            const parsed = JSON.parse(await readFile(pathJoin(bin.trash, name), 'utf8'));
            const entry = normalizeEntry(parsed, trashId);
            if (entry === null) {
                console.error('[session-purge] ignoring malformed bin metadata:', name);
                continue;
            }
            entries.push(entry);
        }
        catch (error) {
            console.error('[session-purge] could not read bin metadata:', name, error);
        }
    }
    return entries.sort((left, right) => Date.parse(right.deletedAt) - Date.parse(left.deletedAt));
}

/** Total bytes of a directory tree; symlinks are counted as links, never followed. */
async function directorySize(dir) {
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        let dirents;
        try {
            dirents = await readdir(current, { withFileTypes: true });
        }
        catch (error) {
            if (isENOENT(error)) continue;
            throw error;
        }
        for (const dirent of dirents) {
            const child = pathJoin(current, dirent.name);
            if (dirent.isDirectory()) stack.push(child);
            else if (dirent.isFile()) {
                try {
                    total += (await stat(child)).size;
                }
                catch (error) {
                    if (!isENOENT(error)) throw error;
                }
            }
        }
    }
    return total;
}

/** Does this directory directly contain a canonical session log artifact? */
async function directoryHasCanonicalLog(dir) {
    let dirents;
    try {
        dirents = await readdir(dir, { withFileTypes: true });
    }
    catch (error) {
        if (isENOENT(error)) return false;
        throw error;
    }
    return dirents.some((dirent) => dirent.isFile() && LOG_FILENAME_RE.test(dirent.name));
}

/**
 * Move a directory, falling back to copy-then-remove across volumes.
 *
 * Same-volume moves are a single atomic rename. The fallback stages the copy
 * under `<to>.partial` and only publishes it once the payload proves to be a
 * session directory, so an interrupted cross-volume move never looks complete.
 *
 * A crash between publishing the copy and removing the source leaves BOTH
 * directories — {@link recoverTrash} finalizes that entry as trashed and logs
 * it, and {@link trashSession} reports the leftover as `duplicate` instead of
 * pretending the delete worked.
 */
async function moveDirectory(from, to) {
    try {
        await rename(from, to);
        return;
    }
    catch (error) {
        if (error?.code !== 'EXDEV') throw error;
    }
    const staging = `${to}.partial`;
    await rm(staging, { recursive: true, force: true });
    try {
        await cp(from, staging, {
            recursive: true,
            force: false,
            errorOnExist: true,
            preserveTimestamps: true,
        });
        if (!(await directoryHasCanonicalLog(staging))) {
            throw new Error('copied payload does not look like a session directory');
        }
        await rename(staging, to);
        await removeDirectoryWithRetry(from);
    }
    catch (error) {
        // A failed copy must not leave the staging directory behind: the caller
        // is about to drop the entry metadata, so nothing would ever list,
        // retry or clean it again (`<to>.partial` is not a trash id).
        await rm(staging, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

/** Sweep bookkeeping (`trash/.state.json`). */
async function readSweepState(ctx) {
    const { sweepState } = binPaths(ctx);
    try {
        const parsed = JSON.parse(await readFile(sweepState, 'utf8'));
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}

async function writeSweepState(ctx, patch) {
    const { sweepState } = binPaths(ctx);
    const next = { ...(await readSweepState(ctx)), ...patch, schema: 1 };
    await mkdir(pathDirname(sweepState), { recursive: true });
    const tmp = `${sweepState}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(tmp, sweepState);
    return next;
}

/** The bin as the state route and the settings page report it. */
export async function trashSummary(ctx) {
    const entries = await listTrashEntries(ctx);
    const state = await readSweepState(ctx);
    return {
        count: entries.length,
        totalBytes: entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
        lastSweepAt: typeof state.lastSweepAt === 'number' ? state.lastSweepAt : null,
        lastSweepRemoved: Number.isInteger(state.lastSweepRemoved) ? state.lastSweepRemoved : 0,
    };
}

/**
 * Permanently delete one bin entry (payload + metadata).
 *
 * Safety gate: the payload's REAL path must resolve strictly inside the bin
 * root, so a symlinked or hand-edited entry can never point this at a session
 * under `sessions/`. Not serialized by itself — callers that must not race a
 * user action go through {@link purgeSession} / {@link emptyTrash} /
 * {@link sweepTrash}.
 * @returns `{ ok: true, freedBytes, id }` or `{ ok: false, code }`.
 */
export async function purgeEntry(ctx, trashId) {
    if (!isTrashId(trashId)) return { ok: false, code: 'invalid' };
    const bin = binPaths(ctx);
    const metaPath = entryMetaPath(bin, trashId);
    const payload = pathJoin(bin.trash, trashId);
    let entry = null;
    try {
        entry = normalizeEntry(JSON.parse(await readFile(metaPath, 'utf8')), trashId);
    }
    catch (error) {
        if (!isENOENT(error)) {
            console.error('[session-purge] purge could not read entry metadata:', trashId, error);
            return { ok: false, code: 'storage' };
        }
    }
    const payloadExists = await pathExists(payload);
    if (payloadExists) {
        const [realPayload, realTrash] = await Promise.all([
            realpath(payload).catch(() => undefined),
            realpath(bin.trash).catch(() => undefined),
        ]);
        if (realPayload === undefined || realTrash === undefined ||
            realPayload === realTrash || !pathInside(realPayload, realTrash)) {
            console.error('[session-purge] refusing to purge outside the bin:', payload);
            return { ok: false, code: 'unsupported' };
        }
        try {
            await removeDirectoryWithRetry(payload);
        }
        catch (error) {
            console.error('[session-purge] purge failed:', payload, error);
            return { ok: false, code: 'rm' };
        }
    }
    if (entry?.id !== undefined && SESSION_ID_SEGMENT_RE.test(entry.id)) {
        // Best-effort: drop the rebuildable projection-cache document too, so a
        // permanent delete reclaims what it can. The cache is keyed per record
        // and identity-checked, so a missing or stale document is harmless.
        const cacheDoc = pathJoin(resolveHome(ctx), 'storages', 'session_projcache', 'sessions',
            `${entry.id}.json`);
        await rm(cacheDoc, { force: true }).catch(() => {});
    }
    await rm(metaPath, { force: true });
    return { ok: true, trashId, id: entry?.id ?? null, freedBytes: entry?.sizeBytes ?? 0 };
}

/**
 * Permanently delete every bin entry. Serialized against user actions.
 * @returns `{ ok: true, removed, freedBytes, failed }`.
 */
export async function emptyTrash(ctx) {
    return serialized(async () => {
        const entries = await listTrashEntries(ctx);
        let removed = 0;
        let freedBytes = 0;
        const failed = [];
        for (const entry of entries) {
            const result = await purgeEntry(ctx, entry.trashId);
            if (result.ok) {
                removed += 1;
                freedBytes += result.freedBytes ?? 0;
            }
            else failed.push({ trashId: entry.trashId, code: result.code });
        }
        console.log('[session-purge] emptied bin:', removed, 'entries,', freedBytes, 'bytes');
        return { ok: true, removed, freedBytes, failed };
    });
}

/** Permanently delete the bin entry for one session id. */
export async function purgeSession(ctx, sessionId) {
    if (!validSessionId(sessionId)) return { ok: false, code: 'invalid' };
    return serialized(async () => {
        const entries = await listTrashEntries(ctx);
        const entry = entries.find((candidate) => candidate.id === sessionId);
        if (entry === undefined) return { ok: false, code: 'unknown' };
        const result = await purgeEntry(ctx, entry.trashId);
        if (result.ok) console.log('[session-purge] purged', sessionId);
        return result;
    });
}

/**
 * Is this entry past its retention window?
 * @param entry - one bin entry.
 * @param settings - normalized settings.
 * @param now - epoch ms to compare against.
 * @returns true when an automatic sweep should delete it.
 * Exported as `@internal` for the regression suite; not plugin API.
 */
export function retentionDue(entry, settings, now) {
    const days = settings?.retentionDays;
    if (!Number.isInteger(days) || days <= 0) return false;
    const deletedAt = Date.parse(entry?.deletedAt ?? '');
    if (!Number.isFinite(deletedAt)) return false;
    return now - deletedAt >= days * DAY_MS;
}

/**
 * Run the retention sweep. Serialized, so it can never purge the entry a user
 * is restoring at the same moment.
 * @returns `{ ok: true, removed, failed, skipped? }`.
 */
export async function sweepTrash(ctx, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const reason = typeof options.reason === 'string' ? options.reason : 'manual';
    return serialized(async () => {
        const settings = await readSettings(ctx);
        if (settings.autoClean !== true) {
            // design §4.5 step 1: a disabled sweep is a pure no-op. Writing
            // lastSweepAt here made the settings page claim "最近清理：刚刚"
            // although nothing had been swept, and moved the interval baseline.
            debugLog('sweep skipped: autoClean is off');
            return { ok: true, removed: 0, failed: [], skipped: 'disabled', reason };
        }
        const entries = await listTrashEntries(ctx);
        let removed = 0;
        const failed = [];
        for (const entry of entries) {
            if (!retentionDue(entry, settings, now)) continue;
            const result = await purgeEntry(ctx, entry.trashId);
            if (result.ok) removed += 1;
            else failed.push({ trashId: entry.trashId, code: result.code });
        }
        await writeSweepState(ctx, { lastSweepAt: now, lastSweepRemoved: removed });
        if (removed > 0 || failed.length > 0) {
            console.log('[session-purge] sweep(' + reason + '): removed', removed,
                'of', entries.length, 'entries', failed.length > 0 ? `(${failed.length} failed)` : '');
        }
        return { ok: true, removed, failed, reason };
    });
}

/**
 * Residency gate shared by the permanent delete and the recycle bin.
 *
 * A strictly idle resident session is released; a live/busy one is refused;
 * a session whose internals cannot be reached is queued for the next boot.
 * @returns `{ ok: true }` | `{ ok: true, queued: true }` | `{ ok: false, code }`.
 */
async function gateAndRelease(ctx, sessionId) {
    const agents = service(ctx, 'agents');
    const sessions = service(ctx, 'sessions');
    let resident = false;
    try {
        resident = (agents !== undefined && agents.get(sessionId) !== undefined) ||
            (sessions !== undefined && sessions.get(sessionId) !== undefined);
    }
    catch (error) {
        console.error('[session-purge] residency check failed:', error);
        resident = true; // fail safe: go through the guarded teardown path
    }
    if (!resident) return { ok: true };
    const teardown = await tearDownResident(ctx, sessionId);
    if (teardown.ok) return { ok: true };
    if (teardown.code === 'live' || teardown.code === 'busy') return teardown;
    // 'held': runtime internals unavailable → queue for the next boot.
    let queued = false;
    try {
        const pending = await readPending(ctx);
        if (!pending.includes(sessionId)) {
            pending.push(sessionId);
            await writePending(ctx, pending);
        }
        queued = true;
    }
    catch (error) {
        console.error('[session-purge] queueing failed:', error);
    }
    if (!queued) return { ok: false, code: 'storage' };
    return { ok: true, queued: true };
}

/**
 * Move one session into the recycle bin.
 *
 * Order matters for crash safety: the entry metadata is written FIRST (as
 * `moving`), then the directory is renamed, then the metadata is finalized.
 * A crash between the steps leaves either an entry whose payload is still in
 * `sessions/` (recoverable) or one whose payload already arrived (finalized at
 * the next boot) — never a session that is gone from both places.
 *
 * @param ctx - host context.
 * @param sessionId - the session to move aside.
 * @param hints - `{ title?, reason? }`; `title` is the display title the
 *   browser captured from the session row (the header has none).
 * @returns `{ ok: true, mode: 'trashed' | 'queued' | 'already', trashId?, name? }`
 *   or `{ ok: false, code }`.
 */
export async function trashSession(ctx, sessionId, hints = {}) {
    if (!validSessionId(sessionId)) return { ok: false, code: 'invalid' };
    const title = typeof hints.title === 'string' && hints.title.trim() !== ''
        ? hints.title.trim()
        : null;
    return serialized(async () => {
        const entries = await listTrashEntries(ctx);
        const existing = entries.find((entry) => entry.id === sessionId);
        if (existing !== undefined) {
            // The bin already holds this session — normally an idempotent retry
            // (a double click, a reloaded panel). But when the session directory
            // is ALSO back on disk, the earlier move only half-completed (the
            // cross-volume window between publishing the copy and removing the
            // source). Answering `already` there is a silent no-op: the row stays
            // in the sidebar, and the next delete appears to do nothing.
            const stillOnDisk = typeof existing.originalDir === 'string' &&
                await pathExists(existing.originalDir);
            if (stillOnDisk) {
                console.error('[session-purge] session is in the bin and still on disk:',
                    sessionId, existing.originalDir);
                return { ok: false, code: 'duplicate' };
            }
            return { ok: true, mode: 'already', trashId: existing.trashId, name: existing.title };
        }
        const gate = await gateAndRelease(ctx, sessionId);
        if (!gate.ok) return gate;
        if (gate.queued === true) {
            console.log('[session-purge] queued (fallback)', sessionId);
            return { ok: true, mode: 'queued' };
        }
        const located = await locateSessionDirectory(ctx, sessionId);
        if (!located.ok) return located;
        const { dir, sessionsRoot, cwd } = located;
        const bin = binPaths(ctx);
        const trashId = makeTrashId();
        const meta = {
            schema: 1,
            trashId,
            id: located.id,
            title,
            cwd,
            // The PROVEN original directory: a restore must land exactly here,
            // because the backend validates a log against the path its own
            // header derives and fails the whole listing on a mismatch.
            originalDir: dir,
            sessionsRoot,
            deletedAt: new Date().toISOString(),
            sizeBytes: await directorySize(dir),
            wasArchived: readWasArchived(ctx, located.id),
            status: 'moving',
            trashedBy: PLUGIN_ID,
        };
        await writeEntryMeta(ctx, meta);
        const payload = pathJoin(bin.trash, trashId);
        try {
            await mkdir(bin.trash, { recursive: true });
            await moveDirectory(dir, payload);
        }
        catch (error) {
            console.error('[session-purge] moving the session into the bin failed:', error);
            await rm(entryMetaPath(bin, trashId), { force: true }).catch(() => {});
            return { ok: false, code: 'rm' };
        }
        await writeEntryMeta(ctx, { ...meta, status: 'trashed' });
        // Clear any stale archive marker pointing at this session: the archive
        // set is registry-global, and a leftover id would hide the session from
        // the default view once it is restored.
        const workspaces = service(ctx, 'workspaceRegistry');
        if (workspaces !== undefined && typeof workspaces.unarchiveSession === 'function') {
            try {
                await workspaces.unarchiveSession(located.id);
            }
            catch (error) {
                debugLog('unarchive after trashing failed:', error?.message ?? error);
            }
        }
        console.log('[session-purge] trashed', located.id, '->', payload);
        return { ok: true, mode: 'trashed', trashId, name: title };
    });
}

/** Is this session in the registry-global archive set? Never throws. */
function readWasArchived(ctx, sessionId) {
    try {
        const workspaces = service(ctx, 'workspaceRegistry');
        const archived = workspaces?.archivedSessionIds;
        return Array.isArray(archived) && archived.includes(sessionId);
    }
    catch {
        return false;
    }
}

/**
 * Re-account a restored session with its workspace and restore its archive
 * flag.
 *
 * Two separate facts drive this:
 *  - `workspace.sessionIds` is filtered by the registry's in-process header
 *    index, so after a restart (and any later workspace write) a trashed id
 *    loses its slot. Re-attaching keeps the restored session inside its
 *    workspace group instead of dropping it into "Ungrouped".
 *  - The archive set is registry-global and outlives the directory; the user's
 *    intent is recorded per entry and replayed here.
 * Every step is best effort: a grouping hiccup must never fail a restore.
 */
async function reattachRestoredSession(ctx, entry) {
    const workspaces = service(ctx, 'workspaceRegistry');
    if (workspaces === undefined) return;
    if (entry.cwd !== null && typeof workspaces.resolveByPath === 'function') {
        try {
            const workspace = await workspaces.resolveByPath(entry.cwd);
            if (workspace !== undefined && typeof workspace.attachSession === 'function') {
                try {
                    await workspace.attachSession(entry.id);
                }
                catch (error) {
                    debugLog('workspace re-attach failed:', error?.message ?? error);
                }
            }
        }
        catch (error) {
            debugLog('workspace lookup for re-attach failed:', error?.message ?? error);
        }
    }
    try {
        if (typeof workspaces.unarchiveSession === 'function') {
            await workspaces.unarchiveSession(entry.id);
        }
    }
    catch (error) {
        debugLog('unarchive on restore failed:', error?.message ?? error);
    }
    if (entry.wasArchived === true && typeof workspaces.archiveSession === 'function') {
        try {
            await workspaces.archiveSession(entry.id);
        }
        catch (error) {
            debugLog('re-archive on restore failed:', error?.message ?? error);
        }
    }
}

/**
 * Move one bin entry back to its original directory.
 * @returns `{ ok: true, restoredTo, wasArchived, cwdMissing }` or
 *   `{ ok: false, code: 'invalid' | 'unknown' | 'unsupported' | 'conflict' | 'rm' | 'storage' }`.
 */
export async function restoreSession(ctx, sessionId) {
    if (!validSessionId(sessionId)) return { ok: false, code: 'invalid' };
    return serialized(async () => {
        const bin = binPaths(ctx);
        const entries = await listTrashEntries(ctx);
        const entry = entries.find((candidate) => candidate.id === sessionId);
        if (entry === undefined) return { ok: false, code: 'unknown' };
        const payload = pathJoin(bin.trash, entry.trashId);
        if (!(await directoryHasCanonicalLog(payload))) {
            console.error('[session-purge] bin entry has no session log:', entry.trashId);
            return { ok: false, code: 'unsupported' };
        }
        // The destination is the directory the session was moved FROM, already
        // proven to live under the sessions root when it was trashed.
        if (entry.originalDir === entry.sessionsRoot ||
            !pathInside(entry.originalDir, entry.sessionsRoot)) {
            console.error('[session-purge] refusing to restore outside the sessions root:',
                entry.originalDir);
            return { ok: false, code: 'unsupported' };
        }
        if (await pathExists(entry.originalDir)) {
            return { ok: false, code: 'conflict' };
        }
        try {
            await mkdir(pathDirname(entry.originalDir), { recursive: true });
            await moveDirectory(payload, entry.originalDir);
        }
        catch (error) {
            console.error('[session-purge] restore failed:', error);
            return { ok: false, code: 'rm' };
        }
        await rm(entryMetaPath(bin, entry.trashId), { force: true });
        const cwdMissing = entry.cwd === null || !(await pathExists(entry.cwd));
        await reattachRestoredSession(ctx, entry);
        console.log('[session-purge] restored', entry.id, '->', entry.originalDir);
        return {
            ok: true,
            restoredTo: entry.originalDir,
            wasArchived: entry.wasArchived,
            cwdMissing,
        };
    });
}

/**
 * Repair the bin after a crash or an interrupted move.
 *
 * Only metadata whose `status` is not yet `trashed` needs attention. A payload
 * directory with no metadata is deliberately LEFT IN PLACE (and reported): the
 * plugin cannot prove its session id or original directory without decoding the
 * log, and guessing would risk restoring a session to the wrong project.
 * @returns `{ ok: true, repaired }`.
 */
export async function recoverTrash(ctx) {
    const bin = binPaths(ctx);
    let dirents;
    try {
        dirents = await readdir(bin.trash, { withFileTypes: true });
    }
    catch (error) {
        if (isENOENT(error)) return { ok: true, repaired: 0 };
        throw error;
    }
    const known = new Set();
    let repaired = 0;
    for (const dirent of dirents) {
        if (!dirent.isFile()) continue;
        const name = dirent.name;
        if (name.startsWith('.') || !name.endsWith('.json')) continue;
        const trashId = name.slice(0, -'.json'.length);
        if (!isTrashId(trashId)) continue;
        known.add(trashId);
        let raw;
        try {
            raw = JSON.parse(await readFile(pathJoin(bin.trash, name), 'utf8'));
        }
        catch {
            continue;
        }
        const entry = normalizeEntry(raw, trashId);
        if (entry === null || entry.status !== 'moving') continue;
        const payload = pathJoin(bin.trash, trashId);
        if (await pathExists(payload)) {
            await writeEntryMeta(ctx, {
                ...entry,
                status: 'trashed',
                sizeBytes: await directorySize(payload),
            });
            repaired += 1;
            console.log('[session-purge] recovered interrupted trash:', trashId);
            continue;
        }
        if (await pathExists(entry.originalDir)) {
            try {
                await moveDirectory(entry.originalDir, payload);
                await writeEntryMeta(ctx, { ...entry, status: 'trashed' });
                repaired += 1;
                console.log('[session-purge] completed interrupted trash:', trashId);
                continue;
            }
            catch (error) {
                console.error('[session-purge] could not complete interrupted trash:', trashId, error);
                continue;
            }
        }
        await rm(pathJoin(bin.trash, name), { force: true });
        repaired += 1;
        console.error('[session-purge] dropped a bin entry whose payload and session are both gone:',
            trashId);
    }
    for (const dirent of dirents) {
        if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
        const name = dirent.name;
        // A staging directory from a cross-volume move that failed before it was
        // published. It has no metadata and is not a trash id, so nothing else
        // would ever look at it; name it so a human can reclaim the space.
        if (name.endsWith('.partial') && isTrashId(name.slice(0, -'.partial'.length))) {
            console.error('[session-purge] stale partial copy from an interrupted move ' +
                '(left in place, safe to delete):', name);
            continue;
        }
        if (!isTrashId(name) || known.has(name)) continue;
        console.error('[session-purge] orphan payload without metadata (left in place):', name);
    }
    if (repaired > 0) console.log('[session-purge] bin recovery repaired', repaired, 'entries');
    return { ok: true, repaired };
}

/**
 * Arm the periodic sweep. A 15-minute heartbeat compares the last sweep against
 * the configured interval, so changing the interval (or the auto-clean switch)
 * needs no timer re-arming.
 * @returns a disposer that stops the heartbeat.
 */
export function startTrashScheduler(ctx) {
    let disposed = false;
    const tick = async () => {
        if (disposed) return;
        try {
            const settings = await readSettings(ctx);
            if (settings.autoClean !== true) return;
            const state = await readSweepState(ctx);
            const last = Number.isFinite(state.lastSweepAt) ? state.lastSweepAt : 0;
            if (Date.now() - last < settings.sweepIntervalHours * 3_600_000) return;
            await sweepTrash(ctx, { reason: 'interval' });
        }
        catch (error) {
            console.error('[session-purge] sweep tick failed:', error);
        }
    };
    const timer = setInterval(() => { void tick(); }, SWEEP_TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return () => {
        disposed = true;
        clearInterval(timer);
    };
}

/** Boot maintenance: finish the restart queue, repair the bin, maybe sweep. */
async function runBootMaintenance(ctx) {
    try {
        await processPendingQueue(ctx);
    }
    catch (error) {
        console.error('[session-purge] boot queue failed:', error);
    }
    try {
        await recoverTrash(ctx);
    }
    catch (error) {
        console.error('[session-purge] bin recovery failed:', error);
    }
    try {
        const settings = await readSettings(ctx);
        if (settings.sweepOnBoot === true) await sweepTrash(ctx, { reason: 'boot' });
    }
    catch (error) {
        console.error('[session-purge] boot sweep failed:', error);
    }
}

/**
 * Run one mutating bin operation at a time.
 *
 * The bin is shared state: a sweep must never delete the entry a restore is
 * mid-way through, and two restores must not race for the same destination.
 * One promise chain per process is enough — a second dsh process on the same
 * home is a documented limitation, not a supported concurrent writer.
 */
let operationTail = Promise.resolve();
function serialized(task) {
    const run = operationTail.then(task, task);
    operationTail = run.then(() => {}, () => {});
    return run;
}

// ── plugin entry ───────────────────────────────────────────────────────────

/**
 * Register the boot maintenance and the HTTP routes.
 * @param ctx - Host context that may acquire webServer later.
 */
export function apply(ctx, config) {
    ctx.inject(['sessionPersistence'], (bootCtx) => {
        // Boot order: finish the restart queue, repair an interrupted move,
        // then (optionally) sweep expired entries. The periodic sweep rides the
        // same fiber so it is disposed with the plugin.
        bootCtx.effect(() => startTrashScheduler(ctx), 'session-purge: sweep scheduler');
        void runBootMaintenance(ctx);
    });
    ctx.inject(['webServer'], (host) => {
        host.effect(() => {
            // A refusal is a policy no (409); a storage/removal fault is
            // transient (503); a malformed request is the caller's fault (400).
            const statusFor = (result) => {
                if (result.ok === true) return 200;
                if (result.code === 'invalid' || result.code === 'bad-request' ||
                    result.code === 'settings-invalid') {
                    return 400;
                }
                if (result.code === 'storage' || result.code === 'rm') return 503;
                return 409;
            };
            /** One JSON response for a same-origin POST route. */
            const postRoute = (path, handle) => host.webServer.register({
                kind: 'exact',
                path,
                handler: async (request, response) => {
                    if (request.method !== 'POST') {
                        response.writeHead(405, { allow: 'POST' });
                        response.end();
                        return;
                    }
                    if (!sameOrigin(request)) {
                        sendJson(response, 403, { ok: false, code: 'origin' });
                        return;
                    }
                    let body;
                    try {
                        body = await readJsonBody(request);
                    }
                    catch (error) {
                        sendJson(response, bodyStatus(error), bodyFailure(error));
                        return;
                    }
                    try {
                        const result = await handle(body ?? {});
                        sendJson(response, statusFor(result), result);
                    }
                    catch (error) {
                        console.error('[session-purge] route failed:', path, error);
                        sendJson(response, 503, {
                            ok: false,
                            code: 'storage',
                            error: String(error?.message ?? error),
                        });
                    }
                },
            });
            const disposers = [
                host.webServer.register({
                    kind: 'exact',
                    path: '/session-purge/state',
                    handler: async (request, response) => {
                        if (request.method !== 'GET') {
                            response.writeHead(405, { allow: 'GET' });
                            response.end();
                            return;
                        }
                        if (!sameOrigin(request)) {
                            sendJson(response, 403, { ok: false, code: 'origin' });
                            return;
                        }
                        // Ground truth for "was the session really deleted?": the
                        // ids persistence currently lists, each with its on-disk
                        // size, residency, and grouping flag, plus the bin's own
                        // summary so a diagnostic can see both sides at once.
                        try {
                            const report = await diskSessionReport(ctx);
                            sendJson(response, 200, {
                                ok: true,
                                held: residentSessionIds(ctx),
                                pending: await readPending(ctx),
                                persistence: report.persistence,
                                sessions: report.sessions,
                                trash: await trashSummary(ctx),
                                settings: await readSettings(ctx),
                            });
                        }
                        catch (error) {
                            console.error('[session-purge] state report failed:', error);
                            sendJson(response, 503, {
                                ok: false,
                                code: 'storage',
                                error: String(error?.message ?? error),
                            });
                        }
                    },
                }),
                // The bin's data source and its soft-delete entry point share
                // ONE registration: the web server routes by exact path, so a
                // second handler on the same path would shadow this one.
                host.webServer.register({
                    kind: 'exact',
                    path: '/session-purge/trash',
                    handler: async (request, response) => {
                        if (request.method !== 'GET' && request.method !== 'POST') {
                            response.writeHead(405, { allow: 'GET, POST' });
                            response.end();
                            return;
                        }
                        if (!sameOrigin(request)) {
                            sendJson(response, 403, { ok: false, code: 'origin' });
                            return;
                        }
                        try {
                            if (request.method === 'GET') {
                                const entries = await listTrashEntries(ctx);
                                sendJson(response, 200, {
                                    ok: true,
                                    version,
                                    entries,
                                    totalBytes: entries.reduce(
                                        (sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
                                    settings: await readSettings(ctx),
                                    sweep: await trashSummary(ctx),
                                });
                                return;
                            }
                            let body;
                            try {
                                body = await readJsonBody(request);
                            }
                            catch (error) {
                                sendJson(response, bodyStatus(error), bodyFailure(error));
                                return;
                            }
                            const result = await trashSession(ctx, body?.sessionId,
                                { title: body?.title });
                            sendJson(response, statusFor(result), result);
                        }
                        catch (error) {
                            console.error('[session-purge] bin route failed:', error);
                            sendJson(response, 503, {
                                ok: false,
                                code: 'storage',
                                error: String(error?.message ?? error),
                            });
                        }
                    },
                }),
                postRoute('/session-purge/restore', (body) => restoreSession(ctx, body.sessionId)),
                postRoute('/session-purge/purge', (body) => purgeSession(ctx, body.sessionId)),
                postRoute('/session-purge/empty', (body) => (body.confirm === true
                    ? emptyTrash(ctx)
                    : { ok: false, code: 'bad-request', error: 'confirm must be true' })),
                postRoute('/session-purge/sweep', () => sweepTrash(ctx, { reason: 'manual' })),
                // Deprecated alias of /trash. An already-loaded browser bundle
                // still posts here, and hard-deleting on its word would destroy
                // exactly what the bin exists to keep.
                postRoute('/session-purge/delete', (body) => trashSession(ctx, body.sessionId, { title: body.title })),
                host.webServer.register({
                    kind: 'exact',
                    path: '/session-purge/settings',
                    handler: async (request, response) => {
                        if (request.method !== 'GET' && request.method !== 'POST') {
                            response.writeHead(405, { allow: 'GET, POST' });
                            response.end();
                            return;
                        }
                        if (!sameOrigin(request)) {
                            sendJson(response, 403, { ok: false, code: 'origin' });
                            return;
                        }
                        if (request.method === 'GET') {
                            try {
                                sendJson(response, 200, {
                                    ok: true,
                                    version,
                                    settings: await readSettings(ctx),
                                    stats: await trashSummary(ctx),
                                });
                            }
                            catch (error) {
                                console.error('[session-purge] settings read failed:', error);
                                sendJson(response, 503, {
                                    ok: false,
                                    version,
                                    code: 'storage',
                                    error: String(error?.message ?? error),
                                });
                            }
                            return;
                        }
                        // A malformed body is the caller's fault (400/413), not a
                        // storage outage: the other POST routes answer that way, and
                        // labelling it `storage` made a client bug look like a
                        // server failure. Only the read/write below can be 503.
                        let body;
                        try {
                            body = await readJsonBody(request);
                        }
                        catch (error) {
                            sendJson(response, bodyStatus(error), bodyFailure(error));
                            return;
                        }
                        try {
                            const patch = validateSettingsPatch(body ?? {});
                            if (!patch.ok) {
                                sendJson(response, 400, patch);
                                return;
                            }
                            const settings = await writeSettings(ctx, patch.value);
                            sendJson(response, 200, { ok: true, settings });
                        }
                        catch (error) {
                            console.error('[session-purge] settings route failed:', error);
                            sendJson(response, 503, {
                                ok: false,
                                version,
                                code: 'storage',
                                error: String(error?.message ?? error),
                            });
                        }
                    },
                }),
                host.webServer.register({
                    kind: 'exact',
                    path: '/session-purge/undo',
                    handler: async (request, response) => {
                        if (request.method !== 'POST') {
                            response.writeHead(405, { allow: 'POST' });
                            response.end();
                            return;
                        }
                        if (!sameOrigin(request)) {
                            sendJson(response, 403, { ok: false, code: 'origin' });
                            return;
                        }
                        let body;
                        try {
                            body = await readJsonBody(request);
                        }
                        catch (error) {
                            sendJson(response, bodyStatus(error), bodyFailure(error));
                            return;
                        }
                        const id = body?.sessionId;
                        if (!validSessionId(id)) {
                            sendJson(response, 409, { ok: false, code: 'invalid' });
                            return;
                        }
                        try {
                            const pending = await readPending(ctx);
                            await writePending(ctx, pending.filter((entry) => entry !== id));
                            console.log('[session-purge] unqueued', id);
                            sendJson(response, 200, { ok: true });
                        }
                        catch (error) {
                            console.error('[session-purge] undo failed:', error);
                            sendJson(response, 503, {
                                ok: false,
                                code: 'storage',
                                error: String(error?.message ?? error),
                            });
                        }
                    },
                }),
            ];
            return () => {
                for (const dispose of disposers) dispose();
            };
        }, 'session-purge: http routes');
    });
}
