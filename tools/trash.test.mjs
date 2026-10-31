/**
 * Recycle-bin regression tests (milestone M1: the host half).
 *
 * Three layers are covered:
 *  1. the pure helpers (ids, settings normalization, retention, containment);
 *  2. the filesystem operations against a throwaway harness home;
 *  3. the HTTP routes exactly as a `curl` would drive them, through a fake
 *     webServer — so the acceptance criteria are checked on the wire shape the
 *     browser half will consume.
 *
 * Nothing here touches the real `~/.dsh`: every test builds its own home under
 * the OS temp directory and removes it afterwards.
 *
 * Run: node --test tools/*.test.mjs   (or: npm test)
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, win32 } from 'node:path';
import { after, test } from 'node:test';

import {
    SETTINGS_DEFAULTS,
    apply,
    deleteSession,
    emptyTrash,
    isTrashId,
    listTrashEntries,
    locateSessionDirectory,
    makeTrashId,
    normalizeEntry,
    normalizeSettings,
    pathInside,
    purgeEntry,
    purgeSession,
    readSettings,
    recoverTrash,
    restoreSession,
    retentionDue,
    sweepTrash,
    trashSession,
    validateSettingsPatch,
    version,
    writeSettings,
} from '../lib/index.js';

// The suite deliberately drives refusal paths; show their diagnostics.
process.env.DSH_PURGE_DEBUG = '1';

const SESSION_LOG = 'session.v4.jsonl.zstd';

// ── fixtures ───────────────────────────────────────────────────────────────

const homes = [];
after(async () => {
    for (const home of homes) await rm(home, { recursive: true, force: true });
});

/**
 * A throwaway harness home shaped like the real one:
 *   <home>/sessions/<projectKey>/<sessionId>/session.v4.jsonl.zstd
 * @returns { home, sessionsRoot, projectKey, sessionId, sessionDir, services, ctx }
 */
async function fixture() {
    const home = await mkdtemp(join(tmpdir(), 'dsh-purge-bin-'));
    homes.push(home);
    const sessionsRoot = join(home, 'sessions');
    const projectKey = '--D-proj--';
    const sessionId = 'session-11111111-2222-3333-4444-555555555555';
    const sessionDir = join(sessionsRoot, projectKey, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, SESSION_LOG), 'header\n{"seq":1}\n', 'utf8');
    const state = { entries: [{ id: sessionId, cwd: join(home, 'proj'), dir: sessionDir }] };
    const services = {
        sessionPersistence: {
            list: async () => state.entries.map((entry) => ({
                header: { id: entry.id, cwd: entry.cwd, version: 4, createdAt: 1, isSeeded: false },
                revision: 'r1',
                sizeBytes: 21,
            })),
            locate: (header) => {
                const entry = state.entries.find((candidate) => candidate.id === header.id);
                if (entry === undefined) return undefined;
                return { kind: 'jsonl', path: join(entry.dir, SESSION_LOG) };
            },
        },
    };
    const ctx = {
        dshHomePath: home,
        get: (name) => services[name],
    };
    return { home, sessionsRoot, projectKey, sessionId, sessionDir, state, services, ctx };
}

/** Hash every file under `dir`, keyed by its relative path, for byte comparison. */
async function snapshotTree(dir) {
    const { readdir } = await import('node:fs/promises');
    const out = {};
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const dirent of await readdir(current, { withFileTypes: true })) {
            const child = join(current, dirent.name);
            if (dirent.isDirectory()) stack.push(child);
            else if (dirent.isFile()) {
                const bytes = await readFile(child);
                out[relative(dir, child)] = createHash('sha256').update(bytes).digest('hex');
            }
        }
    }
    return out;
}

async function exists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}

// ── ids ────────────────────────────────────────────────────────────────────

test('makeTrashId renders a sortable, path-safe id', () => {
    const id = makeTrashId(Date.UTC(2026, 9, 14, 3, 41, 5), 'a1b2c3');
    assert.equal(id, 't-20261014T034105-a1b2c3');
    assert.equal(isTrashId(id), true);
    // Random suffix still matches the shape.
    assert.equal(isTrashId(makeTrashId()), true);
});

test('isTrashId refuses anything that is not a generated id', () => {
    for (const bad of ['', 't-2026-a1b2c3', 'session-abc', 't-20261014T034105-A1B2C3',
        't-20261014T034105-a1b2c', '../escape', null, undefined, 42]) {
        assert.equal(isTrashId(bad), false, `${String(bad)} must not be a bin id`);
    }
});

// ── settings ───────────────────────────────────────────────────────────────

test('normalizeSettings folds unknown input onto the defaults', () => {
    assert.deepEqual(normalizeSettings(undefined), { ...SETTINGS_DEFAULTS });
    assert.deepEqual(normalizeSettings(null), { ...SETTINGS_DEFAULTS });
    assert.deepEqual(normalizeSettings('nonsense'), { ...SETTINGS_DEFAULTS });
    assert.deepEqual(normalizeSettings({}), { ...SETTINGS_DEFAULTS });
});

