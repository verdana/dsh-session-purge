# dsh-session-purge

一个 DeepSeek Harness (DSH) 插件：给会话行菜单增加「删除会话」项（与
重命名 / 分叉会话 / 归档会话 并列），**永久删除**所选会话的全部磁盘记录
（`~/.dsh/sessions/.../<session-id>/`）。

上游 DSH 对会话只有「重命名 / 分叉 / 归档」——归档只是隐藏，数据永远留在
磁盘上。这个插件补上真正的删除。

> 本仓库是 `dsh-session-delete` 的修复分支（v0.4.0 起改名为
> `dsh-session-purge`）。原版每次删除都会失败，原因见下面「修复记录」。

## 修复记录（v0.4.0）

1. **快照取值错误 —— 每次删除都报「未找到该会话的记录」。**
   `sessionPersistence.list()` 返回的是 `SessionPersistenceSnapshot`
   （`{ header, revision, sizeBytes? }`），会话 id 在 `header.id`，快照本身没有
   顶层 `id`。原代码用 `h.id === sessionId` 匹配，永远匹配不到，于是直接返回
   `code: 'unknown'`，**磁盘上什么都没删**。

2. **路径分隔符写死 `/` —— Windows 上永远报「存储后端不支持该操作」。**
   `locate().path` 是 `node:path.join` 生成的**原生**路径，Windows 下用反斜杠；
   原代码用 `lastIndexOf('/')` 切分，得到 `-1`，于是返回 `code: 'unsupported'`。
   即便修好第 1 条，这台机器上依然删不掉。现在改用 `node:path`
   （`dirname`/`basename`/`isAbsolute`）。

3. **安全校验换成可证明的判据。** 原校验要求目录名严格等于会话 id，但后端用
   `encodeSegment()` 转义目录名，两者并不总是相等。现在改为：路径必须是绝对路径，
   文件名必须匹配规范日志名（`session[.vN].jsonl[.zstd]`），才允许删除其所在目录。
   宁可拒绝，也不会删错目录。

4. **删除结果可见且简洁。** 成功响应带 `name` / `dir` / `archived`；确认弹窗在完成后
   只保留一行结果（`已删除会话「<名称>」。`），不再复述目录与警告。
   `GET /session-purge/state` 返回持久层当前列出的全部会话
   （id / 标题 / 大小 / 是否在内存 / 是否已归档），用来核对「到底删掉没有」。

5. **一次点击只弹一个窗。** 客户端热更新可能留下上一份插件实例，两份实例各自持有
   菜单项与监听器，同一击就会弹两次。现在：菜单项点击用
   `stopImmediatePropagation()` 仲裁（本实例抢到后其他实例直接返回、
   不再各自弹窗），并且全局只允许存在一个 `.sd-dlg-host`（重复的会被移除、
   遗留的会被接管）。回归脚本 `tools/dialog-probe-double.mjs` 会在页面里
   再加载一份插件并种一个「竞争者」监听器，验证它触发次数为 0。

6. **命名统一。** 插件 id、HTTP 路由（`/session-purge/*`）、客户端 fetch、
   `cordis.patch.yml`、包名全部由 `session-delete` 改为 `session-purge`；
   旧的待删队列 `~/.dsh/session-delete/pending.json` 仍会被读取一次，升级不丢队列。

7. **健壮性与可移植性收敛。** 见下面「代码审查修复」与「Linux / macOS 兼容性」。

### 回归验证

```sh
npm test                      # tools/helpers.test.mjs：快照取值 + 路径推导 + 字典一致性
node tools/repro-delete.mjs   # 用真实 JSONL 后端 + 真实会话日志副本跑通整条删除链路
```

`tools/repro-delete.mjs` 会先打印「修复前」的判定（`h.id` 匹配失败、
`lastIndexOf('/') === -1`），再把一份真实日志副本（本机没有会话时**用后端自己造一份**）
按 `~/.dsh/sessions` 的目录结构放进临时目录，调用真实的 `removeSessionLog()`，
断言目录确实消失、真实日志未被触碰。

浏览器侧回归（需要一个隔离实例，不会碰真实 `~/.dsh`）：

