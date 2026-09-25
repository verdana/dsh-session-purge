#!/usr/bin/env node
/**
 * publish-npm — 这台机器上把 dsh-session-purge 发到 npm 的完整流程。
 *
 * 与 dsh-nord 的同名脚本是同一套发布纪律，差异都在这一份里：
 *   - 本仓库**没有构建步骤**（lib/client 就是发布内容），所以没有
 *     typecheck/build 闸门，只有 `npm test`；
 *   - tarball 必须有的文件是 lib/index.js + client/client.js（不是 lib/client.js）；
 *   - `--smoke` 不调 release-lab，而是用 tools/smoke-install.mjs 把打出来的
 *     tarball 装进隔离 home，验证「能装 + bundle 层生效 + Host 半边装载」。
 *
 * 为什么不是一行 `npm publish`：本机 `~/.npmrc` 的 registry 指向只读的腾讯
 * 镜像，发布前又有几项事实必须核查。脚本把它们串成带闸门的流水线：
 *
 *   1. 工作树闸门   —— 有未提交改动 / 不在主分支就停（发出去的东西必须对得上某个提交）
 *   2. 元数据核查   —— name/version/license/files/dsh 段齐不齐，LICENSE 版权人是否还是占位符，
 *                     repository 字段在不在（npm 页面靠它把 README 的相对图片路径指到仓库）
 *   3. test         —— `npm test`，失败即停
 *   4. tarball 核查 —— npm pack --json 拿真实文件清单，核对必须有的与绝不能有的
 *   5. registry 核查 —— 这个版本是否已存在、包名归谁、当前登录身份是否为维护者
 *   6. 发布         —— 默认不真发（只核查），要真发必须显式 --publish
 *
 * 本机三个坑（都已在脚本里处理）：
 *   - `~/.npmrc` 的 registry 指向 mirrors.cloud.tencent.com，镜像是只读的：
 *     `npm login` 与 `npm publish` 都必须显式给 `--registry https://registry.npmjs.org/`。
 *   - `~/.npmrc` 还有 proxy / https-proxy / strict-ssl=false，脚本原样继承，不覆盖。
 *   - 本机 Node 与 npm 都在 PATH 上，脚本不假设任何 unix 工具。
 *
 * 用法：
 *   node scripts/publish-npm.mjs                     # 完整核查 + 打 tarball，不发布
 *   node scripts/publish-npm.mjs --create-repo-field # 补上发布闸门会挡的 repository 字段
 *   node scripts/publish-npm.mjs --bump patch --publish
 *                                                    # 升版 → 核查 → 真发 → 打 git commit + tag
 *   node scripts/publish-npm.mjs --publish --otp 123456
 *   node scripts/publish-npm.mjs --publish --smoke   # 发完立刻把发布的版本装进隔离 home
 *
 * 走 npm script 时参数要放在 `--` 之后（npm 会吃掉自己认识的开关）：
 *   npm run release:check
 *   npm run release -- --smoke
 *   npm run release -- --bump patch --smoke
 *
 * CI 里用 NPM_TOKEN 环境变量即可，脚本会临时写一个仓库级 .npmrc 并在结尾删掉。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const TARBALL_DIR = join(ROOT, '.release-lab');
const TEMP_NPMRC = join(ROOT, '.npmrc');

// ── 这些是发布闸门的一部分，改这里等于改发布纪律 ────────────────────────────
/** tarball 里必须出现的文件（相对包根）。 */
const REQUIRED_FILES = [
    'package.json',
    'README.md',
    'LICENSE',
    'cordis.patch.yml',
    'lib/index.js',
    'client/client.js',
];
/** tarball 里绝不能出现的路径前缀/文件名。 */
const FORBIDDEN_FILES = [
    'src/',
    'tests/',
    'tools/',
    'scripts/',
    '.github/',
    '.release-lab/',
    '.probe-home/',
    'tsconfig.json',
    'pnpm-lock.yaml',
];
/** LICENSE 里等于没写版权人的占位符。 */
const PLACEHOLDER_HOLDERS = ['dsh-session-delete contributors', 'dsh-session-purge contributors', 'your name', '<you>', 'todo'];
/** 发布内容的体量下限：低于这个数字八成是文件被截断或打错了。 */
const MIN_BYTES = { 'lib/index.js': 15_000, 'client/client.js': 15_000 };