test('normalizeSettings clamps numbers and keeps only known fields', () => {
    const normalized = normalizeSettings({
        autoClean: false,
        retentionDays: 90,
        sweepOnBoot: false,
        sweepIntervalHours: 999,
        somethingElse: true,
    });
    assert.deepEqual(normalized, {
        schema: 1, autoClean: false, retentionDays: 90, sweepOnBoot: false, sweepIntervalHours: 168,
        entryPlacement: 'icon',
    });
    // A retention value outside the offered choices falls back, never guesses.
    assert.equal(normalizeSettings({ retentionDays: 12 }).retentionDays, 30);
    // Numeric bounds are clamped to something usable rather than trusted.
    assert.equal(normalizeSettings({ sweepIntervalHours: 0 }).sweepIntervalHours, 1);
    assert.equal(normalizeSettings({ sweepIntervalHours: 2.5 }).sweepIntervalHours, 6);
    // The placement is a closed set: anything else is the shipped icon shape.
    assert.equal(normalizeSettings({ entryPlacement: 'menu' }).entryPlacement, 'menu');
    assert.equal(normalizeSettings({ entryPlacement: 'sidebar' }).entryPlacement, 'icon');
});

test('validateSettingsPatch accepts a valid subset and refuses bad values', () => {
    assert.deepEqual(validateSettingsPatch({ retentionDays: 7 }), { ok: true, value: { retentionDays: 7 } });
    assert.deepEqual(validateSettingsPatch({ autoClean: false, sweepIntervalHours: 1 }),
        { ok: true, value: { autoClean: false, sweepIntervalHours: 1 } });
    assert.deepEqual(validateSettingsPatch({ entryPlacement: 'menu' }),
        { ok: true, value: { entryPlacement: 'menu' } });
    // Unknown keys are ignored so a newer client cannot brick an older host.
    assert.deepEqual(validateSettingsPatch({ future: 1 }), { ok: true, value: {} });

    for (const bad of [{ autoClean: 'yes' }, { sweepOnBoot: 1 }, { retentionDays: 12 },
        { retentionDays: '30' }, { sweepIntervalHours: 0 }, { sweepIntervalHours: 200 },
        { sweepIntervalHours: 3.5 }, { entryPlacement: 'sidebar' }, { entryPlacement: null },
        null, 'nope', []]) {
        const result = validateSettingsPatch(bad);
        assert.equal(result.ok, false, `${JSON.stringify(bad)} must be refused`);
        assert.equal(result.code, 'settings-invalid');
    }
});

test('settings round-trip through the home and quarantine a corrupt file', async () => {
    const { home, ctx } = await fixture();
    assert.deepEqual(await readSettings(ctx), { ...SETTINGS_DEFAULTS });

    const written = await writeSettings(ctx, { retentionDays: 7, sweepIntervalHours: 3 });
    assert.equal(written.retentionDays, 7);
    assert.deepEqual(await readSettings(ctx), written);

    // A corrupt file must never throw: defaults + a `.bak` beside it.
    await writeFile(join(home, 'session-purge', 'settings.json'), '{ not json', 'utf8');
    assert.deepEqual(await readSettings(ctx), { ...SETTINGS_DEFAULTS });
    assert.equal(await exists(join(home, 'session-purge', 'settings.json.bak')), true);
});

// ── retention + containment ────────────────────────────────────────────────

test('retentionDue measures from the deletion time, with 0 meaning forever', () => {
    const now = Date.UTC(2026, 9, 14, 12, 0, 0);
    const settings = { ...SETTINGS_DEFAULTS, retentionDays: 30 };
    const at = (days) => ({ deletedAt: new Date(now - days * 86_400_000).toISOString() });
    assert.equal(retentionDue(at(29), settings, now), false);
    assert.equal(retentionDue(at(30), settings, now), true);
    assert.equal(retentionDue(at(0.5), settings, now), false);
    // "keep forever" and an unreadable timestamp both mean "do not delete".
    assert.equal(retentionDue(at(3650), { ...settings, retentionDays: 0 }, now), false);
    assert.equal(retentionDue({ deletedAt: 'not-a-date' }, settings, now), false);
    assert.equal(retentionDue({}, settings, now), false);
});

test('pathInside accepts descendants and refuses escapes on both path flavors', () => {
    assert.equal(pathInside('/a/b/c', '/a/b'), true);
    assert.equal(pathInside('/a/b', '/a/b'), true);
    assert.equal(pathInside('/a/bc', '/a/b'), false);
    assert.equal(pathInside('/a', '/a/b'), false);
    assert.equal(pathInside('/a/b/../c', '/a/b'), false);
    assert.equal(pathInside('C:\\x\\y', 'C:\\x', win32), true);
    assert.equal(pathInside('C:\\x2', 'C:\\x', win32), false);
    assert.equal(pathInside('C:\\x\\..\\z', 'C:\\x', win32), false);
    assert.equal(pathInside('/tmp/trash/t-1', '/tmp/trash', posix), true);
    assert.equal(pathInside('/tmp/trashx/t-1', '/tmp/trash', posix), false);
    assert.equal(pathInside(undefined, '/a'), false);
    assert.equal(pathInside('/a', undefined), false);
});