```sh
pwsh -NoProfile -File tools/probe-setup.ps1          # 造 .probe-home（含测试会话）
$env:DSH_HOME = 'D:\deepseek-harness\dsh-session-purge\.probe-home'
dsh --profile web --no-open --port 3081 --host 127.0.0.1   # 记下打印出的 token URL
node tools/dialog-probe.mjs        "http://127.0.0.1:3081/?token=..."
node tools/dialog-probe-double.mjs "http://127.0.0.1:3081/?token=..."
```

脚本用 Playwright（Edge）驱动真实 GUI，导出每一步 `.sd-dlg` 的数量与文案；
`dialog-probe-double.mjs` 额外模拟「热更新残留的第二份实例」。
（Playwright + Edge 是本机开发环境自带的；非 Windows 上把 `channel: 'msedge'`
换成 `'chrome'` 或删掉该选项用自带 Chromium 即可。）

## 代码审查修复（v0.4.1）

| 问题 | 后果 | 处理 |
| --- | --- | --- |
| `ctx.get('sessionPersistence').list()` 抛错（存储故障）直接冒泡 | 变成 `400 bad-request`，前端显示「请求格式错误」，误导排查 | 新增 `service()` 帮助函数：取服务失败/缺方法都降级为「服务缺失」；`list`/`locate` 抛错归类为 `code: 'storage'`，HTTP **503** |
| 同一次 `list()` 结果被 `locate` 用 `snapshot.header ?? snapshot` 二次猜测 | 形状不匹配时静默走错分支 | 明确取 `snapshot.header`，`locate` 只接受 header |
| 待删队列路径写死 `~/.dsh` | `DSH_HOME` 重定位后队列写到没人读的地方 | 按 harness 自己的优先级解析（`dshHomePath` → `$DSH_HOME` → `~/.dsh`） |
| 队列读取逐个 `await` | 前一个文件不可读会挡住后一个的条目 | 改 `Promise.allSettled` 并行读取 |
| 入队写盘失败被吞掉 | 返回「已排队」但其实没排上，删除彻底丢失 | 写盘失败返回 `storage`，不再谎报 `queued` |
| 控制器 `tearDownResident` 第 4 步失败时，第 3 步已经摘掉 agent 注册 | 留下「有 agent 但不在注册表里」的悬挂态 | 失败时用 `agents.enter()` 回滚注册（`enter` 不重复 announce） |
| `residentSessionIds`/`diskSessionReport` 里 `agents.list()` 抛错 | `/state` 直接 500 | 全部包 try/catch，诊断接口保持可用 |
| 根目录下的日志（`/session.v3.jsonl.zstd`）会算出 `/` | 理论上可能对根目录执行递归删除 | 拒绝 `dirname` 等于路径根的情形（新增测试覆盖） |
| 每次取服务失败都 `console.error` | 启动日志里出现「service unavailable」，看起来像故障 | 常规拒绝改走 `debugLog`（`DSH_PURGE_DEBUG=1` 才输出）；真正影响用户操作的失败仍无条件打印 |
| 跨平台断言未声明路径风格 | 同一条测试在 Windows 通过、在 Linux 失败（WSL 里 `node` 常被 interop 到 Windows，更掩盖问题） | 测试显式传入 `path.posix`/`path.win32`，并在开头打印本次运行的 host 与路径风格 |

## Linux / macOS 兼容性

### 「能不能跑」——已逐项核对

| 环节 | 平台相关点 | 结论 |
| --- | --- | --- |
| 路径推导 | 原实现写死 `/` | 改用 `node:path`（`basename`/`dirname`/`isAbsolute`/`parse`），且把 path 风格做成可注入参数 |
| 删除目录 | 不用 shell `rm` | `fs.rm({recursive, force})` + 3 次重试，三平台同一路径 |
| 队列写盘 | 原子替换 | `writeFile(tmp)` + `rename`，POSIX/macOS/Windows 都原子 |
| 家目录 | 写死 `.dsh` | 按 `dshHomePath` → `$DSH_HOME` → `~/.dsh` 解析（`homedir()` 在两平台均正确） |
| HTTP | `sameOrigin` 用 `URL` | 与平台无关；仅监听 `127.0.0.1` 时 Origin 缺省即放行 |
| 浏览器侧 | 纯 DOM / React | 无本地依赖；`MutationObserver`、`closest`、`dataset` 全平台一致 |
| 原生依赖 | 无 | 插件本身零依赖、零编译、不调外部进程 |

