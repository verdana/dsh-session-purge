# dsh-session-purge × DSH 0.2.1-rc.2 兼容性清查

> **历史文档**：本报告记录 2026-10-18、插件 `0.5.0` 时期对 DSH 0.2.1-rc.2 的兼容性清查。
> 之后仓库已发布 `0.5.2`，并加入设置页图标/版本页脚/更新提示等改动；文中的测试数量、代码行号和
> “建议发布 0.5.1”等结论只反映当时状态。当前状态请看 [README.md](../README.md)、
> [DEVELOPING.md](../DEVELOPING.md) 与 [docs/recycle-bin/](./recycle-bin/)。

日期：2026-10-18
插件：`dsh-session-purge@0.5.0`（git `5318000`，工作区干净）
目标 DSH：`0.2.1-rc.2`（标签 `dsh-v0.2.1-rc.2`，HEAD `687f282e86`；npm 已发布同版本）
基线 DSH：`0.2.0-rc.2`（本机 pnpm 全局安装，插件上一版明确支持的版本）

## 结论

**插件可用，无 BREAKING。** 宿主半（`lib/index.js`）与浏览器半（`client/client.js`）依赖的上游契约在
0.2.1-rc.2 全部仍然存在；用 npm 安装的 0.2.1-rc.2 起隔离实例实测：插件正常装载、9 条 HTTP 路由全部可用、
回收站「移入 → 列表 → 复原（逐字节回原路径）→ 真实删除 → 清扫」全链路通过、浏览器侧菜单/侧栏/面板注入与
无刷新复原均通过，插件自带回归测试 105/105 通过。

清查出 **2 处 0.2.1 特定问题**（均不阻塞主流程）和 **1 组此前已存在、与 0.2.1 无关的问题**：

| # | 问题 | 类型 | 影响 | 严重度 |
|---|---|---|---|---|
| F1 | 回收站面板里的「设置」快捷入口失效，退回旧文案提示 | 0.2.1 特定（UI 导航改版） | 少一个快捷入口；设置页本身正常 | 低 |
| F2 | `tools/repro-trash.mjs`、`tools/repro-delete.mjs` 构造 JSONL 后端的方式过时 | 0.2.1 特定（后端改为插件式导出） | 仅开发脚本，插件运行不受影响 | 低（工具） |
| F3 | 归档行（`取消归档`）菜单检测不到，不注入「移入回收站」 | 既有（0.2.0 起相同） | 归档行无法从菜单移入回收站 | 中 |
| F4 | `dshHomePath` 探测类型写错（函数当字符串），家目录永远走回退 | 既有（0.2.0 起相同；0.2.1 反而缩小了风险窗口） | 非默认 home 时队列/回收站可能落错位置 | 中 |
| F5 | 永久删除后 `archiveSession` 必失败，`archived` 恒为 false | 既有（0.2.0 起相同） | 仅返回字段/工作区记账延迟清理 | 低 |
| F6 | 依赖 5 处 TS `private`/未公开内部面 | 既有设计取舍 | 上游重命名/压缩时会静默降级 | 中（结构性） |
| F7 | `tools/helpers.test.mjs` 菜单 fixture 未含 0.2.1 新增的第 5 项 | 维护项 | 上游再改菜单时可能假绿 | 低 |
| F8 | 两处 CSS 变量名不存在/拼错 | 既有 | 仅个别状态色回退，视觉无碍 | 极低 |

**建议：发布 0.5.1，包含 F1 + F2 的修复和 F7 的 fixture 更新；F3/F4/F5 可作为同批或后续修复。**

## 证据与复核方式

- 源码对照：`dsh-v0.2.0-rc.2..dsh-v0.2.1-rc.2` 全量 diff（1925 个提交），重点包逐个 hunk 复核。
- 真实后端探针：用 checkout 构建产物加载 `session-persistence-jsonl`，验证 `list()` 快照形状、
  `locate()` 可调用性、`sessionDirectoryFromLogPath()` 推导、移出/移回 `sessions/` 后列表 5→4→5。