// ── entry records ──────────────────────────────────────────────────────────

test('normalizeEntry trusts only well-formed records', () => {
    const base = {
        id: 'session-a',
        originalDir: '/root/--p--/session-a',
        sessionsRoot: '/root',
        deletedAt: '2026-10-14T03:41:05.000Z',
        title: '  ',
        cwd: 'relative/path',
    };
    const entry = normalizeEntry(base, 't-20261014T034105-a1b2c3');
    assert.equal(entry.id, 'session-a');
    assert.equal(entry.title, null, 'a blank title is a legitimate null');
    assert.equal(entry.cwd, null, 'a relative cwd is not trusted');
    assert.equal(entry.status, 'trashed');
    assert.equal(entry.wasArchived, false);

    assert.equal(normalizeEntry({ ...base, id: '../evil' }, 't-20261014T034105-a1b2c3'), null);
    assert.equal(normalizeEntry({ ...base, originalDir: 'relative' }, 't-20261014T034105-a1b2c3'), null);
    assert.equal(normalizeEntry({ ...base, sessionsRoot: undefined }, 't-20261014T034105-a1b2c3'), null);
    assert.equal(normalizeEntry({ ...base, deletedAt: 'yesterday' }, 't-20261014T034105-a1b2c3'), null);
    assert.equal(normalizeEntry(base, 'not-an-id'), null);
    assert.equal(normalizeEntry(null, 't-20261014T034105-a1b2c3'), null);
});

// ── trash → restore → purge ────────────────────────────────────────────────

test('trashing moves the session aside and keeps the payload intact', async () => {
    const fx = await fixture();
    const before = await snapshotTree(fx.sessionDir);

    const result = await trashSession(fx.ctx, fx.sessionId, { title: '重构回收站' });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'trashed');
    assert.equal(result.name, '重构回收站');
    assert.equal(await exists(fx.sessionDir), false, 'the session directory must be gone');

    const entries = await listTrashEntries(fx.ctx);
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.equal(entry.id, fx.sessionId);
    assert.equal(entry.title, '重构回收站');
    assert.equal(entry.originalDir, fx.sessionDir);
    assert.equal(entry.sessionsRoot, fx.sessionsRoot);
    assert.equal(entry.status, 'trashed');
    assert.equal(entry.sizeBytes > 0, true);
    assert.deepEqual(await snapshotTree(join(fx.home, 'session-purge', 'trash', entry.trashId)), before,
        'the payload must be byte-identical after the move');

    // Idempotent: a second attempt reports the existing entry instead of
    // creating a duplicate.
    const again = await trashSession(fx.ctx, fx.sessionId);
    assert.equal(again.mode, 'already');
    assert.equal(again.trashId, entry.trashId);
    assert.equal((await listTrashEntries(fx.ctx)).length, 1);
});

test('restoring puts the session back byte-for-byte and clears the entry', async () => {
    const fx = await fixture();
    const before = await snapshotTree(fx.sessionDir);
    await trashSession(fx.ctx, fx.sessionId, { title: 'x' });
    const [entry] = await listTrashEntries(fx.ctx);

    const restored = await restoreSession(fx.ctx, fx.sessionId);
    assert.equal(restored.ok, true);
    assert.equal(restored.restoredTo, fx.sessionDir);
    assert.equal(restored.wasArchived, false);
    assert.equal(restored.cwdMissing, true, 'the fixture cwd does not exist on disk');
    assert.deepEqual(await snapshotTree(fx.sessionDir), before);
    assert.equal(await exists(join(fx.home, 'session-purge', 'trash', entry.trashId)), false);
    assert.deepEqual(await listTrashEntries(fx.ctx), []);
    assert.deepEqual(await restoreSession(fx.ctx, fx.sessionId), { ok: false, code: 'unknown' });
});

test('restoring replays the archive flag and re-attaches the workspace', async () => {
    const fx = await fixture();
    const calls = [];
    fx.services.workspaceRegistry = {
        archivedSessionIds: [fx.sessionId],
        unarchiveSession: async (id) => { calls.push(['unarchive', id]); },
        archiveSession: async (id) => { calls.push(['archive', id]); },
        resolveByPath: async (path) => ({
            attachSession: async (id) => { calls.push(['attach', id, path]); },
        }),
    };
    await trashSession(fx.ctx, fx.sessionId);
    assert.deepEqual(calls, [['unarchive', fx.sessionId]],
        'trashing clears a stale archive marker');
    const [entry] = await listTrashEntries(fx.ctx);
    assert.equal(entry.wasArchived, true);

    calls.length = 0;
    const restored = await restoreSession(fx.ctx, fx.sessionId);
    assert.equal(restored.wasArchived, true);
    assert.deepEqual(calls.map((call) => call[0]), ['attach', 'unarchive', 'archive']);
});

