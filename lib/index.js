/**
 * dsh-session-delete — host half.
 *
 * Routes:
 *  - GET  /session-delete/state  → { ok, held: string[], pending: string[] }
 *  - POST /session-delete/delete → immediate deletion, including for sessions
 *    opened earlier in this run (resident agents are torn down first).
 *  - POST /session-delete/undo   → removes a session from the fallback queue.
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
import { dirname, join } from 'node:path';

export const name = 'session-delete';

const MAX_BODY_BYTES = 8192;
const PENDING_PATH = join(homedir(), '.dsh', 'session-delete', 'pending.json');
const SCOPE_TEARDOWN_TIMEOUT_MS = 5000;

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

// ── fallback queue (durable; only used when direct teardown is impossible) ──

async function readPending() {
    try {
        const parsed = JSON.parse(await readFile(PENDING_PATH, 'utf8'));
        if (Array.isArray(parsed?.pending)) {
            return [...new Set(parsed.pending.filter(validSessionId))];
        }
    }
    catch {
        /* missing or malformed queue file → empty */
    }
    return [];
}

async function writePending(ids) {
    await mkdir(dirname(PENDING_PATH), { recursive: true });
    const tmp = `${PENDING_PATH}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ pending: ids }, null, 2)}\n`, 'utf8');
    await rename(tmp, PENDING_PATH);
}

/** Collect the session ids that currently have a resident in-memory agent. */
function residentSessionIds(ctx) {
    const held = new Set();
    const agents = ctx.get('agents');
    if (agents !== undefined) {
        for (const agent of agents.list()) held.add(agent.id);
    }
    const sessions = ctx.get('sessions');
    if (sessions !== undefined) {
        for (const session of sessions.list()) held.add(session.id);
    }
    return [...held];
}

// ── deletion core ──────────────────────────────────────────────────────────

/**
 * Locate and remove one session's log directory, then archive it away from
 * grouping surfaces. No liveness checks — the caller decides when this is safe.
 * @returns { ok: true } or { ok: false, code }.
 */
async function removeSessionLog(ctx, sessionId) {
    const persistence = ctx.get('sessionPersistence');
    if (persistence === undefined) return { ok: false, code: 'unavailable' };
    const headers = await persistence.list();
    const meta = (Array.isArray(headers) ? headers : [])
        .find((h) => h !== null && h !== undefined && h.id === sessionId);
    if (meta === undefined) return { ok: false, code: 'unknown' };
    const location = persistence.locate(meta);
    if (location === undefined || typeof location.path !== 'string' || location.path === '') {
        return { ok: false, code: 'unsupported' };
    }
    const cut = location.path.lastIndexOf('/');
    if (cut <= 0) return { ok: false, code: 'unsupported' };
    const dir = location.path.slice(0, cut);
    // Defense in depth: only ever remove a directory named exactly like the id.
    if (dir.slice(dir.lastIndexOf('/') + 1) !== sessionId) {
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
        console.error('[session-delete] rm failed:', error);
        return { ok: false, code: 'rm' };
    }
    const workspaces = ctx.get('workspaceRegistry');
    if (workspaces !== undefined) {
        try {
            await workspaces.archiveSession(sessionId);
        }
        catch {
            /* best effort: hide the row from grouping surfaces */
        }
    }
    console.log('[session-delete] removed', sessionId);
    return { ok: true };
}

/**
 * Tear down a resident, strictly-idle session through the same primitives the
 * official AgentHandle.dispose() teardown drives, so nothing can append to
 * the log after it returns.
 * @returns { ok: true } | { ok: false, code: 'live' | 'busy' } (refuse: stop
 * the session first) | { ok: false, code: 'held' } (internals unavailable).
 */
async function tearDownResident(ctx, sessionId) {
    const agents = ctx.get('agents');
    const sessions = ctx.get('sessions');
    const agent = agents !== undefined ? agents.get(sessionId) : undefined;
    const session = sessions !== undefined ? sessions.get(sessionId) : undefined;

    if (agent !== undefined) {
        // Strict idle gate: refuse anything mid-turn or in maintenance.
        if (agent.status !== 'idle') return { ok: false, code: 'live' };
        if (agent.phase === undefined || agent.phase === null ||
            agent.phase.kind !== 'idle') {
            return { ok: false, code: 'busy' };
        }
        // Belt and suspenders: a running background job would try to deliver
        // its result into this session; ask the user to let it settle first.
        const jobs = ctx.get('jobs');
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
            console.error('[session-delete] agent scope teardown issue:', error);
            // Continue: registry detach below is what actually stops routing.
        }
    }

    // 3) Detach the agent from its registry (idempotent by entry identity).
    if (agent !== undefined) {
        const entry = agents.store.get(sessionId);
        if (entry !== undefined) {
            try {
                agents.detachEntered(entry);
            }
            catch (error) {
                console.error('[session-delete] agent detach failed:', error);
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
                console.error('[session-delete] session detach failed:', error);
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
    const agents = ctx.get('agents');
    const sessions = ctx.get('sessions');
    const resident = (agents !== undefined && agents.get(sessionId) !== undefined) ||
        (sessions !== undefined && sessions.get(sessionId) !== undefined);
    if (resident) {
        const teardown = await tearDownResident(ctx, sessionId);
        if (!teardown.ok) {
            if (teardown.code === 'live' || teardown.code === 'busy') {
                return teardown;
            }
            // 'held': runtime internals unavailable → queue for next boot.
            const pending = await readPending();
            if (!pending.includes(sessionId)) {
                pending.push(sessionId);
                await writePending(pending);
            }
            console.log('[session-delete] queued (fallback)', sessionId);
            return { ok: true, mode: 'queued' };
        }
    }
    const result = await removeSessionLog(ctx, sessionId);
    return { ...result, mode: 'deleted' };
}

/** Process the fallback queue at boot, before any session can be opened. */
async function processPendingQueue(ctx) {
    const pending = await readPending();
    if (pending.length === 0) return;
    const remaining = [];
    for (const id of pending) {
        try {
            const result = await removeSessionLog(ctx, id);
            if (!result.ok && result.code !== 'unknown') {
                remaining.push(id);
            }
        }
        catch (error) {
            console.error('[session-delete] boot queue entry failed:', id, error);
            remaining.push(id);
        }
    }
    await writePending(remaining);
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
            console.error('[session-delete] boot queue failed:', error);
        }
    });
    ctx.inject(['webServer'], (host) => {
        host.effect(() => {
            const disposers = [
                host.webServer.register({
                    kind: 'exact',
                    path: '/session-delete/state',
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
                        sendJson(response, 200, {
                            ok: true,
                            held: residentSessionIds(ctx),
                            pending: await readPending(),
                        });
                    },
                }),
                host.webServer.register({
                    kind: 'exact',
                    path: '/session-delete/delete',
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
                            sendJson(response, result.ok ? 200 : 409, result);
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
                    path: '/session-delete/undo',
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
                            const pending = await readPending();
                            await writePending(pending.filter((entry) => entry !== id));
                            console.log('[session-delete] unqueued', id);
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
        }, 'session-delete: http routes');
    });
}