- 隔离实例：`@deepseek-ai/dsh@0.2.1-rc.2` 从 npm 安装到 `.compat-run/dsh-0.2.1-rc.2`，
  `DSH_HOME=.compat-run/home`，web profile 链接本插件，端口 3181 起服务（未触碰 3080 与 `~/.dsh`）。
- 浏览器探针：Playwright + msedge，22 项通过 / 3 项失败后中止（失败项即 F1 及其后续导航假设）。
- 证据文件：`.compat-run/result-runtime-verify.json`、`.compat-run/logs/`（服务日志、`npm test` 105 通过日志、
  repro 失败日志、截图）、`.compat-run/http-evidence*.json`。`.compat-run/` 未提交、不影响 npm 包内容。

## F1（0.2.1 特定，已修）：回收站面板「设置」入口

**现象**：面板底部策略行（`client/client.js:1421` 的按钮）在 0.2.1 里点不开设置，降级为提示
「请从侧边栏「设置 → 回收站」打开设置」。设置页本身仍可从账号菜单进入，功能完好。

**根因**：DSH 0.2.1 的 web shell 用账号菜单占用了 `settings.launcher` 槽位：

- `packages/client/ui-settings-general/src/client/index.ts:202-216` 声明 `settings.launcher`（single/root）等槽位；
  `SettingsRoot.tsx:216-231` 只在槽位为空时渲染回退的「设置」按钮（`aria-label=设置`）并在点击时打开面板。
- `packages/client/ui-settings-account/src/client/index.ts:310-312` 把 `AccountMenu` 注册进 `settings.launcher`；
  `AccountMenu.tsx:64-87` 的触发按钮 `aria-label=账号菜单`（en `Account menu`），菜单项 `设置`/`Settings`
  （`ui-settings-account/src/client/locales.ts:17,53`）通过 `openSettings()` 打开设置。
- 因此 0.2.1 标准 web profile 里 **不存在可见的 `button[aria-label="设置"]`**；插件
  `client/client.js:719` 的 `SETTINGS_TRIGGER_LABELS = ["设置","Settings"]` 与
  `findSettingsTrigger()`（`:731-745`，且明确排除 `[role=menu]` 内元素）永远找不到目标。
- 插件侧调用点：`openSettingsFromBin()`（`:747-752`），提示文案在 `:76` / `:161`。

0.2.0 基线探测时该路径可用（0.2.0 shell 暴露 `aria-label=设置`），因此这是 0.2.1 引入的体验回归；
更稳妥的说法是：插件原先假设的「侧栏设置按钮」这一 DOM 锚点在 0.2.1 已被账号菜单取代。

**建议修复**（DOM 层，延续插件现有策略）：

1. 保留 `SETTINGS_TRIGGER_LABELS` 作为 ≤0.2.0 直连路径；
2. 新增账号菜单候选：可见、非菜单内、`aria-label` 属于 `["账号菜单","Account menu"]`；
3. 命中账号菜单时：点击触发按钮 → 下一个动画帧（`requestAnimationFrame` 或短 `setTimeout`）后，
   在 `div[role="menu"]` 内找 `button[role="menuitem"]`，其可读标签（去掉 `aria-hidden` 子树，复用面板里
   已有的 label 提取思路）属于 `["设置","Settings"]` 时点击；
4. 两条路径都失败才显示提示，并把 `bin.settingsHint` 文案改成
   「打开左下角账号菜单 → 设置 → 回收站」（en 同步）；
5. 在 `tools/client-bin.test.mjs` 增加账号菜单路径的 DOM fixture 用例。

参考已核对的上游锚点：账号菜单触发按钮带 `aria-haspopup="menu"`，菜单根为 `div[role=menu]`，
菜单项为 `button[role=menuitem]`（`ui-primitives/src/Menu.tsx:84-104,150-170`）。

## F2（0.2.1 特定，已修）：开发脚本的后端构造方式

`tools/repro-trash.mjs:232` 与 `tools/repro-delete.mjs:141`：