test('a restore onto an existing directory is refused, not merged', async () => {
    const fx = await fixture();
    await trashSession(fx.ctx, fx.sessionId);
    // Something else now occupies the original path.
    await mkdir(fx.sessionDir, { recursive: true });
    await writeFile(join(fx.sessionDir, SESSION_LOG), 'other\n', 'utf8');

    const restored = await restoreSession(fx.ctx, fx.sessionId);
    assert.deepEqual(restored, { ok: false, code: 'conflict' });
    assert.equal((await listTrashEntries(fx.ctx)).length, 1, 'the entry must survive a refusal');
});

test('an entry outside the sessions root is refused by restore', async () => {
    const fx = await fixture();
    await trashSession(fx.ctx, fx.sessionId);
    const [entry] = await listTrashEntries(fx.ctx);
    const metaPath = join(fx.home, 'session-purge', 'trash', `${entry.trashId}.json`);
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    await writeFile(metaPath, JSON.stringify({ ...meta, originalDir: join(fx.home, 'elsewhere') }), 'utf8');

    const restored = await restoreSession(fx.ctx, fx.sessionId);
    assert.deepEqual(restored, { ok: false, code: 'unsupported' });
});

test('permanent delete removes payload and metadata; emptying the bin is idempotent', async () => {
    const fx = await fixture();
    await trashSession(fx.ctx, fx.sessionId);
    const [entry] = await listTrashEntries(fx.ctx);
    const payload = join(fx.home, 'session-purge', 'trash', entry.trashId);

    const purged = await purgeSession(fx.ctx, fx.sessionId);
    assert.equal(purged.ok, true);
    assert.equal(purged.freedBytes, entry.sizeBytes);
    assert.equal(await exists(payload), false);
    assert.deepEqual(await listTrashEntries(fx.ctx), []);

    const emptied = await emptyTrash(fx.ctx);
    assert.deepEqual(emptied, { ok: true, removed: 0, freedBytes: 0, failed: [] });
    assert.deepEqual(await purgeSession(fx.ctx, fx.sessionId), { ok: false, code: 'unknown' });
});

test('purgeEntry refuses an unknown or malformed id', async () => {
    const fx = await fixture();
    assert.deepEqual(await purgeEntry(fx.ctx, '../escape'), { ok: false, code: 'invalid' });
    assert.deepEqual(await purgeEntry(fx.ctx, 't-20261014T034105-a1b2c3'), { ok: true, trashId: 't-20261014T034105-a1b2c3', id: null, freedBytes: 0 });
});

test('the sweep deletes only entries past the retention window', async () => {
    const fx = await fixture();
    await trashSession(fx.ctx, fx.sessionId);
    const [entry] = await listTrashEntries(fx.ctx);
    const metaPath = join(fx.home, 'session-purge', 'trash', `${entry.trashId}.json`);

    // Fresh entry: nothing is due.
    let result = await sweepTrash(fx.ctx, { reason: 'test' });
    assert.equal(result.removed, 0);
    assert.equal((await listTrashEntries(fx.ctx)).length, 1);

    // Backdate it past 30 days.
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await writeFile(metaPath, JSON.stringify({ ...meta, deletedAt: old }), 'utf8');
    result = await sweepTrash(fx.ctx, { now: Date.parse(old) + 31 * 86_400_000, reason: 'test' });
    assert.equal(result.removed, 1);
    assert.deepEqual(await listTrashEntries(fx.ctx), []);

    // The sweep state is durable, so the scheduler can space sweeps out.
    const state = JSON.parse(await readFile(join(fx.home, 'session-purge', 'trash', '.state.json'), 'utf8'));
    assert.equal(typeof state.lastSweepAt, 'number');
    assert.equal(state.lastSweepRemoved, 1);
});

test('turning auto-clean off stops the sweep entirely', async () => {
    const fx = await fixture();
    // A real sweep first, so there is bookkeeping to compare against.
    assert.equal((await sweepTrash(fx.ctx, { reason: 'before' })).ok, true);
    const statePath = join(fx.home, 'session-purge', 'trash', '.state.json');
    const baseline = JSON.parse(await readFile(statePath, 'utf8')).lastSweepAt;

    await writeSettings(fx.ctx, { autoClean: false });
    await trashSession(fx.ctx, fx.sessionId);
    const [entry] = await listTrashEntries(fx.ctx);
    const metaPath = join(fx.home, 'session-purge', 'trash', `${entry.trashId}.json`);
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    await writeFile(metaPath, JSON.stringify({
        ...meta,
        deletedAt: new Date(Date.now() - 365 * 86_400_000).toISOString(),
    }), 'utf8');

    const result = await sweepTrash(fx.ctx, { reason: 'test' });
    assert.deepEqual(result, { ok: true, removed: 0, failed: [], skipped: 'disabled', reason: 'test' });
    assert.equal((await listTrashEntries(fx.ctx)).length, 1);
    // A skipped sweep must leave the bookkeeping alone: rewriting lastSweepAt
    // would make the settings page claim a sweep that never ran.
    const after = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(after.lastSweepAt, baseline);
    assert.equal(after.lastSweepRemoved, 0);
});