也就是说：**没有一处代码需要按平台分支**，唯一曾经的平台缺陷（写死 `/`）已经修掉。

### 「怎么测」——两条路径

**1) 全量（含真实删除链路）：在 Linux/macOS 上跑**

```sh
npm test                       # 纯逻辑，零依赖
node tools/repro-delete.mjs    # 需要能解析到 @deepseek-ai/dsh-session-persistence-jsonl
```

`repro-delete.mjs` 的后端解析顺序：`DSH_WEB_APP_DIR` → pnpm 全局目录
（Linux `$XDG_DATA_HOME|~/.local/share/pnpm`、macOS `~/Library/pnpm`、Windows `%LOCALAPPDATA%`）
→ 报错并给出提示。机器上装过 dsh（`dsh web` 跑得起来）就一定能解析到；本机没有会话日志时，
脚本会用后端自建一份夹具，所以**不需要任何真实会话数据**。

**2) 不用 Linux 机器：CI 矩阵 + 容器/WSL**

`.github/workflows/ci.yml` 已是三平台矩阵：`ubuntu-latest` / `macos-latest` /
`windows-latest`，各跑一遍语法检查、清单检查与 `tools/helpers.test.mjs`；
另有 Node 22/24 的版本矩阵。其中：

- `sessionDirectoryFromLogPath` 用**注入的** `path.posix` / `path.win32` 分别验证，
  所以在 Windows 上也能证明 POSIX 分支正确（反之亦然）——这是本次重构的主要目的之一；
- 「真实目录布局」用例走真实 `mkdir`/`writeFile`/`rm`，三平台跑的就是各自的真实分隔符与 `fs.rm`。

本机想验证 Linux 行为且不想开 CI —— **注意 WSL 的坑**：

```sh
# ❌ 这样不算测 Linux：如果 WSL 里没装 Linux 版 node，node 会被 interop 到
#    Windows 的 node.exe，process.platform 仍是 'win32'，走的是 Windows 路径语义。
wsl -e bash -lc 'cd /mnt/d/.../dsh-session-purge && node --test tools/helpers.test.mjs'

# ✅ 先确认 node 真的是 Linux 版（打印出 linux 才有意义）
wsl -e bash -lc 'uname -s; node -p "process.platform"'

# ✅ 或用容器：真 Linux、零依赖、秒级
docker run --rm -v "$PWD":/w -w /w node:22 node --test tools/helpers.test.mjs
```

测试开头会打印一行 `# host: node vX on <platform> — path flavor <flavor>`，
先看这一行就知道这次跑的是哪种路径语义（WSL interop 时会显示 `win32`）。

即使没有 Linux 机器，**POSIX 分支也已被覆盖**：参数化用例显式传入 `path.posix`
与 `path.win32`，在 Windows 上跑也会验证 POSIX 语义（反之亦然）——
之前那条「Windows 路径在 Linux 上必须被拒绝」的断言就是靠这个暴露出来的。

**3) 真机端到端（GUI 删除）**

```sh
pwsh -NoProfile -File tools/probe-setup.ps1   # 仅 Windows；其它平台按下文手工建 .probe-home
DSH_HOME="$PWD/.probe-home" dsh --profile web --no-open --port 3081 --host 127.0.0.1
node tools/dialog-probe.mjs "http://127.0.0.1:3081/?token=<打印出的 token>"
```

`.probe-home` 结构与真实 `~/.dsh` 相同（`profiles/web`、`sessions/`、`storages/`），
把插件用 junction/symlink 链进 `profiles/web/node_modules` 并把 `dsh-session-purge`
写进 `profiles/web/package.json` 的 `dsh.profile.bundles` 即可。

### 尚未覆盖的部分（如实说明）

- `tools/dialog-probe*.mjs` 依赖 Playwright + 本机浏览器，**没有**做进 CI；
- `/state` 的 `archived` 字段依赖工作区注册表，在纯夹具环境里读不到真实分组数据；
- 常驻会话（严格空闲）的 teardown 路径依赖 dsh 运行时内部结构，只有真机端到端才能覆盖。