```js
const { default: Instance } = await import(`file://${candidate}/index.js`);
const instance = new Instance(fakeCtx, { root, compression: 'zstd' });
```

0.2.0 的 `session-persistence-jsonl` 有 `export default JsonlSessionPersistence`（类）；0.2.1 改为插件式导出：
`export const name`、`export const Config`、`export async function apply(ctx, config)`，**没有 default/类导出**
（见 `packages/session/session-persistence-jsonl/src/index.ts:1805-1822`，以及上游升级指南
`docs/upgrade-guide/v0.2.1-alpha.1/jsonl-persistence-plugin/guide.md`）。
实测 0.2.1 下两个脚本分别报 `Instance is not a constructor` / `JsonlSessionPersistence is not a constructor`
（`.compat-run/logs/repro-trash-021.log`、`repro-delete-021.log`）。

注意：插件运行时代码从 **不** import 该后端包（只用 `sessionPersistence` 服务与 `locate()` 钩子），
所以这是纯开发工具问题，不影响发布物；`npm test`（`node --test tools/*.test.mjs`）也不含这两个脚本。

**建议修复**（按上游指南迁移）：

- 0.2.0 分支保持现状；
- 0.2.1 分支用真实 Cordis `Context` 组合：
  `import * as Jsonl from '<install>/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js'`；
  `const ctx = new Context(); await ctx.plugin(Jsonl, { root, compression: 'zstd' });`
  `const persistence = ctx.get('sessionPersistence')`，其余断言改用服务接口。
- 简单判别：`const mod = await import(url)`；`if (mod.default !== undefined) { /* ≤0.2.0 旧路径 */ } else { /* 插件式 */ }`。

`tools/bin-live-probe.mjs` 在 0.2.1 下还需要额外适配（新装实例首屏有「开始使用」登录/API Key 模态，
需先按 Escape），且其设置导航步骤假设了旧入口；这属于探针本身，不是插件问题。

## F3（既有）：归档行菜单不注入

菜单识别只接受「重命名 → 分叉会话 → 归档会话」有序子序列（`client/client.js:878-885,923-933,946-947`）；
归档行渲染的是 `取消归档`/`Unarchive session`（`ui-workspace/src/client/session-actions/ArchiveSession.tsx:38-47`，
locale `locales.ts:63,189`），因此 `isSessionMenuDom()` 为 false，`injectMenuItem()` 不会执行。
`archiveIndex()` 虽然支持 unarchive（`:964-970`），但只有先行通过序列检测才会被调用；
`tools/helpers.test.mjs:691-694` 只测了 `archiveIndex`，没有测归档行菜单的整体识别——所以测试是绿的。
0.2.0 与 0.2.1 行为一致，非本次升级引入。

**建议**：把序列改为「重命名/分叉/（归档或取消归档）」三种变体，或在 `matchesSequence` 里对
unarchive 做等价替换；补一条整菜单 fixture 测试；同步修 README 里「归档行可移入回收站」的描述（若暂不修代码）。

**已修复**（本节保留为当时的复现记录）：`SESSION_MENU_SEQUENCES` 的第三槽改为
`["归档会话", "取消归档"]`（英文同理），`matchesSequence` 经 `labelIsAny()` 接受任一槽位词；
`tools/helpers.test.mjs` 补了整菜单 fixture 与序列断言。

## F4（既有，已修）：`dshHomePath` 探测类型写错

`lib/index.js:119-127` 期望 `ctx.get('dshHomePath')` 返回字符串，但上游提供的是**函数**
`dshHomePath(...segments)`（`packages/boot/app-boot/src/index.ts:1223`、
`packages/util/home-paths/src/index.ts:160-162`），所以插件永远回退到 `$DSH_HOME` → `~/.dsh`。
默认 CLI 启动下结果正确；只有「home 被显式配置为非环境变量路径」或 `DSH_HOME` 含 `~`/相对片段时，
回收站与「重启后移入」队列会写到运行实例不扫描的 home。

0.2.1 的 `instruction-home-override` 升级指南反而让这个风险窗口变小：指令加载等消费方统一改为
`$DSH_HOME` → `~/.dsh`，插件回退与上游默认完全一致；但正确的修法仍是一行：

```js
const probe = typeof ctx?.get === 'function' ? ctx.get('dshHomePath') : undefined;
const provided = typeof probe === 'function' ? probe() : probe;   // 先当函数调用
if (typeof provided === 'string' && provided.trim() !== '') return provided;
// 不要再用 ctx.dshHomePath 属性读取：未 inject 时 Cordis 会直接抛
```

附带：`dsh web --help` 这类早启动路径会在 boot maintenance 里打出
`cannot get property "dshHomePath" without inject`（0.2.0 与 0.2.1 相同，正常服务启动时不出现）。

## F5（既有）：永久删除后的归档标记

`lib/index.js:531-540` 在删除日志目录之后才调用 `workspaceRegistry.archiveSession()`；而该 API 要求会话
「仍存活或仍在持久层」（`packages/workspace/workspace/src/index.ts:365-372`，0.2.0 同样如此），
所以永久删除路径里这次调用必失败（被 catch，仅 `archived:false`），工作区候选会在下一次写入时才被清理。
默认的回收站路径不受影响（`unarchiveSession` 不做存在性校验，`:399-410`）。
若要 `archived` 有意义，需在删除前归档（或接受现状）。

## F6（既有）：依赖的未公开内部面

本次逐项复核，0.2.1-rc.2 均仍存在且形状未变（无 minify，TS `private` 在运行时可达）：

| 依赖 | 0.2.1-rc.2 证据 | 状态 |
|---|---|---|
| `sessionPersistence.locate(header)` → `{kind:'jsonl',path}` | `session-persistence-jsonl/src/index.ts:345-347`（真实构建产物上实测可调用） | 在 |
| `agents.store` / `agents.detachEntered` / `agents.enter` | `core/agent/src/index.ts:246,499,461` | 在 |
| `sessions.store` / `sessions.detachEntered` / `sessions.flush` | `core/session/src/index.ts:1050,1247,1319` | 在 |
| `agent.phase.kind`（严格 idle 闸门） | `core/agent-loop/src/agent.ts:42-56,100,135` | 在 |
| `agent.scope.dispose()` | `core/scope/src/index.ts:105-111` | 在 |

风险不变：上游一旦改名或开始压缩构建，删除/移入会静默降级为「重启后移入」队列（`held`）。
`tools/helpers.test.mjs` 已钉住调用形状，是最先该失败的地方。

## F7（维护，已更新）：菜单 fixture 缺 0.2.1 新行

0.2.1 的会话行菜单内置项为 置顶(100) / 重命名(200) / 分叉(300) / 归档(400) / **复制 Session ID(450)**
（`ui-workspace/src/client/index.ts:316-321`），中英文标签与 0.2.0 相同；第 5 行在归档之后，不影响
有序子序列识别与「插在归档后」的落点。建议把 `helpers.test.mjs` 的 fixture 补成 0.2.1 实际抓取集合
（含 `复制 Session ID`），守住 DEVELOPING.md 的「fixture 必须跟随真实渲染」规则。

## F8（既有，视觉）：CSS 变量

`client/client.js:225` 用了不存在的 `--dsw-alias-bg-overlay-2`，并把 `--dsh-alias-label-secondary` 拼错
（应为 `--dsw-...`）；都有回退色，表现为个别状态色不跟主题，功能无影响。

## 宿主契约核对表（0.2.1-rc.2）

| 契约 | 插件位置 | 0.2.1 状态 |
|---|---|---|
| `sessionPersistence` 服务 `list()` 快照 `{header,formatStatus?,revision,sizeBytes?}` | `lib/index.js:206-221,461-475` | 兼容；新增 `formatStatus` 不影响 |
| JSONL 目录布局 `sessions/<projectKey>/session-<id>/session.vN.jsonl[.zstd]` | `lib/index.js:99,283-298` | 兼容；v4/v3、zstd/plain 均匹配 `LOG_FILENAME_RE` |
| 复原必须回原路径（后端 header+path 身份校验） | `lib/index.js:1409,1528-1541` | 兼容，插件记录的 `originalDir` 正是该路径 |
| 写锁 `session.lock` 跟着会话目录 | `lib/index.js:46-56`；上游 `lease.ts:39-40` | 兼容；插件先过驻留闸门 |
| 回收站前提：会话目录移出 `sessions/` 即从 `list()` 消失 | `lib/index.js:1366-1447` | 实测 5→4→5，成立 |
| `agents`/`sessions`/`jobs`/`workspaceRegistry`/`webServer` 服务名 | `lib/index.js:342-355` | 全部仍以这些名字提供 |
| `jobs.list(caller): JobView[]`、`owner`、`status` | `lib/index.js:108,244-254` | 兼容；JobId 改为 `<kind>-<uuid>` 与插件无关 |
| `webServer.register({kind:'exact',path,handler})` + exact→prefix→fallback 派发 | `lib/index.js:1731-1956` | 兼容；无全局鉴权/同源策略新增，插件自管 Origin==Host |
| `apply(ctx,config)` + `ctx.inject`/`ctx.effect` 生命周期 | `lib/index.js:1709-1956` | 兼容；vendor cordis 两个标签间仅版本号差异 |
| `dsh.bundle.patch` + `cordis.patch.yml` `- insert:` 格式 | `package.json:13-16`、`cordis.patch.yml` | 兼容；`--dump-config` 在两版都出现 `dsh-session-purge` 行 |
| 兼容性闸门（无 `engines.dsh`、无 dsh peers） | `package.json` | 接受（无声明即无约束）；若将来加 `engines.dsh`，该范围将单独决定结果 |
| `dshHomePath`（函数 vs 字符串） | `lib/index.js:119-127` | 既有缺陷，见 F4 |

## 浏览器契约核对表（0.2.1-rc.2）

| 契约 | 插件位置 | 0.2.1 状态 |
|---|---|---|
| `dsh.client.platform:"web"` + `exports["./client"]` | `package.json:13-23` | 兼容 |
| `dsh.client.inject:["@deepseek-ai/dsh-client-locale"]` | 同上 | 包仍在、仍是 web graph 行；缺失注入会被静默跳过 |
| `window.__ModuleLoader__.load({id,factory})` | `client/client.js:1` | 兼容 |
| `require("react")` / `require("react-dom/client")` / `ui-primitives` | `:6-7,16` | 三个平台 seed 仍在（`client/web/src/seed.ts:30-42`）；primitive 访问全部有 try/catch 回退 |
| 用到的 primitive：Tooltip/Switch/SegmentedControl/Input/Modal/IconTrashOutlineRegular | `:1190,1490,1557,1581,1610` | 导出与 props 均未变（Modal 零 diff） |
| `ctx.sessions`、`list.getSnapshot()`（`{ids,byId}`）、`refresh()` | `:452-453,828-846,1986` | 兼容；`SessionSummary.displayTitle/cwd/running` 仍在 |
| `ctx.get("locale").getLocale().active` | `:1964-1966` | 兼容（`{active,locales,revision}`）；非 zh/en 仍回退中文（既有） |
| `ctx.inject(['slots'])` + `settings.section` 注册 `{id,order,label}` | `:1760-1781` | 兼容；槽位仍由 ui-settings-general 声明/渲染 |
| 会话行 `⋯` 的 `aria-label` 正则 `会话“…”的操作` / `Session actions for …` | `:853-857` | 兼容（`Rows.tsx:675`，locale `locales.ts:100/226`） |
| 菜单内置项顺序/中英文标签、`div.itemWrap > button[role=menuitem]`、`aria-hidden` 键帽 | `:878-885,898-914,1001-1018` | 兼容；新增第 5 行「复制 Session ID」被有序子序列容忍 |
| 侧栏锚点 `添加工作区`/`视图选项`、`.headerActions{max-width:60px}` | `:341-344,1238-1273` | 兼容；Tooltip 无包装层，`anchor.parentElement` 仍是 `.headerActions` |
| 面板/弹窗挂载、Escape 关闭、`data-plugin-css` 样式归属 | `:1051-1103,1114-1141,1280-1298` | 兼容；Menu 仍在 document 上监听 Escape |
| 主题变量/类 | `:215-315` | 基本兼容；见 F8 |

## 0.2.1 升级指南对本插件的映射

| 指南 | 对本插件的影响 |
|---|---|
| `jsonl-persistence-plugin` | 仅 F2（开发脚本）；运行时用服务，不受影响 |
| `plugin-engines-dsh` | 插件无 `engines.dsh`/dsh peers，判为无约束、可装载；若将来加 `engines.dsh` 要覆盖支持范围 |
| `plugin-option-placement` | README 的 `dsh plugin --profile web add ...` 已是新写法 |
| `web-listener-trust-config` | 插件用 `webServer` 服务，不碰 `webRuntime`/`webStartup`，无影响 |
| `instruction-home-override` | 默认 home 解析与插件回退一致；显式配置 home 这一旧风险窗口消失，但 F4 仍建议修 |
| `new-session-generations` / `working-directory` / `subagent-activations` / `job-id-identity` | 插件只用持久层 `locate()` 与注册表/任务快照，行为未受影响 |
| 其他 0.2.1 指南（账号、模型、桌面、Python/PTC 等） | 与本插件无关 |

## 已实施的修复（工作区；未改 package.json 版本号）

版本号仍由发布脚本管理，工作区只改代码、测试与文档。

| # | 状态 | 改动位置 | 验证 |
|---|---|---|---|
| F1 | 已修 | `client/client.js`：`openSettingsFromBin()` 先试 ≤0.2.0 的「设置」按钮，失败再走账号菜单两步路径（`findAccountMenuTrigger` → 打开菜单 → `pickSettingsMenuItem` 精确匹配「设置」行并点击，重试窗口 500 ms）；`bin.settingsHint` 中英文改为账号菜单路径；`tools/client-bin.test.mjs` 新增 2 个用例 | 0.2.1-rc.2 隔离实例 + Playwright/msedge 实测：无独立「设置」按钮、账号菜单存在、面板策略行点击后设置面板打开、导航到「回收站」后节页面与自动清理开关均渲染（截图 `.compat-run/logs/f1-settings-opened-021.png`） |
| F2 | 已修 | 新增 `tools/lib/backend.mjs`：`openSessionPersistence()` 按导出形状选择「0.2.0 默认类直接构造」或「0.2.1+ 插件式挂在真实 Cordis `Context` 上、经 `ctx.get('sessionPersistence')` 取服务」，用 `ctx.fiber.dispose()` 收尾；`tools/repro-trash.mjs`、`tools/repro-delete.mjs` 改用它，并保留探测循环的选代逻辑 | 两代后端均跑通：0.2.1 插件式（checkout 构建产物）与 0.2.0 默认类（全局安装）下，`repro-delete` 与 `repro-trash` 全部 PASS（trash → 逐字节复原 → purge → sweep） |
| F4 | 已修 | `lib/index.js`：`resolveHome()` 经 `ctx.get('dshHomePath')` 取值；是函数就调用；字符串属性读取只作旧上下文兜底并包在 try/catch（真实 Cordis 未 inject 时会抛）。同步更新 `DEVELOPING.md`；`resolveHome` 标记 `@internal` 导出，`tools/helpers.test.mjs` 新增函数/字符串/抛错属性/空值用例 | `npm test` 通过；修复过程中发现测试桩以字符串属性暴露 home，兜底读取保证旧桩继续工作（并据此回滚了首版误改） |
| F7 | 已更新 | `tools/helpers.test.mjs` 新增 0.2.1 中英文菜单 fixture（含末尾「复制 Session ID」行）并更新跨代注释；`client/client.js` 的菜单识别注释补 0.2.1 行为 | `npm test` 通过（110/110） |
| 文档 | 已更新 | `DEVELOPING.md`（跨版本表加 0.2.1 列与设置入口行、`dshHomePath` 取舍改写）；`README.md`/`README.en.md`（设置入口改为账号菜单 → 设置）；`docs/recycle-bin/spec.md`（`bin.settingsHint` 文案） | — |

回归结果：`npm test` **110/110 通过**（原 105 + 新增 5），`node --check` 全部改动文件通过；两代后端的 repro 脚本均 PASS；0.2.1 隔离实例 F1 浏览器探针 11/11 PASS。

仍未处理（见对应章节）：F3（归档行菜单识别，既有）、F5（永久删除后的归档标记，既有）、F6（私有内部面，结构性风险）、F8（两个 CSS 变量名，视觉回退）。F3/F5 属产品行为取舍，未纳入本次兼容修复。

## 残余未知

- 未复核 DSH 0.2.1 发布物中每个前端包是否与源码树完全一致（假定 npm 包 = 标签源码构建，未 minify）。
- 0.2.1 浏览器探针已覆盖 F1 修复路径（账号菜单 → 设置 → 回收站）与截图；未重跑完整的
  22 项 bin-live 序列（安装树在验证后删除，重跑需按「复现命令」重装）。
- 桌面端（Electron）窗口、右侧栏与移动端布局不在本次范围。
- 早期探针有一次 `dsh web --help` 在设置 `DSH_HOME` 之前启动，boot maintenance 因 F4 直接失败、
  未调用路由也未删除会话；`~/.dsh/session-purge` 的 mtime 早于本次会话（09:53），未发现本次运行
  造成的写入。修复 F4 的首版曾让测试套件通过 `ctx.dshHomePath` 字符串属性读到错误 home，已回滚为
  「函数优先、字符串属性兜底」，并清理/还原了 `~/.dsh/session-purge` 中被该次测试写入的条目与设置
  （恢复为默认 112 字节 settings.json，回收站清空）。
- 若用户 profile 里存在其它插件注册了同名 `/session-purge*` exact 路由，`webServer.register` 会因重复路径抛错
  并让插件 fiber 失败；本仓库与隔离实例中不存在。

## 复现命令

```powershell
# 回归测试（与 DSH 版本无关，fixture 固定）
npm test