// ── crash recovery ─────────────────────────────────────────────────────────

test('recovery finalizes an interrupted move whose payload already arrived', async () => {
    const fx = await fixture();
    await trashSession(fx.ctx, fx.sessionId);
    const [entry] = await listTrashEntries(fx.ctx);
    const metaPath = join(fx.home, 'session-purge', 'trash', `${entry.trashId}.json`);
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    await writeFile(metaPath, JSON.stringify({ ...meta, status: 'moving' }), 'utf8');

    const result = await recoverTrash(fx.ctx);
    assert.equal(result.repaired, 1);
    const [recovered] = await listTrashEntries(fx.ctx);
    assert.equal(recovered.status, 'trashed');
});

test('recovery completes a move that never happened', async () => {
    const fx = await fixture();
    // Metadata written, directory never moved: the shape a crash between the
    // two steps leaves behind.
    await trashSession(fx.ctx, fx.sessionId);
    const [entry] = await listTrashEntries(fx.ctx);
    const bin = join(fx.home, 'session-purge', 'trash');
    const payload = join(bin, entry.trashId);
    // Put the session back where it was, payload gone, metadata still `moving`.
    await mkdir(fx.sessionDir, { recursive: true });
    await writeFile(join(fx.sessionDir, SESSION_LOG), 'header\n', 'utf8');
    await rm(payload, { recursive: true, force: true });
    await writeFile(join(bin, `${entry.trashId}.json`),
        JSON.stringify({ ...entry, status: 'moving' }), 'utf8');

    const result = await recoverTrash(fx.ctx);
    assert.equal(result.repaired, 1);
    assert.equal(await exists(payload), true);
    assert.equal(await exists(fx.sessionDir), false);
    assert.equal((await listTrashEntries(fx.ctx))[0].status, 'trashed');
});

test('recovery drops an entry whose session and payload are both gone', async () => {
    const fx = await fixture();
    await trashSession(fx.ctx, fx.sessionId);
    const [entry] = await listTrashEntries(fx.ctx);
    const bin = join(fx.home, 'session-purge', 'trash');
    await rm(join(bin, entry.trashId), { recursive: true, force: true });
    await writeFile(join(bin, `${entry.trashId}.json`),
        JSON.stringify({ ...entry, status: 'moving' }), 'utf8');

    const result = await recoverTrash(fx.ctx);
    assert.equal(result.repaired, 1);
    assert.deepEqual(await listTrashEntries(fx.ctx), []);
});

// ── the restart queue ──────────────────────────────────────────────────────

test('the boot queue keeps a still-held deletion and finishes the rest', async () => {
    const fx = await fixture();
    // A second session that this same pass can trash normally.
    const otherId = 'session-99999999-8888-7777-6666-555555555555';
    const otherDir = join(fx.sessionsRoot, fx.projectKey, otherId);
    await mkdir(otherDir, { recursive: true });
    await writeFile(join(otherDir, SESSION_LOG), 'header\n{"seq":2}\n', 'utf8');
    fx.state.entries.push({ id: otherId, cwd: join(fx.home, 'proj'), dir: otherDir });

    const pendingPath = join(fx.home, 'session-purge', 'pending.json');
    await mkdir(dirname(pendingPath), { recursive: true });
    await writeFile(pendingPath, JSON.stringify({ pending: [fx.sessionId, otherId] }), 'utf8');

    // fx.sessionId is resident while the internals a teardown needs are missing,
    // so its delete is re-queued for a later boot. The pass must not treat that
    // as progress: dropping it would forget the deletion forever.
    const services = {
        ...fx.services,
        sessions: {
            list: () => [{ id: fx.sessionId }],
            get: (id) => (id === fx.sessionId ? { id } : undefined),
        },
    };
    await boot(services, fx.home);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(JSON.parse(await readFile(pendingPath, 'utf8')).pending, [fx.sessionId],
        'the held deletion stays queued while the finished one leaves');
    assert.equal(await exists(fx.sessionDir), true, 'the held session must still be on disk');
    assert.equal(await exists(otherDir), false, 'the finished one really moved into the bin');
    assert.equal((await listTrashEntries(fx.ctx)).length, 1);
});

