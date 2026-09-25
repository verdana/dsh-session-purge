/**
 * dsh-session-purge — host half.
 *
 * Routes:
 *  - GET  /session-purge/state  → { ok, held: string[], pending: string[],
 *    persistence: boolean, sessions: [{ id, title, cwd, sizeBytes, resident,
 *    archived }] } — the disk ground truth for "was it really deleted?".
 *  - POST /session-purge/delete → immediate deletion, including for sessions
 *    opened earlier in this run (resident agents are torn down first).
 *    Success carries { ok: true, mode, dir, archived, name }.
 *  - POST /session-purge/undo   → removes a session from the fallback queue.
 *
 * Deletion model:
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
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
    basename as pathBasename,
    dirname as pathDirname,
    isAbsolute as pathIsAbsolute,
    join as pathJoin,
    parse as pathParse,
} from 'node:path';

export const name = 'session-purge';

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
 * Resolve the DeepSeek Harness home the way the harness itself does
 * (`@deepseek-ai/dsh-home-paths`): an explicit configured path, then
 * `$DSH_HOME`, then `~/.dsh`. Mirroring that precedence matters for the
 * durable fallback queue — writing it to `~/.dsh` while the running harness
 * uses a relocated home would queue a deletion nobody ever processes.
 * @param ctx - host context; may expose `dshHomePath` (from dsh-app-boot).
 * @returns the absolute harness home directory.
 */
