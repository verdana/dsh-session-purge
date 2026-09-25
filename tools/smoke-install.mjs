/**
 * smoke-install — gate 7 of `scripts/publish-npm.mjs`.
 *
 * Installs a packed module (tarball path, package name, or any spec pnpm
 * accepts) into a THROWAWAY DSH home, boots `dsh web` on a free port, and
 * checks the three things a package can plausibly get wrong:
 *
 *   1. the profile accepts the bundle  → `dsh plugin add` exits 0 and the
 *      dependency + `dsh.profile.bundles` entry appear in the profile manifest;
 *   2. the host half loads             → `GET /session-purge/state` answers 200
 *      with `persistence: true` (its HTTP route only exists if the plugin's
 *      `apply()` ran);
 *   3. it sees a real session          → the fixture session is listed.
 *
 * The user's own `~/.dsh` is never touched: DSH_HOME points at a temp directory
 * and the fixture is copied from the repo's `.playwright-mcp/devhome` when
 * present, otherwise created empty.
 *
 * Every external step has its own deadline, and the spawned server is killed as
 * a process TREE (on Windows `dsh` is a .cmd shim, so killing the shell would
 * orphan the real server).
 *
 * Usage:
 *   node tools/smoke-install.mjs <spec> [--keep] [--port 3099] [--timeout 180]
 * Examples:
 *   node tools/smoke-install.mjs ./dsh-session-purge.tgz
 *   node tools/smoke-install.mjs dsh-session-purge@0.4.1
 */
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_NAME = 'dsh-session-purge';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--port', '--timeout']);
const positionals = [];
const flags = new Map();
for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) flags.set(arg, argv[++i] ?? '');
    else if (arg.startsWith('-')) flags.set(arg, true);
    else positionals.push(arg);
}
const spec = positionals[0];
const keep = flags.has('--keep');
const serverPort = Number(flags.get('--port') ?? 3099);
const STEP_TIMEOUT_MS = Number(flags.get('--timeout') ?? 180) * 1000;

if (spec === undefined) {
    process.stderr.write('usage: node tools/smoke-install.mjs <spec> [--keep] [--port N] [--timeout S]\n');
    process.exit(2);
}

// ── output ───────────────────────────────────────────────────────────────────
let stepIndex = 0;
const step = (text) => process.stdout.write(`\n${(stepIndex += 1)}. ${text}\n`);
const ok = (text) => process.stdout.write(`   ✓ ${text}\n`);
const info = (text) => process.stdout.write(`   ${text}\n`);
function fail(text) {
    process.stderr.write(`\n   ✗ ${text}\n`);
    cleanup();
    process.exit(1);
}

// ── process helpers ──────────────────────────────────────────────────────────
const children = new Set();

function track(child) {
    children.add(child);
    child.on('close', () => children.delete(child));
    return child;
}

/** Kill a process and its descendants (Windows shims make kill() insufficient). */
function killTree(child) {
    if (child === undefined || child.exitCode !== null || child.pid === undefined) return;
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    }
}

function cleanup() {
    for (const child of [...children]) killTree(child);
}

/** Run a command to completion under a deadline. */
function run(command, args, options = {}) {
    return new Promise((settle) => {
        const started = Date.now();
        const child = track(spawn(command, args, {
            cwd: options.cwd ?? REPO,
            env: { ...process.env, ...options.env },
            shell: process.platform === 'win32',
            windowsHide: true,
            detached: process.platform !== 'win32',
            stdio: options.inherit ? 'inherit' : 'pipe',
        }));
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => { stdout += chunk; });
        child.stderr?.on('data', (chunk) => { stderr += chunk; });
        const timer = setTimeout(() => {
            killTree(child);
            settle({ code: -2, stdout, stderr: `${stderr}\n[timeout after ${String(options.timeoutMs ?? STEP_TIMEOUT_MS)}ms]`, ms: Date.now() - started });
        }, options.timeoutMs ?? STEP_TIMEOUT_MS);
        child.on('error', (error) => { clearTimeout(timer); settle({ code: -1, stdout, stderr: `${stderr}${error.message}`, ms: Date.now() - started }); });
        child.on('close', (code) => { clearTimeout(timer); settle({ code: code ?? -1, stdout, stderr, ms: Date.now() - started }); });
    });
}

/** Poll until the predicate returns a value, or throw at the deadline. */
async function waitFor(label, predicate, timeoutMs = STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    for (;;) {
        try {
            const value = await predicate();
            if (value !== undefined) return value;
        }
        catch (error) {
            lastError = error;
        }
        if (Date.now() > deadline) {
            throw new Error(`${label} 在 ${String(Math.round(timeoutMs / 1000))}s 内没有就绪${lastError === undefined ? '' : `：${String(lastError.message ?? lastError)}`}`);
        }
        await new Promise((r) => setTimeout(r, 500));
    }
}