## 入口

会话行菜单：鼠标悬停任意会话行 → 点 `⋯` → 「删除会话」（红色危险样式，
与工作区菜单的删除按钮同款）。确认弹窗两步操作，成功后弹窗只提示
`已删除会话「<名称>」。`

> 已归档的会话不再出现在侧边栏，因此无法从菜单删除。如需删除归档会话，可从
> `~/.dsh/storages/workspace.json` 的 `archivedSessionIds` 里移出使其重新显示，
> 或直接删 `~/.dsh/sessions/<workspace-dir>/<session-id>/` 目录。

## 技术要点（菜单注入）

上游会话菜单项硬编码在 `dsh-client-ui-workspace` 里、没有扩展插槽；所有共享
UI 原语（primitives）种子模块被 `Object.freeze` 冻结，组件级猴子补丁赋值会
**静默失败**。因此 v0.2.1 改为 DOM 级注入：

- 捕获阶段 `document` click 监听：点会话行的 `⋯` 按钮时，沿 React fiber
  上溯到 `SessionNodeItem` 的 `node` prop 捕获会话 id（失败时退回
  aria-label 标题匹配）；
- `MutationObserver` 监听 body：当挂载的 `div[role=menu]` 恰好是
  「重命名/分叉会话/归档会话」三项时，克隆最后一项的 DOM 结构，替换图标与
  文案为「删除会话」并染成危险红，追加进菜单；
- 点击该项：派发 Escape 关闭上游菜单，再用独立的 `createRoot` 渲染确认
  弹窗（不依赖任何冻结模块）；
- 卸载/热更新时移除监听、观察器与注入的 DOM 节点。

## 安全设计

- 运行中（`status !== 'idle'`）或正在压缩收尾（`phase !== idle`）的会话禁止删除
  （前端禁用 + Host 侧二次校验）
- 只删除由 `sessionPersistence.locate()` 定位、且文件名可证明是会话日志的目录
- HTTP 路由仅接受同源请求；删除/撤销仅接受 POST
- 两步确认（删除 → 红色确认按钮）后才执行
- 删除后自动归档，侧边栏即时隐藏该行
- 内存内常驻会话：严格空闲时按官方 `AgentHandle.dispose()` 的顺序释放
  （flush → 释放 scope fiber → 从 agents/sessions 注册表摘除）后再删日志；
  运行时内部结构不可用时降级为「重启后删除」队列

## 安装

```sh
# 从 npm 安装（推荐）
dsh plugin --profile web add dsh-session-purge

# 从 GitHub 仓库安装
dsh plugin --profile web add github:verdana/dsh-session-purge

# 或 Release 预构建 tarball
dsh plugin --profile web add <release-tarball-url>

# 或本地开发（link: 免复制，改完源码直接生效）
dsh plugin --profile web add link:D:/deepseek-harness/dsh-session-purge
```

`dsh plugin add` 会把包写进 `~/.dsh/profiles/web/package.json` 的依赖，并自动在
`dsh.profile.bundles` 里补上 `"dsh-session-purge"`（前提是包声明了
`dsh.bundle.patch`）。装完重启 `dsh web`。升级：`dsh plugin --profile web update dsh-session-purge`。

> 本地开发注意：`link:` 依赖是指向源码目录的链接，改完 `lib/index.js` /
> `client/client.js` 无需重新安装；客户端热更新在下次轮询时生效，Host 侧改动
> 通常需要重启 `dsh web`。
>
> 但要注意 pnpm 的脾气：再跑一次 `dsh plugin add`（或 `install`）有可能把这条
> 链接换成一份**拷贝**，之后改源码就不生效了。判断方法：看
> `~/.dsh/profiles/web/node_modules/dsh-session-purge` 是不是 junction/symlink
> （Windows 上 `Get-Item <path> | Select LinkType`）。

## 发布到 npm

一行 `npm publish` 在这个仓库里不够用：本机 `~/.npmrc` 的 registry 指向只读的
腾讯镜像，而发布前有几项事实必须核查。`scripts/publish-npm.mjs` 把它们串成一条
带闸门的流水线，**默认只核查不发布**：