// ── 输出与退出 ───────────────────────────────────────────────────────────────
const paint = (code, text) => (process.stdout.isTTY ? `\u001B[${code}m${text}\u001B[0m` : text);
const dim = (text) => paint('2', text);
const bold = (text) => paint('1', text);
const green = (text) => paint('32', text);
const red = (text) => paint('31', text);
const yellow = (text) => paint('33', text);

function fail(message) {
    process.stderr.write(`\n${red('publish-npm:')} ${message}\n`);
    process.exit(2);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const opts = {
    publish: false,
    registry: PUBLIC_REGISTRY,
    tag: '',
    otp: '',
    bump: '',
    setLicense: '',
    createRepoField: false,
    provenance: false,
    allowDirty: false,
    allowBranch: false,
    noTests: false,
    dryRunPack: false,
    smoke: false,
    keepTarball: false,
    timeoutMs: 600_000,
};

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => argv[++i] ?? '';
    if (arg === '--publish') opts.publish = true;
    else if (arg === '--registry') opts.registry = value();
    else if (arg === '--tag') opts.tag = value();
    else if (arg === '--otp') opts.otp = value();
    else if (arg === '--bump') opts.bump = value();
    else if (arg === '--set-license') opts.setLicense = value();
    else if (arg === '--create-repo-field') opts.createRepoField = true;
    else if (arg === '--provenance') opts.provenance = true;
    else if (arg === '--allow-dirty') opts.allowDirty = true;
    else if (arg === '--allow-branch') opts.allowBranch = true;
    else if (arg === '--no-tests') opts.noTests = true;
    else if (arg === '--dry-run-pack') opts.dryRunPack = true;
    else if (arg === '--smoke') opts.smoke = true;
    else if (arg === '--keep-tarball') opts.keepTarball = true;
    else if (arg === '--yes' || arg === '-y') {
        process.stderr.write('publish-npm: --yes 已不需要（--publish 本身就是确认）；照常继续\n');
    }
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else if (arg.startsWith('-')) fail(`未知参数 ${arg}（--help 看用法）`);
    else fail(`多余的位置参数 ${arg}（这个脚本不接受位置参数）`);
}
opts.registry = opts.registry.endsWith('/') ? opts.registry : `${opts.registry}/`;

const reader = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
let PKG_NAME = reader.name;
let PKG_VERSION = reader.version;

function printHelp() {
    process.stdout.write(`用法: node scripts/publish-npm.mjs [选项]

默认行为：只核查（工作树/元数据/test/tarball/registry），不发布。

发布相关:
  --publish                真发布（这一个开关就是确认；不加则只核查）
  --registry <url>         目标 registry（默认 ${PUBLIC_REGISTRY}）
  --tag <tag>              发布 dist-tag（默认：预发布版本用 next，正式版用 latest）
  --otp <code>             2FA 一次性验证码
  --provenance             带 provenance 发布（需 CI 与 GitHub Actions 环境）
  --smoke                  发布成功后把该版本装进隔离 home 冒烟（tools/smoke-install.mjs）
  --keep-tarball           保留打出来的 tarball

发布前修正:
  --bump <patch|minor|major|prepatch|x.y.z>
                           升版（只改 package.json，git commit/tag 在发布成功后打）
  --set-license <holder>   把 LICENSE 里的版权人从占位符改成指定值
  --create-repo-field      按 git remote 补上 package.json 的 repository 字段

闸门相关:
  --allow-dirty            允许工作树有未提交改动（不推荐）
  --allow-branch           允许不在默认分支上发布（不推荐）
  --no-tests               跳过 npm test
  --dry-run-pack           只用 npm pack --dry-run 核查 tarball，不落盘
  --help, -h               看这段

经 npm 转发（参数必须在 -- 之后）:
  npm run release:check                             # 只核查
  npm run release -- --smoke                        # 发布；npm run release 已带 --publish
  npm run release -- --bump patch --smoke           # 升版发布

本机前提（脚本会检查，缺了会给出确切命令）:
  npm login --registry ${PUBLIC_REGISTRY}
`);
}