function resolveHome(ctx) {
    const provided = typeof ctx?.get === 'function' ? ctx.get('dshHomePath') : undefined;
    if (typeof provided === 'string' && provided.trim() !== '') return provided;
    const configured = ctx?.dshHomePath;
    if (typeof configured === 'string' && configured.trim() !== '') return configured;
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
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('request body too large'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
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

/** Host path flavor, so the default parameter stays platform-correct on POSIX too. */
const pathApiDefault = {
    basename: pathBasename,
    dirname: pathDirname,
    isAbsolute: pathIsAbsolute,
    parse: pathParse,
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
 */
async function diskSessionReport(ctx) {
    const persistence = service(ctx, 'sessionPersistence', 'list');
    if (persistence === undefined) {
        return { persistence: false, sessions: [] };
    }
    const resident = new Set(residentSessionIds(ctx));
    const archived = new Set();
    try {
        const workspaces = service(ctx, 'workspaceRegistry', 'list');
        if (workspaces !== undefined) {
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
            title: header.title ?? null,
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
 * Locate and remove one session's log directory, then archive it away from
 * grouping surfaces. No liveness checks — the caller decides when this is safe.
 *
 * Exported as `@internal` purely so `tools/repro-delete.mjs` can drive the real
 * deletion path against the real persistence backend; it is not plugin API.
 * @returns { ok: true, dir } or { ok: false, code }.
 */
export async function removeSessionLog(ctx, sessionId) {
    // `list` and `locate` are both required: a backend without `locate` cannot
    // tell us which directory to remove, and saying "unsupported" is clearer
    // than a TypeError.
    const persistence = service(ctx, 'sessionPersistence', 'list');
    if (persistence === undefined || typeof persistence.locate !== 'function') {
        return { ok: false, code: 'unavailable' };
    }
    let snapshots;
    let snapshot;
    let location;
    try {
        snapshots = await persistence.list();
        snapshot = findSessionSnapshot(snapshots, sessionId);
        if (snapshot === undefined) return { ok: false, code: 'unknown' };
        sessionId = snapshotSessionId(snapshot);
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
        // Refusing to delete is a safety decision the operator may need to see.
        console.error('[session-purge] refusing unprovable session directory for',
            sessionId, 'from', location.path);
        return { ok: false, code: 'unsupported' };
    }
    try {
        // Cross-platform recursive removal (no /bin/rm dependency); force
        // tolerates a concurrent compaction rename, retries soften the
        // race where the writer recreates a file mid-unlink on Windows.
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await rm(dir, { recursive: true, force: true });
                lastError = null;
                break;
            }
            catch (error) {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
        }
        if (lastError !== null) throw lastError;
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
    const name = snapshot.header?.title ?? null;
    console.log('[session-purge] removed', sessionId, 'from', dir, archived ? '(archived)' : '');
    return { ok: true, dir, archived, name };
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
                const snapshots = jobs.list(agent);
                const active = (Array.isArray(snapshots) ? snapshots : [])
                    .some((job) => job !== undefined && job.status !== undefined &&
                        job.status !== 'finished');
                if (active) return { ok: false, code: 'busy' };
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

/** Decide direct delete vs refusal vs fallback queue, then act. */
async function deleteSession(ctx, sessionId) {
    if (!validSessionId(sessionId)) return { ok: false, code: 'invalid' };
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
    if (resident) {
        const teardown = await tearDownResident(ctx, sessionId);
        if (!teardown.ok) {
            if (teardown.code === 'live' || teardown.code === 'busy') {
                return teardown;
            }
            // 'held': runtime internals unavailable → queue for next boot.
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
            console.log('[session-purge] queued (fallback)', sessionId);
            return { ok: true, mode: 'queued' };
        }
    }
    const result = await removeSessionLog(ctx, sessionId);
    return { ...result, mode: 'deleted' };
}

/** Process the fallback queue at boot, before any session can be opened. */
async function processPendingQueue(ctx) {
    const pending = await readPending(ctx);
    if (pending.length === 0) return;
    const remaining = [];
    for (const id of pending) {
        try {
            const result = await removeSessionLog(ctx, id);
            // 'unknown' means the log is already gone: drop it from the queue.
            if (!result.ok && result.code !== 'unknown') {
                remaining.push(id);
            }
        }
        catch (error) {
            console.error('[session-purge] boot queue entry failed:', id, error);
            remaining.push(id);
        }
    }
    await writePending(ctx, remaining);
}

// ── plugin entry ───────────────────────────────────────────────────────────

/**
 * Register the boot-time queue processing and the HTTP routes.
 * @param ctx - Host context that may acquire webServer later.
 */
export function apply(ctx, config) {
    ctx.inject(['sessionPersistence'], async () => {
        try {
            await processPendingQueue(ctx);
        }
        catch (error) {
            console.error('[session-purge] boot queue failed:', error);
        }
    });
    ctx.inject(['webServer'], (host) => {
        host.effect(() => {
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
                        // size, residency, and grouping flag.
                        try {
                            const report = await diskSessionReport(ctx);
                            sendJson(response, 200, {
                                ok: true,
                                held: residentSessionIds(ctx),
                                pending: await readPending(ctx),
                                persistence: report.persistence,
                                sessions: report.sessions,
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
                host.webServer.register({
                    kind: 'exact',
                    path: '/session-purge/delete',
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
                        try {
                            const body = await readJsonBody(request);
                            const result = await deleteSession(ctx, body?.sessionId);
                            // Storage faults are transient, not refusals: 503
                            // keeps them distinguishable from a 409 policy no.
                            const status = result.ok ? 200
                                : result.code === 'storage' ? 503 : 409;
                            sendJson(response, status, result);
                        }
                        catch (error) {
                            sendJson(response, 400, {
                                ok: false,
                                code: 'bad-request',
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
                        try {
                            const body = await readJsonBody(request);
                            const id = body?.sessionId;
                            if (!validSessionId(id)) {
                                sendJson(response, 409, { ok: false, code: 'invalid' });
                                return;
                            }
                            const pending = await readPending(ctx);
                            await writePending(ctx, pending.filter((entry) => entry !== id));
                            console.log('[session-purge] unqueued', id);
                            sendJson(response, 200, { ok: true });
                        }
                        catch (error) {
                            sendJson(response, 400, {
                                ok: false,
                                code: 'bad-request',
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