test('a session left on both sides of an interrupted move is named, not swallowed', async () => {
    const fx = await fixture();
    assert.equal((await trashSession(fx.ctx, fx.sessionId)).ok, true);
    const [entry] = await listTrashEntries(fx.ctx);
    const bin = join(fx.home, 'session-purge', 'trash');
    const payload = join(bin, entry.trashId);
    const metaPath = join(bin, `${entry.trashId}.json`);
    // The cross-volume window: the copy is published, the source has not been
    // removed yet, and the metadata still says `moving`.
    await cp(payload, fx.sessionDir, { recursive: true });
    await writeFile(metaPath, JSON.stringify({ ...entry, status: 'moving' }), 'utf8');

    await recoverTrash(fx.ctx);
    assert.equal(await exists(payload), true, 'the published copy stays in the bin');
    assert.equal(await exists(fx.sessionDir), true,
        'the leftover source is never deleted behind the user back');

    // Both actions must name the state instead of pretending to work: `conflict`
    // on restore (the folder is there) and `duplicate` on delete (it used to be
    // a silent `already`, which left a row the panel could never remove).
    assert.deepEqual(await restoreSession(fx.ctx, fx.sessionId), { ok: false, code: 'conflict' });
    assert.deepEqual(await trashSession(fx.ctx, fx.sessionId), { ok: false, code: 'duplicate' });

    // The way out: drop the bin copy, then delete the live one again.
    assert.equal((await purgeSession(fx.ctx, fx.sessionId)).ok, true);
    assert.equal((await trashSession(fx.ctx, fx.sessionId)).mode, 'trashed');
    assert.equal(await exists(fx.sessionDir), false);
});

// ── safety gates ───────────────────────────────────────────────────────────

test('a located artifact that is not a session log is refused', async () => {
    const fx = await fixture();
    fx.services.sessionPersistence.locate = () => ({
        kind: 'jsonl',
        path: join(fx.sessionDir, 'notes.txt'),
    });
    assert.deepEqual(await locateSessionDirectory(fx.ctx, fx.sessionId),
        { ok: false, code: 'unsupported' });
    assert.deepEqual(await trashSession(fx.ctx, fx.sessionId), { ok: false, code: 'unsupported' });
    assert.equal(await exists(fx.sessionDir), true, 'a refusal must not touch the directory');
});

test('an unknown session is reported, never guessed', async () => {
    const fx = await fixture();
    assert.deepEqual(await trashSession(fx.ctx, 'session-missing'), { ok: false, code: 'unknown' });
    assert.deepEqual(await trashSession(fx.ctx, '../evil'), { ok: false, code: 'invalid' });
});

test('purge refuses a payload that resolves outside the bin', async (t) => {
    const fx = await fixture();
    const outside = join(fx.home, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, SESSION_LOG), 'header\n', 'utf8');
    const trashId = makeTrashId();
    const bin = join(fx.home, 'session-purge', 'trash');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, `${trashId}.json`), JSON.stringify({
        schema: 1,
        trashId,
        id: 'session-x',
        title: null,
        cwd: null,
        originalDir: join(fx.sessionsRoot, '--p--', 'session-x'),
        sessionsRoot: fx.sessionsRoot,
        deletedAt: new Date().toISOString(),
        sizeBytes: 0,
        wasArchived: false,
        status: 'trashed',
    }), 'utf8');
    try {
        await symlink(outside, join(bin, trashId), process.platform === 'win32' ? 'junction' : 'dir');
    }
    catch {
        t.skip('linking directories is not permitted on this host');
        return;
    }
    assert.deepEqual(await purgeEntry(fx.ctx, trashId), { ok: false, code: 'unsupported' });
    assert.equal(await exists(join(outside, SESSION_LOG)), true);
});

test('emptying the bin reports the entries it could not purge', async (t) => {
    const fx = await fixture();
    // One ordinary entry the batch can remove…
    assert.equal((await trashSession(fx.ctx, fx.sessionId)).ok, true);
    // …and one whose payload resolves outside the bin, which purge must refuse.
    // The aggregate has to name it instead of reporting a clean sweep: the panel
    // keeps exactly the rows listed here.
    const outside = join(fx.home, 'outside-victim');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, SESSION_LOG), 'x', 'utf8');
    const trashId = makeTrashId();
    const bin = join(fx.home, 'session-purge', 'trash');
    await writeFile(join(bin, `${trashId}.json`), JSON.stringify({
        schema: 1,
        trashId,
        id: 'session-99999999-8888-7777-6666-555555555555',
        title: 'escaped',
        cwd: null,
        originalDir: join(fx.sessionsRoot, '--p--', 'session-99999999-8888-7777-6666-555555555555'),
        sessionsRoot: fx.sessionsRoot,
        deletedAt: new Date().toISOString(),
        sizeBytes: 1,
        wasArchived: false,
        status: 'trashed',
    }), 'utf8');
    try {
        await symlink(outside, join(bin, trashId), process.platform === 'win32' ? 'junction' : 'dir');
    }
    catch {
        t.skip('linking directories is not permitted on this host');
        return;
    }

    const result = await emptyTrash(fx.ctx);
    assert.equal(result.ok, true);
    assert.equal(result.removed, 1);
    assert.deepEqual(result.failed, [{ trashId, code: 'unsupported' }]);
    assert.deepEqual((await listTrashEntries(fx.ctx)).map((entry) => entry.trashId), [trashId],
        'the entry that could not be purged is still there to be retried');
});