# 隔离实例：先重装 0.2.1-rc.2（本次清查后已删除 694 MB 安装树，只保留日志与证据）
npm install --prefix .compat-run\dsh-0.2.1-rc.2 @deepseek-ai/dsh@0.2.1-rc.2 --no-audit --no-fund
$env:DSH_HOME = 'D:\deepseek-harness\dsh-session-purge\.compat-run\home'
node .compat-run\dsh-0.2.1-rc.2\node_modules\@deepseek-ai\dsh\lib\bin.js web --no-open --port 3181 --host 127.0.0.1

# 路由冒烟（token 从启动行取，或同源页面内执行）
curl http://127.0.0.1:3181/session-purge/state
curl http://127.0.0.1:3181/session-purge/trash
curl http://127.0.0.1:3181/session-purge/settings

# F1 修复的浏览器验证（启动行里的 token URL）
node .compat-run\f1-settings-probe.mjs "http://127.0.0.1:3181/?token=<启动行 token>"

# 开发脚本复现/验证 F2（两代后端均可）：
#   0.2.1 插件式：指向一个包含 node_modules/@deepseek-ai/dsh-session-persistence-jsonl 的目录
$env:DSH_WEB_APP_DIR = 'D:\deepseek-harness\dsh-session-purge\.compat-run\backend-021'
#   ≤0.2.0 默认类：指向 dsh 安装目录（含 node_modules/@deepseek-ai/...）
# $env:DSH_WEB_APP_DIR = '<pnpm-global>/.../node_modules/@deepseek-ai/dsh'
$env:DSH_HOME = 'D:\deepseek-harness\dsh-session-purge\.compat-run\home'   # 只读复制会话，不动真实 home
node tools/repro-trash.mjs
node tools/repro-delete.mjs
```

> `.compat-run/` 为本次清查的临时证据目录（未提交）。其中 694 MB 的 npm 安装树已删除；
> `.compat-run/logs/`（含 F1 修复前后截图）、`result-runtime-verify.json`、`http-evidence*.json`、
> `backend-021/` 的 junction 是小体积证据，可随仓库清理一并删除。