let stepIndex = 0;
function step(title) {
    stepIndex += 1;
    process.stdout.write(`\n${bold(`${stepIndex}. ${title}`)}\n`);
}
const ok = (text) => process.stdout.write(`   ${green('✓')} ${text}\n`);
const info = (text) => process.stdout.write(`   ${dim(text)}\n`);
const warn = (text) => process.stdout.write(`   ${yellow('!')} ${text}\n`);

// ── 进程 ─────────────────────────────────────────────────────────────────────
/** 跑一条命令；inherit 模式直接透传输出，其余捕获。 */
function run(command, args, options = {}) {
    return new Promise((settle) => {
        const started = Date.now();
        const child = spawn(command, args, {
            cwd: options.cwd ?? ROOT,
            env: { ...process.env, ...options.env },
            shell: process.platform === 'win32',
            windowsHide: true,
            stdio: options.inherit ? 'inherit' : 'pipe',
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => { stdout += chunk; });
        child.stderr?.on('data', (chunk) => { stderr += chunk; });
        const settleWith = (code) => settle({ code, stdout, stderr, ms: Date.now() - started });
        child.on('error', (error) => { stderr += error.message; settleWith(-1); });
        child.on('close', (code) => settleWith(code ?? -1));
    });
}

/** 同 npm 官方 registry 说话：直接 HTTP，避开本机 npm 的 registry 配置。 */
async function registryJson(path, registry = PUBLIC_REGISTRY) {
    const response = await fetch(new URL(path, registry), {
        headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
    });
    if (response.status === 404) return { status: 404, body: null };
    if (!response.ok) return { status: response.status, body: null };
    return { status: response.status, body: await response.json() };
}

function git(args) {
    const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    return { code: result.status ?? -1, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() };
}

// ── 1. 工作树闸门 ────────────────────────────────────────────────────────────
function checkWorktree() {
    step('工作树闸门');

    if (git(['rev-parse', '--is-inside-work-tree']).out !== 'true') {
        warn('不在 git 工作树里，跳过分支与改动检查');
        return;
    }

    const status = git(['status', '--porcelain']);
    const dirty = status.out.split('\n').filter((line) => line.trim() !== '');
    if (dirty.length > 0) {
        const shown = dirty.slice(0, 10).map((line) => `       ${line}`).join('\n');
        if (!opts.allowDirty) {
            fail(`工作树有 ${dirty.length} 处未提交改动，发出去的东西对不上任何提交：\n${shown}\n` +
                '       先提交，或加 --allow-dirty（不推荐）');
        }
        warn(`工作树有 ${dirty.length} 处未提交改动（--allow-dirty 已放行）\n${shown}`);
    } else {
        ok('工作树干净');
    }

    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
    const head = git(['rev-parse', '--short', 'HEAD']).out;
    const defaults = new Set(['main', 'master']);
    if (!defaults.has(branch) && !opts.allowBranch) {
        fail(`当前分支是 ${branch}，不是默认分支（main/master）：\n` +
            '       发布要落在主干上，或加 --allow-branch（不推荐）');
    }
    ok(`分支 ${branch} @ ${head}`);

    const tags = git(['tag', '--points-at', 'HEAD']).out;
    if (tags) info(`HEAD 上已有 tag: ${tags.split('\n').join(', ')}`);
}

// ── 2. 元数据核查 ────────────────────────────────────────────────────────────
function checkMetadata() {
    step('元数据核查');

    if (typeof PKG_NAME !== 'string' || PKG_NAME === '') fail('package.json 没有 name');
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(PKG_VERSION)) fail(`version 不是合法 semver：${PKG_VERSION}`);
    const scoped = PKG_NAME.startsWith('@');
    ok(`包名 ${PKG_NAME}（${scoped ? 'scoped，首次发布需要 --access public' : '无 scope，默认 public'}）`);
    ok(`版本 ${PKG_VERSION}${PKG_VERSION.includes('-') ? dim('（预发布，默认 dist-tag 用 next）') : ''}`);

    const license = typeof reader.license === 'string' ? reader.license : reader.license?.type;
    if (!license) fail('package.json 没有 license 字段，npm 会拒绝或用 UNLICENSED');
    ok(`license ${license}`);

    // LICENSE 文件的版权人：占位符等于没署名。
    // 注意本仓库是从 dsh-session-delete fork 来的，署名谁由你决定。
    const licensePath = join(ROOT, 'LICENSE');
    if (!existsSync(licensePath)) {
        warn('仓库里没有 LICENSE 文件（package.json 声明的 license 仍会被采用）');
    } else {
        const text = readFileSync(licensePath, 'utf8');
        const holder = /Copyright \(c\) \d{4} (?<holder>.+)/.exec(text)?.groups?.holder?.trim() ?? '';
        const gitName = git(['config', 'user.name']).out;
        if (holder === '' || PLACEHOLDER_HOLDERS.includes(holder.toLowerCase())) {
            if (opts.setLicense) {
                writeFileSync(licensePath, text.replace(/(Copyright \(c\) \d{4} ).+/, `$1${opts.setLicense}`));
                ok(`LICENSE 版权人已改成 ${opts.setLicense}`);
                if (opts.setLicense !== gitName && gitName) info(`（git user.name 是 ${gitName}，确认一下用哪个）`);
            } else {
                fail(`LICENSE 的版权人还是占位符 ${JSON.stringify(holder)}：\n` +
                    `       node scripts/publish-npm.mjs --set-license "${gitName || '<你的名字>'}"\n` +
                    '       或者手工改 LICENSE 第 3 行');
            }
        } else {
            ok(`LICENSE 版权人 ${holder}`);
        }
    }

    // repository 字段：npm 页面靠它把 README 里的相对图片指到仓库。
    const repo = typeof reader.repository === 'string' ? reader.repository : reader.repository?.url;
    if (!repo) {
        const remote = git(['config', '--get', 'remote.origin.url']).out;
        const slug = /github\.com[/:](?<slug>[^/]+\/[^/.#]+?)(?:\.git)?$/.exec(remote)?.groups?.slug;
        if (opts.createRepoField && slug) {
            const value = { type: 'git', url: `git+https://github.com/${slug}.git` };
            const packagePath = join(ROOT, 'package.json');
            const text = readFileSync(packagePath, 'utf8');
            const next = text.replace(/("license":\s*"[^"]*",)/, `$1\n  "repository": ${JSON.stringify(value, null, 2).replace(/\n/g, '\n  ')},`);
            if (next === text) {
                warn('没找到插入 repository 的位置，请手工加（放在 license 之后）');
            } else {
                writeFileSync(packagePath, next);
                reader.repository = value;
                ok(`已在 package.json 补上 repository: ${value.url}`);
            }
        } else {
            fail('package.json 没有 repository 字段 —— npm 页面上的 README 截图会是裂的：\n' +
                `       node scripts/publish-npm.mjs --create-repo-field${slug ? `（将从 ${slug} 生成）` : '（需要 git remote.origin.url 指向 GitHub）'}`);
        }
    } else {
        ok(`repository ${repo}`);
        if (!/^git\+https:\/\/github\.com\//.test(repo)) warn('repository 不是 git+https://github.com/... 形式，npm 页面取图可能失败');
    }

    const files = reader.files;
    if (!Array.isArray(files) || files.length === 0) {
        warn('package.json 没有 files 白名单，会把仓库里的东西全打进包');
    } else {
        ok(`files 白名单 ${files.length} 项: ${files.join(' ')}`);
        for (const forbidden of ['src', 'tests', 'tools', 'scripts']) {
            if (files.includes(forbidden)) warn(`files 里包含 ${forbidden}/ —— 确认这是你要的`);
        }
    }

    if (reader.publishConfig?.access) info(`publishConfig.access = ${reader.publishConfig.access}`);

    if (reader.dsh?.bundle?.patch === undefined) fail('package.json 的 dsh.bundle.patch 缺失 —— 这不是一个 dsh 插件包');
    ok(`dsh.bundle.patch ${reader.dsh.bundle.patch}`);
    if (reader.dsh?.client?.platform !== 'web') info('dsh.client.platform 不是 web（确认这是有意的）');
    else ok(`dsh.client.platform web，inject ${(reader.dsh.client.inject ?? []).length} 项`);

    // 本仓库没有构建步骤：lib/ 与 client/ 就是源码也是产物。
    info('本包无构建步骤（lib/client 即发布内容），不跑 typecheck/build');
}

// ── 3. 升版（可选）──────────────────────────────────────────────────────────
async function bumpVersion() {
    if (!opts.bump) return;
    step(`升版：${opts.bump}`);
    const before = PKG_VERSION;
    const result = await run('npm', ['version', opts.bump, '--no-git-tag-version', '--allow-same-version', '--ignore-scripts']);
    if (result.code !== 0) fail(`npm version ${opts.bump} 失败:\n${result.stderr.trim()}`);
    PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    ok(`${before} → ${PKG_VERSION}（只改了 package.json；commit 与 tag 在发布成功后打）`);
    info('注意：这一步之后工作树就是脏的，结尾的 git commit 会处理它');
}

// ── 4. test ─────────────────────────────────────────────────────────────────
async function runChecks() {
    step('测试');

    if (opts.noTests) {
        warn('--no-tests：跳过 npm test');
        return;
    }
    const scripts = reader.scripts ?? {};
    if (typeof scripts.test !== 'string') {
        warn('package.json 没有 test 脚本，跳过');
        return;
    }
    const result = await run('npm', ['test'], { inherit: true });
    if (result.code !== 0) fail('npm test 失败');
    ok(`测试通过（${(result.ms / 1000).toFixed(1)}s）`);
}

// ── 5. tarball 核查 ─────────────────────────────────────────────────────────
async function checkTarball() {
    step('tarball 核查');

    const args = ['pack', '--json'];
    if (opts.dryRunPack) args.push('--dry-run');
    else {
        mkdirSync(TARBALL_DIR, { recursive: true });
        args.push('--pack-destination', TARBALL_DIR);
    }
    const packed = await run('npm', args);
    if (packed.code !== 0) fail(`npm pack 失败:\n${packed.stderr.trim().split('\n').slice(-8).join('\n')}`);

    const at = packed.stdout.indexOf('{');
    if (at === -1) fail(`npm pack --json 没吐出 JSON:\n${packed.stdout.slice(0, 400)}`);
    const report = JSON.parse(packed.stdout.slice(at))[PKG_NAME];
    if (report === undefined) fail('npm pack --json 的报告里没有这个包');

    const paths = report.files.map((file) => file.path);
    for (const required of REQUIRED_FILES) {
        if (!paths.includes(required)) fail(`tarball 里缺 ${required}（files 白名单或文件放错位置了）`);
    }
    const stray = paths.filter((path) => FORBIDDEN_FILES.some((bad) => path === bad || path.startsWith(bad)));
    if (stray.length > 0) fail(`tarball 里混进了不该发布的文件：${stray.join(', ')}`);
    ok(`${paths.length} 个文件、解包 ${(report.unpackedSize / 1024).toFixed(1)}kB、tarball ${(report.size / 1024).toFixed(1)}kB`);
    for (const path of paths) info(path);
    if (report.version !== PKG_VERSION) fail(`tarball 里的版本是 ${report.version}，package.json 是 ${PKG_VERSION}`);
    ok(`tarball ${report.filename}，sha512 ${report.integrity.slice(0, 28)}…`);

    for (const [path, min] of Object.entries(MIN_BYTES)) {
        const entry = report.files.find((file) => file.path === path);
        if (entry !== undefined && entry.size < min) warn(`${path} 只有 ${entry.size}B（预期 ≥ ${min}B）—— 确认文件完整`);
    }

    return join(TARBALL_DIR, report.filename);
}

// ── 6. registry 核查 ────────────────────────────────────────────────────────
async function checkRegistry() {
    step(`registry 核查（${opts.registry}）`);
    if (opts.registry !== PUBLIC_REGISTRY) warn(`目标不是官方 registry：${opts.registry}`);

    const encoded = PKG_NAME.startsWith('@') ? PKG_NAME.replace('/', '%2f') : PKG_NAME;
    const { status, body } = await registryJson(encoded);
    let maintainers = [];

    if (status === 404) {
        ok(`${PKG_NAME} 在 registry 上还不存在 —— 这会是首次发布`);
        info('首次发布无 scope 包名默认 public；带 scope 需要 --access public');
    } else if (body === null) {
        fail(`查询 registry 失败（HTTP ${status}）—— 检查网络/代理，或 registry 地址`);
    } else {
        const versions = Object.keys(body.versions ?? {});
        if (body.name !== undefined && body.name !== PKG_NAME) {
            fail(`registry 上的 ${body.name} 与本地包名 ${PKG_NAME} 不是同一个包 —— 别发错了`);
        }
        if (versions.includes(PKG_VERSION)) {
            fail(`${PKG_NAME}@${PKG_VERSION} 已经发布过了 —— npm 不接受同版本重发：\n` +
                `       升版：node scripts/publish-npm.mjs --bump patch\n` +
                `       或看现有版本：npm view ${PKG_NAME} versions --registry ${opts.registry}`);
        }
        ok(`本地版本 ${PKG_VERSION} 尚未发布（registry 上已有 ${versions.length} 个版本，最新 ${body['dist-tags']?.latest ?? '?'}）`);
        if (body['dist-tags']?.latest !== undefined) {
            const latest = body['dist-tags'].latest;
            const order = compareSemver(PKG_VERSION, latest);
            if (order < 0) warn(`本地 ${PKG_VERSION} 低于 latest ${latest} —— 这次发布会成为非最新版`);
            else if (order === 0) fail(`本地版本与 latest 相同：${PKG_VERSION}`);
            else if (PKG_VERSION.includes('-') && !opts.tag) info(`预发布版本，默认发到 next，latest 仍是 ${latest}`);
        }
        maintainers = (body.maintainers ?? []).map((entry) => entry.name ?? entry);
        if (maintainers.length > 0) info(`维护者: ${maintainers.join(', ')}`);
    }

    const who = await run('npm', ['whoami', '--registry', opts.registry]);
    if (who.code !== 0) {
        if (process.env.NPM_TOKEN) {
            info('npm whoami 失败，但检测到 NPM_TOKEN —— 按 CI 用法继续，由发布那一步验证 token');
            return '<NPM_TOKEN>';
        }
        // 凭据存在却 401：只核查时不该被它挡住（真要发布时才必须解决）。
        const storedToken = [
            join(homedir(), '.npmrc'),
            join(ROOT, '.npmrc'),
        ].some((path) => existsSync(path) && readFileSync(path, 'utf8').includes('//registry.npmjs.org/:_authToken'));
        if (storedToken) {
            warn('npm whoami 返回 401，但 ~/.npmrc 里有 //registry.npmjs.org/:_authToken'); 
            warn('      该 token 可能已失效（或代理拦了 registry）—— 发布时才会真正验证');
            info(`      重新登录：npm login --registry ${opts.registry}`);
            info('      只核查模式继续；真要发布前请先确认登录身份');
            return '<stored-token?>';
        }
        fail(`没有登录 ${opts.registry}：\n` +
            `       npm login --registry ${opts.registry}\n` +
            '       （本机 ~/.npmrc 的 registry 指向腾讯镜像，不带 --registry 会去登录镜像）\n' +
            '       CI 里改用 NPM_TOKEN 环境变量');
    }
    const user = who.stdout.trim();
    ok(`已登录为 ${user}`);
    if (maintainers.length > 0 && !maintainers.includes(user)) {
        fail(`${user} 不是 ${PKG_NAME} 的维护者（现维护者：${maintainers.join(', ')}），发布会 403`);
    }
    return user;
}

/** 只够用的 semver 比较：前导数字逐段比，预发布版本低于同号正式版。 */
function compareSemver(a, b) {
    const parse = (value) => {
        const [core, pre] = value.split('-');
        return { nums: core.split('.').map(Number), pre: pre ?? '' };
    };
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < 3; i += 1) {
        if (left.nums[i] !== right.nums[i]) return left.nums[i] < right.nums[i] ? -1 : 1;
    }
    if (left.pre === right.pre) return 0;
    if (left.pre === '') return 1;
    if (right.pre === '') return -1;
    return left.pre < right.pre ? -1 : 1;
}

// ── 7. 发布 ─────────────────────────────────────────────────────────────────
async function doPublish() {
    step('发布');

    if (!opts.publish) {
        warn('未加 --publish：只到核查为止，没有真的发布');
        info('要发布：node scripts/publish-npm.mjs --publish');
        return { published: false };
    }

    const npmrcBackup = existsSync(TEMP_NPMRC) ? readFileSync(TEMP_NPMRC, 'utf8') : null;

    const tag = opts.tag || (PKG_VERSION.includes('-') ? 'next' : 'latest');
    const access = PKG_NAME.startsWith('@') ? ['--access', 'public'] : [];
    const args = ['publish', '--registry', opts.registry, '--tag', tag, ...access];
    if (opts.otp) args.push('--otp', opts.otp);
    if (opts.provenance) args.push('--provenance');

    info(`$ npm ${args.join(' ')}`);

    // 到这一步才碰凭据：核查阶段永远不写 .npmrc
    if (process.env.NPM_TOKEN) {
        if (npmrcBackup !== null && npmrcBackup.includes('_authToken')) {
            warn('仓库级 .npmrc 里已有 _authToken，不动它');
        } else {
            writeFileSync(TEMP_NPMRC, `${npmrcBackup ?? ''}//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`);
            info('已用 NPM_TOKEN 临时写了一个仓库级 .npmrc（结尾会删掉）');
        }
    }

    const result = await run('npm', args, { inherit: true });
    try {
        if (process.env.NPM_TOKEN && npmrcBackup === null) rmSync(TEMP_NPMRC, { force: true });
    } catch { /* 删不掉也不能影响结论 */ }
    if (result.code !== 0) {
        fail(`npm publish 失败（exit ${result.code}）—— 最常见的是没登录：\n` +
            `       npm login --registry ${opts.registry}\n` +
            '       其余：401/403 无权限；EOTP 需要 --otp；EPUBLISHCONFLICT 版本已存在');
    }
    return { published: true, tag, ms: result.ms };
}

async function verifyAfterPublish(tag) {
    step('发布后核对');
    const view = await run('npm', ['view', `${PKG_NAME}@${PKG_VERSION}`, 'version', 'dist.tarball', 'dist.integrity', '--registry', opts.registry]);
    if (view.code !== 0) warn(`registry 上还没查到这个版本（可能刚推上去，稍等再试）：${view.stderr.trim().split('\n')[0]}`);
    else {
        for (const line of view.stdout.trim().split('\n')) info(line);
        ok(`${PKG_NAME}@${PKG_VERSION} 已在 registry 上`);
    }
    const distTags = await run('npm', ['view', PKG_NAME, 'dist-tags', '--registry', opts.registry]);
    if (distTags.code === 0) {
        info(`dist-tags: ${distTags.stdout.trim().replace(/\n/g, ' ')}`);
        if (!distTags.stdout.includes(`${tag}: '${PKG_VERSION}'`) && !distTags.stdout.includes(`"${tag}": "${PKG_VERSION}"`)) {
            warn(`dist-tag ${tag} 的指向看起来不是 ${PKG_VERSION}，确认一下`);
        }
    }
}

// ── 8. 打 tag / 冒烟 ────────────────────────────────────────────────────────
function createGitTag(version) {
    step('git commit + tag');
    const tag = `v${version}`;
    if (git(['tag', '--list', tag]).out === tag) {
        warn(`${tag} 已存在，跳过`);
        return;
    }
    git(['add', 'package.json', 'LICENSE']);
    if (git(['diff', '--cached', '--quiet']).code === 0) info('没有待提交的元数据改动');
    else {
        const commit = git(['commit', '-m', `chore(release): ${tag}`]);
        if (commit.code !== 0) warn(`git commit 失败：${commit.err}`);
        else ok(`已提交 chore(release): ${tag}`);
    }
    const tagged = git(['tag', '-a', tag, '-m', tag]);
    if (tagged.code !== 0) warn(`git tag 失败：${tagged.err}`);
    else {
        ok(`已打 tag ${tag}`);
        info(`推送：git push && git push origin ${tag}`);
    }
}

async function smokeTest(tarballPath) {
    step('冒烟：把包装进隔离 home');
    // 真发布时从 registry 装发布的版本；只核查时（--dry-run-pack 之外）装本地 tarball。
    const spec = smokeTarget(tarballPath);
    info(`$ node tools/smoke-install.mjs ${spec}`);
    const result = await run(process.execPath, ['tools/smoke-install.mjs', spec], { inherit: true });
    if (result.code !== 0) {
        warn('冒烟没通过 —— registry 传播可能要等一会儿，或包本身有问题');
        warn(`手工重试：node tools/smoke-install.mjs ${spec}`);
        return;
    }
    ok('安装、bundle 层、Host 半边全部通过');
}

/**
 * 冒烟目标：刚发布的版本优先；否则退回到本地 tarball。
 * @param tarballPath - 本地 pack 出来的 tarball 路径（可能没有）。
 */
function smokeTarget(tarballPath) {
    if (opts.publish) return `${PKG_NAME}@${PKG_VERSION}`;
    return tarballPath ?? `${PKG_NAME}@${PKG_VERSION}`;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
    process.stdout.write(bold(`publish-npm: ${PKG_NAME}@${PKG_VERSION} → ${opts.registry}\n`));
    info(opts.publish ? red('模式：真发布') : '模式：只核查（默认，不会发布）');

    const startVersion = PKG_VERSION;
    const dirtyBefore = git(['status', '--porcelain']).out;
    checkWorktree();
    checkMetadata();
    await bumpVersion();
    if (opts.bump && dirtyBefore === '') info('（升版造成的改动已交给结尾的 git commit 处理）');
    await runChecks();
    const tarballPath = await checkTarball();
    const user = await checkRegistry();
    const publishResult = await doPublish();

    if (!publishResult.published) {
        if (opts.smoke) await smokeTest(tarballPath);
        process.stdout.write(`\n${bold('核查完成')}，没有发布。\n`);
        info(`tarball 在 ${TARBALL_DIR}（--dry-run-pack 可只看不落盘）`);
        info('发布：node scripts/publish-npm.mjs --publish   # 首次发布无需 --bump');
        if (!opts.keepTarball && !opts.dryRunPack) {
            rmSync(TARBALL_DIR, { recursive: true, force: true });
            info('tarball 已清理（--keep-tarball 可保留）');
        }
        return;
    }

    await verifyAfterPublish(publishResult.tag);
    if (opts.bump && startVersion !== PKG_VERSION) createGitTag(PKG_VERSION);
    if (opts.smoke) await smokeTest(undefined);

    process.stdout.write(`\n${green('发布完成')}：${PKG_NAME}@${PKG_VERSION}（dist-tag ${publishResult.tag}，发布者 ${user}）\n`);
    info(`用户安装：dsh plugin --profile web add ${PKG_NAME}`);
    if (!opts.keepTarball && !opts.dryRunPack) {
        rmSync(TARBALL_DIR, { recursive: true, force: true });
        info('tarball 已清理（--keep-tarball 可保留）');
    }
}

await main();