test('the permanent-delete path still removes the directory it located', async () => {
    // The recycle bin shares the locate helper with `removeSessionLog`; this
    // pins the permanent path so a refactor of that helper cannot silently
    // turn it into a no-op (the legacy `repro-delete.mjs` harness caught
    // exactly that once).
    const fx = await fixture();
    const result = await deleteSession(fx.ctx, fx.sessionId);
    assert.deepEqual(result, {
        ok: true, mode: 'deleted', dir: fx.sessionDir, archived: false, name: null,
    });
    assert.equal(await exists(fx.sessionDir), false);
    assert.deepEqual(await listTrashEntries(fx.ctx), [], 'a permanent delete must not touch the bin');
});

// ── the routes a browser calls ─────────────────────────────────────────────

/**
 * Boot `apply()` against a fake webServer and return a `call()` that drives a
 * route the way HTTP does. This is the wire contract the panel depends on.
 */
async function boot(services, home) {
    const routes = new Map();
    const ctx = {
        dshHomePath: home,
        get: (name) => services[name],
        effect: (callback) => callback(),
        inject: (deps, callback) => {
            if (deps.includes('sessionPersistence') && services.sessionPersistence !== undefined) {
                callback(ctx);
            }
            if (deps.includes('webServer')) {
                callback({
                    effect: (inner) => inner(),
                    webServer: {
                        register: (route) => {
                            routes.set(route.path, route);
                            return () => {};
                        },
                    },
                });
            }
        },
    };
    apply(ctx, {});
    // Let the fire-and-forget boot maintenance settle before the first call.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const call = async (method, path, body, options = {}) => {
        const route = routes.get(path);
        assert.ok(route !== undefined, `route ${path} must be registered`);
        const listeners = new Map();
        const request = {
            method,
            headers: { host: '127.0.0.1:3080' },
            on(event, listener) {
                listeners.set(event, listener);
                return this;
            },
            destroy() {},
        };
        const response = {
            statusCode: null,
            payload: null,
            writeHead(status) { this.statusCode = status; return this; },
            end(chunk) { this.payload = chunk === undefined ? null : JSON.parse(chunk); },
        };
        const promise = route.handler(request, response);
        await Promise.resolve();
        if (body !== undefined) {
            // `raw` sends the string as given, so a malformed body can be driven
            // through the same path a broken client would use.
            listeners.get('data')?.(Buffer.from(options.raw === true ? body : JSON.stringify(body)));
        }
        listeners.get('end')?.();
        await promise;
        return { status: response.statusCode, body: response.payload };
    };
    return { call, routes };
}

test('the route surface serves the whole recycle-bin flow', async () => {
    const fx = await fixture();
    const { call, routes } = await boot(fx.services, fx.home);
    for (const path of ['/session-purge/trash', '/session-purge/restore', '/session-purge/purge',
        '/session-purge/empty', '/session-purge/sweep', '/session-purge/settings',
        '/session-purge/delete', '/session-purge/state', '/session-purge/undo']) {
        assert.ok(routes.has(path), `${path} must be registered`);
    }
    // The footer reads the RUNNING host's version from package.json.
    assert.match(version, /^\d+\.\d+\.\d+/);

    // Empty bin first.
    let response = await call('GET', '/session-purge/trash');
    assert.equal(response.status, 200);
    assert.equal(response.body.version, version, 'the bin read reports the host version');
    assert.deepEqual(response.body.entries, []);
    assert.equal(response.body.settings.retentionDays, 30);

    // Soft delete through the new route, with the title the row captured.
    response = await call('POST', '/session-purge/trash', { sessionId: fx.sessionId, title: '我的会话' });
    assert.equal(response.status, 200);
    assert.equal(response.body.mode, 'trashed');

    response = await call('GET', '/session-purge/trash');
    assert.equal(response.body.entries.length, 1);
    assert.equal(response.body.entries[0].title, '我的会话');
    assert.equal(await exists(fx.sessionDir), false);

    // The deprecated alias must also soft-delete, never hard-delete.
    response = await call('POST', '/session-purge/delete', { sessionId: fx.sessionId });
    assert.equal(response.status, 200);
    assert.equal(response.body.mode, 'already');

    // Settings round-trip.
    response = await call('POST', '/session-purge/settings', { retentionDays: 90 });
    assert.equal(response.status, 200);
    assert.equal(response.body.settings.retentionDays, 90);
    response = await call('POST', '/session-purge/settings', { retentionDays: 12 });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'settings-invalid');
    response = await call('GET', '/session-purge/settings');
    assert.equal(response.body.version, version, 'the settings read reports the host version');
    assert.equal(response.body.settings.retentionDays, 90, 'a refused write must not change anything');
    assert.equal(response.body.stats.count, 1);

    // Restore, then verify the state report sees it again.
    response = await call('POST', '/session-purge/restore', { sessionId: fx.sessionId });
    assert.equal(response.status, 200);
    assert.equal(response.body.restoredTo, fx.sessionDir);
    assert.equal(await exists(fx.sessionDir), true);
    response = await call('GET', '/session-purge/state');
    assert.equal(response.status, 200);
    assert.equal(response.body.trash.count, 0);

    // Trash again, then empty the bin (which demands an explicit confirm).
    await call('POST', '/session-purge/trash', { sessionId: fx.sessionId });
    response = await call('POST', '/session-purge/empty', {});
    assert.equal(response.status, 400);
    response = await call('POST', '/session-purge/empty', { confirm: true });
    assert.equal(response.status, 200);
    assert.equal(response.body.removed, 1);
    response = await call('GET', '/session-purge/trash');
    assert.deepEqual(response.body.entries, []);
});