// ── main ─────────────────────────────────────────────────────────────────────
let home;
let server;
try {
    step(`隔离 home：准备中`);
    home = await mkdtemp(join(tmpdir(), 'dsh-smoke-'));
    info(home);
    const fixture = join(REPO, '..', '.playwright-mcp', 'devhome');
    await mkdir(join(home, 'profiles', 'web'), { recursive: true });
    if (existsSync(fixture)) {
        await cp(join(fixture, 'sessions'), join(home, 'sessions'), { recursive: true });
        await cp(join(fixture, 'storages'), join(home, 'storages'), { recursive: true }).catch(() => {});
        await cp(join(fixture, 'settings.yaml'), join(home, 'settings.yaml')).catch(() => {});
        ok('会话夹具来自 .playwright-mcp/devhome');
    } else {
        await mkdir(join(home, 'sessions'), { recursive: true });
        info('没有夹具目录，用空 sessions（只验证插件是否装载）');
    }
    await writeFile(join(home, 'profiles', 'web', 'cordis.yml'), '# smoke-install profile root\n[]\n', 'utf8');
    await writeFile(
        join(home, 'profiles', 'web', 'package.json'),
        `${JSON.stringify({
            name: 'dsh-profile-web',
            private: true,
            dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' } },
        }, null, 2)}\n`,
        'utf8',
    );

    step(`安装：dsh plugin --profile web add ${spec}`);
    const add = await run('dsh', ['plugin', '--profile', 'web', 'add', spec], {
        cwd: home,
        env: { DSH_HOME: home },
        inherit: true,
    });
    if (add.code === -2) fail(`dsh plugin add 超时（${String(STEP_TIMEOUT_MS / 1000)}s）—— 代理/registry 不通？`);
    if (add.code !== 0) fail(`dsh plugin add 失败（exit ${String(add.code)}）`);
    const installed = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8'));
    if (installed.dependencies?.[PKG_NAME] === undefined) fail(`profile 依赖里没有 ${PKG_NAME}`);
    ok(`依赖已登记：${PKG_NAME} = ${installed.dependencies[PKG_NAME]}`);
    if (!(installed.dsh?.profile?.bundles ?? []).includes(PKG_NAME)) {
        fail(`dsh.profile.bundles 里没有 ${PKG_NAME} —— 包的 dsh.bundle.patch 没被识别`);
    }
    ok('已进入 dsh.profile.bundles（bundle 层被识别）');

    step(`启动 dsh web（127.0.0.1:${String(serverPort)}）`);
    server = track(spawn('dsh', ['--profile', 'web', '--no-open', '--port', String(serverPort), '--host', '127.0.0.1'], {
        cwd: home,
        env: { ...process.env, DSH_HOME: home },
        shell: process.platform === 'win32',
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
    }));
    let output = '';
    server.stdout.on('data', (chunk) => { output += chunk; });
    server.stderr.on('data', (chunk) => { output += chunk; });
    server.on('close', (code) => { output += `\n[server exited ${String(code)}]`; });

    try {
        await waitFor('服务器启动', async () => (output.includes('http://127.0.0.1:') ? true : undefined));
    }
    catch (error) {
        fail(`${String(error.message)}\n${output.slice(-1200)}`);
    }
    ok('已启动');

    const state = await waitFor('插件路由 /session-purge/state', async () => {
        const response = await fetch(`http://127.0.0.1:${String(serverPort)}/session-purge/state`, {
            headers: { Host: `127.0.0.1:${String(serverPort)}` },
            signal: AbortSignal.timeout(4000),
        });
        if (response.ok) return response.json();
        if (response.status !== 404) throw new Error(`HTTP ${String(response.status)}`);
        return undefined;
    }).catch((error) => fail(`${String(error.message)}\n${output.slice(-1200)}`));

    ok(`GET /session-purge/state → 200（persistence=${String(state.persistence)}，sessions=${String(state.sessions?.length ?? 0)}）`);
    if (state.persistence !== true) fail('persistence=false —— sessionPersistence 没有挂上');
    if ((state.sessions?.length ?? 0) === 0) info('（夹具里没有会话；HTTP 路由本身已验证）');
    else ok(`看到夹具会话：${state.sessions[0].id}`);

    process.stdout.write(`\n冒烟通过：${spec} 可安装、bundle 层生效、Host 半边装载。\n`);
}
catch (error) {
    process.stderr.write(`\n   ✗ 冒烟异常：${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
}
finally {
    cleanup();
    if (home !== undefined) {
        if (keep) process.stdout.write(`\n保留隔离 home：${home}\n`);
        else await rm(home, { recursive: true, force: true }).catch(() => process.stdout.write(`\n（清理 ${home} 失败，可手工删）\n`));
    }
}