```sh
npm run release:check              # 六道闸门 + tarball 内容清单，不发布
npm run release                    # 真发布
npm run release -- --smoke         # 发布 + 把发布的版本装进隔离 home 冒烟
npm run release -- --bump patch --smoke   # 升版发布
```

**经 `npm run` 传参要放在 `--` 之后**，否则 npm 会把参数当成自己的配置项。

```sh
# 首次发布前的准备（脚本会直接给出确切命令）
node scripts/publish-npm.mjs --set-license "Verdana Mu" --create-repo-field
npm login --registry https://registry.npmjs.org/     # 必须显式带 --registry
node scripts/publish-npm.mjs --publish --smoke
```

六道闸门，任一不过就停：

| # | 闸门 | 不过时的含义 |
| --- | --- | --- |
| 1 | 工作树干净、在 main/master 上 | 发出去的东西对不上任何提交（`--allow-dirty` / `--allow-branch` 可放行，不推荐） |
| 2 | `name`/`version`/`license`/`files`/`dsh` 段齐全，LICENSE 版权人不是占位符，`repository` 在 | npm 包页取图失败、dsh 认不出这是插件包、版权人写着「contributors」 |
| 3 | `npm test` 通过 | 本包无构建步骤，测试就是唯一的自动校验 |
| 4 | tarball 恰好是那 6 个文件、且体量正常 | `files` 白名单写漏，或混进 `tools/`、`.github/`、`pnpm-lock.yaml` |
| 5 | registry 上没有这个版本、当前身份是维护者 | 同版本重发会被拒（`--bump patch` 解决）、发到别人的包上会 403 |
| 6 | `npm publish` | 默认跳过；只有 `--publish` 才走 |

几个设计点：

- **只有一道确认闸门：`--publish`。** 不带它一律只核查，并在结尾打印确切的发布命令。
- **`--bump` 只改 `package.json`**（`npm version --no-git-tag-version`），git commit
  与 `v<版本>` tag 放在**发布成功之后**打——发布失败不该在仓库里留悬空的版本提交。
- **凭据只在真要发布那一步碰**：`NPM_TOKEN` 会临时写成仓库级 `.npmrc`，结束立刻删；
  核查阶段永远不写。`~/.npmrc` 里的 proxy / `strict-ssl=false` 原样继承。
- **`--smoke` 调 `tools/smoke-install.mjs`**：把包（本地 tarball 或已发布的版本）
  装进临时 `DSH_HOME`，确认「能装 + 进 `dsh.profile.bundles` + Host 半边装载」
  （判据是 `/session-purge/state` 返回 200 且 `persistence=true`）。不碰你的 `~/.dsh`。
- 本机已知情况：`~/.npmrc` 里那个 `//registry.npmjs.org/:_authToken` 目前
  `npm whoami` 返回 401（token 可能已失效或被代理拦）。只核查模式会警告并继续，
  真发布前请先 `npm login --registry https://registry.npmjs.org/` 确认身份。

发布包只含 `lib/`、`client/`、`cordis.patch.yml`、`README.md`、`LICENSE`、
`package.json` 共 6 个文件（约 25 kB）；`tools/`、`scripts/`、`.github/` 都不进包，
第 4 道闸门会核对这份清单。

## 结构

- `lib/index.js` — Host 半：注册 `/session-purge/{state,delete,undo}` 路由，执行删除
- `client/client.js` — 浏览器半：会话行菜单注入 + 确认弹窗（React，无 JSX）
- `cordis.patch.yml` — bundle 补丁，把插件行插入 profile 合成树
- `scripts/publish-npm.mjs` — 发布流水线（六道闸门，默认只核查）
- `tools/helpers.test.mjs` — 回归测试（快照取值 / 目录推导 / POSIX+Win32 双风格）
- `tools/repro-delete.mjs` — 端到端验证脚本（真实后端 + 真实日志副本/自建夹具）
- `tools/smoke-install.mjs` — 隔离 home 里装包冒烟（发布闸门 7）
- `tools/probe-setup.ps1`、`tools/dialog-probe*.mjs` — 浏览器侧探针（Playwright）

MIT License.