test('a malformed or oversized body is answered as the caller\'s fault', async () => {
    const fx = await fixture();
    const { call } = await boot(fx.services, fx.home);

    // Malformed JSON: 400 on every POST route, including the one that used to
    // label it a storage outage (the client rendered that as "server down").
    for (const path of ['/session-purge/settings', '/session-purge/trash',
        '/session-purge/restore', '/session-purge/undo']) {
        const response = await call('POST', path, '{not json', { raw: true });
        assert.equal(response.status, 400, `${path} must answer 400 for a malformed body`);
        assert.equal(response.body.code, 'bad-request', `${path} must name the caller's fault`);
    }

    // Over the 8 KiB cap: 413, and the response must actually reach the client
    // (destroying the request mid-body used to surface as ECONNRESET).
    let response = await call('POST', '/session-purge/trash', { sessionId: 'x'.repeat(20_000) });
    assert.equal(response.status, 413);
    assert.equal(response.body.code, 'too-large');
    response = await call('POST', '/session-purge/settings', { retentionDays: 'x'.repeat(9_000) });
    assert.equal(response.status, 413);
    assert.equal(response.body.code, 'too-large');

    // And the refusals changed nothing.
    const settings = await call('GET', '/session-purge/settings');
    assert.equal(settings.body.settings.retentionDays, 30);
    assert.equal((await listTrashEntries(fx.ctx)).length, 0);
});

test('the sweep route honours the auto-clean switch', async () => {
    const fx = await fixture();
    const { call } = await boot(fx.services, fx.home);

    // One expired entry, with auto-clean ON: the route removes it.
    await call('POST', '/session-purge/trash', { sessionId: fx.sessionId });
    const metaPath = join(fx.home, 'session-purge', 'trash');
    const entryFiles = async () => (await readdir(metaPath))
        .filter((name) => name.endsWith('.json') && !name.startsWith('.'));
    const [entryName] = await entryFiles();
    const meta = JSON.parse(await readFile(join(metaPath, entryName), 'utf8'));
    await writeFile(join(metaPath, entryName), JSON.stringify({
        ...meta,
        deletedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    }), 'utf8');

    let response = await call('POST', '/session-purge/sweep', {});
    assert.equal(response.status, 200);
    assert.equal(response.body.removed, 1);
    assert.equal(response.body.skipped, undefined);

    // Auto-clean OFF: the same route reports why it did nothing. The sweep above
    // permanently deleted the payload, so the fixture materializes it again
    // (the stub persistence lists the session either way).
    await mkdir(fx.sessionDir, { recursive: true });
    await writeFile(join(fx.sessionDir, SESSION_LOG), 'header\n', 'utf8');
    await call('POST', '/session-purge/trash', { sessionId: fx.sessionId });
    const [secondName] = await entryFiles();
    const second = JSON.parse(await readFile(join(metaPath, secondName), 'utf8'));
    await writeFile(join(metaPath, secondName), JSON.stringify({
        ...second,
        deletedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    }), 'utf8');
    await call('POST', '/session-purge/settings', { autoClean: false });
    response = await call('POST', '/session-purge/sweep', {});
    assert.equal(response.body.removed, 0);
    assert.equal(response.body.skipped, 'disabled');
    assert.equal((await call('GET', '/session-purge/trash')).body.entries.length, 1);
});

test('a non-POST call and a cross-origin call are refused', async () => {
    const fx = await fixture();
    const { call } = await boot(fx.services, fx.home);
    const response = await call('GET', '/session-purge/trash');
    assert.equal(response.status, 200);
    // GET on a POST-only route.
    const bad = await call('GET', '/session-purge/restore');
    assert.equal(bad.status, 405);
});
