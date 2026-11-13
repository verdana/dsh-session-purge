# dsh-session-purge × DSH 0.2.2-rc.3 兼容性核查

日期：2026-11-13
插件：`dsh-session-purge@0.5.9`（本轮无代码改动，见 CHANGELOG「未发布」）
目标 DSH：`0.2.2-rc.3`（标签 `dsh-v0.2.2-rc.3`，`38a6a5c965`，2026-11-13）
基线：`0.2.2-rc.2`（标签 `dsh-v0.2.2-rc.2`，`ddac96760b`，2026-11-11）
取证方式：**源码级 + 隔离实例实机**。2026-11-13 本机 CLI 已升级到 `0.2.2-rc.3`，在隔离
`DSH_HOME` 里以 `link:` 装入本仓库起 `dsh --profile web`，Host 半的 8 条路由与回收站闭环
（trash → restore → state）全部实跑（见「rc.3 实机证据」）；浏览器半只做源码级取证与单测，
DOM 交互未在浏览器里执行（见「取证局限」）。

## 结论

**无兼容性阻断项，且本轮比上一轮更干净：Host 半是「零源码变化」级别的成立。**

`rc.2 → rc.3` 是 515 个文件、`+10988 / −669` 的常规迭代，但改动集中在 `packages/host` 之外。
插件依赖的 16 项 Host 契约全部可用，因为承载它们的包在整个 rc.3 里**只改了 package.json 的
版本号**：`packages/host`、`packages/session`、`packages/core`、`packages/workspace`、
`packages/boot`、`packages/api`、`packages/client/ui-slots`、`packages/client/modules`
逐包 `git diff --name-only` 过滤掉 `package.json` 后**为空**。18 项浏览器契约里，插件实际
依赖的 DOM（会话行 ⋯ 触发器、`div[role=menu]`、`button[role=menuitem]`、归档项位置、设置页
导航、侧栏 header 的 `.headerActions`、`settings.section` / `sidebar.panellist` / `main`
槽位）**一个文件都没动**；只有 `ui-sidebar` 与 `ui-workspace` 各加了一个新槽位（见下）。

三处剩余事项全部继承自 rc.2 或更早，rc.3 没有加重任何一处：

1. **新增槽位（信息项）**：rc.3 在侧栏「新建会话」行外面包了一层 `div.newSessionRow`，并新增
   `sidebar.session.action` HOC 槽。插件不占用这个槽（它是 HOC，作用域就是这个按钮行），
   侧栏入口是 DOM 注入，锚点仍是 `.headerActions` 里的「添加工作区 / 视图选项」，候选集与
   判定逻辑不变。
2. **语义退化（低，rc.2 起）**：`agents.enter()` 只收一个参数，回滚分支多传的 `owner` 被忽略、
   读到的 `AgentEntry.owner` 是 `undefined`——不抛错，但「以 owner 身份重新登记」不再存在。
3. **新条件风险（中·条件性，rc.2 起）**：rc.2 在 `unarchiveSession` 里新增
   `workspace/session-unarchiving` 钩子且**不包 try/catch**；监听器抛错会让「复原」在会话已搬回
   `sessions/` 之后仍留在归档集合。rc.3 未改该函数。当前只有实验性 worktree 插件监听它。

## 核查方法

沿用 rc.2 文档「按插件实际调用面取证」，但 rc.3 的差异规模小得多（515 文件 vs rc.1→rc.2 的
4645 文件），因此新增一步**反向证明**：先证明承载 Host 契约的包没有源码改动，再证明浏览器半
被依赖的 DOM 文件没有改动，最后只逐条读真正变了的两个客户端包。

- 插件调用面：Host 半 `lib/index.js`（2248 行）`ctx.inject(['sessionPersistence']) `、
  `ctx.inject(['webServer'])`、8 条 `webServer.register`、`sessions` / `agents` /
  `workspaceRegistry` / `sessionPersistence.locate()` / `ctx.get('dshHomePath')`；浏览器半
  `client/client.js`（3419 行）的 DOM 嗅探与槽位注册。
- 差异规模：`git diff --shortstat dsh-v0.2.2-rc.2..dsh-v0.2.2-rc.3` → 515 files，
  `10988 insertions(+)`，`669 deletions(-)`。
- 客户端包改动清单（过滤 `package.json`）：`ui-sidebar`（`SidebarRoot.tsx`、
  `SidebarRoot.module.css`、`contract/slots.ts`、`index.ts`）、`ui-workspace`
  （`WorkspacePicker.tsx`、`contract/slots.ts`、`index.ts`）、`ui-primitives`
  （`icons/artwork.ts`、`icons/index.tsx`）、`ui-directory-picker-browse` /
  `ui-directory-picker-native`（`src/client/index.ts`）、`session-log-export`（`archive.ts`）、
  `tool-cordis`（`api-catalog.ts`）、`util/official-bundles`、
  `cordis-client-runner/src/client/slot-catalog.ts`。
- 明确**未改**因而行号沿用的文件：`ui-primitives/src/MenuSurface.tsx`、`MenuRow.tsx`、
  `ui-workspace/src/client/rows/Rows.tsx`、`WorkspaceBrowser.tsx`、
  `session-actions/context-menus.tsx`、`WorkspaceBrowser.module.css`、`ui-settings-general`
  全包、`ui-layout` 全包、`api/session-controller`、`client/locale`、`ui-context-menu`。
- 仓库根**没有** CHANGELOG.md，上游没有 breaking 清单可抄——只能按契约面读。

## 契约核对：Host 半

承载这些契约的包在 rc.2→rc.3 中只有 `package.json` 的版本号变化，因此 **file:line 与 rc.2
文档一致**，本表只复核「包是否被动过」与「实机是否仍可用」。

| # | 契约 | rc.3 复核 | 判定 |
|---|---|---|---|
| 1 | `webServer.register(route)` 形状 | `packages/host` 全树无源码改动（`webserver/src/index.ts:445`、`WebRoute` :52-58 保持） | 不变 |
| 2 | `sessionPersistence` 注入名 + `locate()` | `packages/session` 无源码改动（`session-persistence/src/index.ts:144,149,210`、`session-persistence-jsonl/src/index.ts:345`） | 不变；实机 `settings` 返回 `persistence` 字段正常 |
| 3 | 会话格式版本 | `core/session/src/types.ts:90` `SESSION_FORMAT_VERSION = 4`，无 v5 | 不变 |
| 4 | `.jsonl` / `.jsonl.zstd` 文件名 | `session-persistence-jsonl/src/format.ts:254,267,298`、`index.ts:1690` | 不变；实机 restore 落回 `sessions/--…--/` |
| 5 | `sessions.list/get/flush`、`store` / `detachEntered` | `core/session/src/index.ts:1463/1455/1422/1145/1347` | 不变；实机 state 列出 10+ 会话 |
| 6 | `agents.list/get/enter/store/detachEntered` | `core/agent/src/index.ts:588/580/474/250/511` | 不变（语义变化见问题 2） |
| 7 | `agent.phase.kind`、`agent.scope.dispose()` | `core/agent/src/runtime-types.ts`、`agent-loop/src/agent.ts:112-157`、`core/scope/src/index.ts:111` | 不变 |
| 8 | `workspaceRegistry.list()` / `archivedSessionIds` | `workspace/workspace/src/index.ts:308,360`；`workspace/types.ts:120` | 不变 |
| 9 | `archiveSession` / `unarchiveSession` | `workspace/workspace/src/index.ts:381` / `:420`（钩子仍在 :426，未加 try/catch） | 签名不变；见问题 3 |
| 10 | `attachSession` / 工作区条目 | `workspace/workspace/src/entity.ts:110`；`workspace/index.ts:524,496,883` | 不变 |
| 11 | `ctx.get('dshHomePath')` 是**函数** | `boot/app-boot/src/index.ts:1243`；`util/home-paths/src/index.ts:160` | 不变；实机 `trash` / `restore` 都用到了它 |
| 12 | profile / patch 合成（`- insert:`） | `boot/app-boot/src/profile-plugins.ts:73`、`profile.ts:699-700`、`compatibility-preflight.ts:63-77,172-186` | 不变；实机 profile web 起得来，插件路由全在 |
| 13 | 插件注册形状 / 版本预检 | `vendor/cordis/src/registry.ts:9,319` | 不变；插件两者皆无 → 走无约束分支 |
| 14 | 客户端插件加载 | `client/web/src/platform.ts:8-19`；`packages/client/modules` **零 diff** | 不变（rc.2 已有的 entry 级容错仍在） |
| 15 | `link:` 安装 | `plugin-manager` 无源码改动 | 不变；实机就是 `link:` 装法 |
| 16 | `jobs.list(caller?)` | `jobs/jobs/src/index.ts:121`；`jobs-local/src/index.ts:321` | 不变（对照项） |

路由实测：`GET /session-purge/state|settings|trash`、`POST /session-purge/trash|restore` 全部
200，`trash → restore` 闭环成功（见「rc.3 实机证据」）。

## 契约核对：浏览器半

| # | 契约 | rc.3 证据 | 判定 |
|---|---|---|---|
| 1 | 会话行 ⋯ 触发器：`span.rowActions` 内 `button[aria-label]` + `data-context-menu-trigger` | `ui-workspace/.../rows/Rows.tsx:748-756`、`ui-context-menu/.../Button.tsx:32-62`（两文件 rc.3 无 hunk） | 不变 |
| 2 | 从 `aria-label` 解析会话标题 | `ui-workspace/src/client/locales.ts:100,226` | 不变 |
| 3 | 菜单容器 `div[role="menu"]` | `ui-primitives/src/MenuSurface.tsx:11,25,41-46` | 不变（无 hunk） |
| 4 | 菜单行 `button[role=menuitem]` 克隆目标 `div.itemWrap > button` | `ui-primitives/src/MenuRow.tsx:40-50` | 不变（无 hunk） |
| 5 | 图标容器 `span.itemIcon`（0.5.8 修复点） | `MenuRow.tsx:48` | 不变；rc.3 只给 icons 加了两个新图标 |
| 6 | 键帽 `span[aria-hidden="true"]`（0.5.8 修复点） | `MenuRow.tsx:50`（`span.shortcut`） | 不变 |
| 7 | 菜单项顺序：重命名 → 分叉 → 复制 Session ID → 归档 | `session-actions/context-menus.tsx:35-68`（pin 100 / rename 200 / fork 300 / id 450 / archive 600） | 不变；该目录 rc.3 零 diff |
| 8 | 归档 / 取消归档文案 | `locales.ts:61-66,187-192` | 不变 |
| 9 | 归档项 `separatorBefore: true` + `afterContent: true` | `context-menus.tsx:59-67` | 不变；克隆后的清理规则继续有效 |
| 10 | 设置页 `[role=dialog] nav button` + `span.navIcon` | `ui-settings-general/.../SettingsRoot.tsx:73,79,91` | 不变（该包零 diff） |
| 11 | 设置导航图标隐藏（0.5.8 修复点） | `SettingsRoot.tsx:92` | 不变 |
| 12 | `settings.section` 注册与 label thunk | `ui-settings/src/client/contract/slots.ts:57` | 不变 |
| 13 | `sidebar.panellist` 侧栏回收站入口 | `ui-sidebar/src/client/contract/slots.ts:47`（**行号未变**）；`index.ts:58,70,91` | 不变；rc.3 新增的是 `:86` 的 `session.action` HOC 槽 |
| 14 | `main` keyed 槽 + `layout.selectPanel` | `ui-layout/src/client/index.ts:75,197`、`service.ts:74` | 不变（零 diff） |
| 15 | 侧栏 header 锚点（添加工作区 / 视图选项） | `WorkspaceBrowser.tsx:1290,1299-1305,191-195`；`.headerActions` CSS `WorkspaceBrowser.module.css:140`（`max-width:60px`） | **不变**：两文件 rc.3 无 hunk；插件给它置 `max-width:none` 的兜底照样成立 |
| 16 | `ctx.sessions` 快照 `{ids, byId, displayTitle, cwd, running}` | `api/session-controller/.../service.ts:26-68,259,298` | 不变（零 diff） |
| 17 | locale 服务 `getLocale().active` | `client/locale/src/client/index.ts:75-82,205` | 不变 |
| 18 | 主题变量 `--dsw-alias-*` | `ui-theme` 未改 | 不变（插件全部带 fallback） |

## rc.3 唯一的结构性变化：侧栏「新建会话」行与 `sidebar.session.action` 槽

`SidebarRoot.tsx` 把原来裸着的「新建会话」`<button>`（`aria-label={t('session.new.label')}`）
包进 `<div className={css.newSessionRow}>`，并在其中 `renderSlot('sidebar.session.action', { wide },
{ children: <原来的 Tooltip+button> })`。槽本身在 `contract/slots.ts:86` 声明为
`{ kind: 'hoc'; scope: 'root'; owner: SidebarSessionActionOwnerProps }`，即「包一层」而不是「追加
一项」；模板配套改了 CSS：`.newSession` 变 `flex:1 1 auto; min-width:0`，新增
`.newSessionRow`（`margin:0 calc(var(--dsh-sidebar-paint-inset)+1px)`），折叠态
`.collapsed .newSessionRow` 改纵排，入场动画改成
`.railIn .newSessionRow > :global([data-slot='sidebar.session.action']) > *`。

对插件的影响：**零**。

- 插件不注册 `sidebar.session.action`（也没法用它放垃圾桶图标——它只包裹新建会话这个按钮）。
- 按钮的 `aria-label`、可见性、父容器层级都没变，仍在 `canStartSession` 分支里；插件
  `collectTrashAnchorCandidates()` 只认 `TRASH_ANCHOR_LABELS`（`client/client.js:613-616`：
  「添加工作区 / Add workspace」「视图选项 / View options」），新建会话按钮从来不是候选。
- 锚点所在的 `.headerActions` 属于 `WorkspaceBrowser`，与该行不在同一子树。

顺带记录同批的两处客户端新增，均与插件无关：

- `ui-workspace` 新增 `workspace.picker` 组件工厂槽（`contract/slots.ts:235-240`，children 为
  `workspace.picker.directoryFlow`），`WorkspacePicker.tsx` 导出 `WorkspacePickerFactory`，
  `index.ts` 注册；用于让别的插件复用会话首页的目录选择器。
- `cordis-client-runner/src/client/slot-catalog.ts` 只加了 `sidebar.session.action` 目录条目并把
  `ui-sidebar/.../SidebarRoot.tsx` 的 source 行号从 137 修到 141——是给 agent 看的索引，不是
  运行时契约。

## 问题清单

| 严重度 | 问题 | 状态 |
|---|---|---|
| 低（rc.2 起） | `agents.enter()` 单参，`AgentEntry.owner` 为 `undefined`：回滚分支 `lib/index.js:743` 的 `agentEntry.owner` 恒空，「以 owner 身份重新登记」退化为「只登记、不持有 teardown」 | 不抛错；代码不按版本分支，判定交上游 |
| 中·条件（rc.2 起） | `unarchiveSession` 在移除归档标记前 `await ctx.parallel('workspace/session-unarchiving', …)` 且无 try/catch，监听器抛错 → 「恢复成功但仍归档」 | rc.3 未改；插件侧已包 try/catch，要根治需在 catch 里复核 `archivedSessionIds` 并重试 |
| 信息（rc.3） | 侧栏新增 `sidebar.session.action` HOC 槽与 `div.newSessionRow` 包裹层 | 不影响插件；若上游日后改「新建会话」的 aria-label 或把 header 按钮挪进该行，锚点会退化为「视图选项」单一候选（已有 fallback，不产生死点击） |
| 既有 | 非中英界面功能失效；`engines.node` 文档口径；`contextMenus.register` / `settings.section.icon` 迁移 | 与 rc.3 无关，维持原判定 |

## 本轮落码修复

**无。** 插件代码一行未改；rc.2 的落码修复（克隆行清 `separatorBefore` 分隔线、清
`aria-disabled` / `aria-describedby` 等）在 rc.3 的菜单基元上仍然正确，因为菜单基元本身没动。

## 本轮验证

- 单测（沙箱禁止 node 起子进程，`npm test` 会 `spawn EPERM`，改为逐文件直跑）：
  `node tools/trash.test.mjs` 34 项全过、`tools/helpers.test.mjs` 55 项全过、
  `tools/client-bin.test.mjs` 46 项全过、`tools/pack-report.test.mjs` 6 项全过。
  `trash.test.mjs` 收尾报 `ENOTEMPTY`（Windows 临时目录清理竞态，非断言失败）。
- 隔离实例：`pwsh tools/probe-setup.ps1` 成功（probe home = 仓库下 `.probe-home`，profile web
  的 bundles 为 dsh-base / dsh-web-app / dsh-session-purge，`patchReload: live`；
  dsh-nord 第三方主题 fixture 缺失被跳过，无影响），再以
  `DSH_HOME=<repo>/.probe-home dsh --profile web --no-open --port 3082 --host 127.0.0.1` 起实例。
- 实机 HTTP：`/session-purge/state`、`/settings`、`/trash` 全部 200；回收站闭环
  `POST trash` → `GET trash`（count 1）→ `POST restore`（`restoredTo` 为对应
  `sessions/--…--/session-0c3de1d1…`）→ `GET state` 会话回归、bin 清空。
- 浏览器半：只有源码级取证 + `client-bin.test.mjs` 的纯函数用例，未做 DOM 实跑（见下）。

## rc.3 实机证据

- `DSH_HOME=D:\dsh-session-purge\.probe-home`，`dsh --profile web --no-open --port 3082`，
  打印 `dsh web: http://127.0.0.1:3082/?token=…`。
- `GET /session-purge/settings` → `{"version":"0.5.9","settings":{"schema":1,"autoClean":true,
  "retentionDays":30,"sweepOnBoot":true,"sweepIntervalHours":6,"entryPlacement":"icon"},…}`。
- `GET /session-purge/state` → `"persistence":true`，`sessions` 列出 probe home 里的 10+ 会话
  （id / title / cwd / sizeBytes）。
- `POST /session-purge/trash {"sessionId":"session-0c3de1d1-5e92-4a75-afca-534cee0b0af7","title":…}`
  → `{"ok":true,"mode":"trashed","trashId":"t-20261113T090040-3d015f"}`；
  `POST /session-purge/restore` → `{"ok":true,"restoredTo":"…\sessions\--D-deepseek-harness-.playwright-mcp-ws--\session-0c3de1d1-…"}`。
- 2026-11-13 的 token 是一次性的：`GET /?token=…` 第二次即 401，属正常（Host 路由不校验）。
- `/plugins` 返回 404——该路径本就不存在，不是契约。

## 取证局限

- **浏览器半未实跑**：本会话沙箱禁止 node 创建子进程，`tools/entry-placement-probe.mjs` 与
  Playwright 均报 `browserType.launch: spawn EPERM`；提升 `danger-full-access` 未获批（无审批
  应答方）。因此菜单注入、设置导航图标、回收站面板的 DOM 行为只有源码级证据与纯函数单测，
  没有截图/快照级证据。要在本地补，需在允许子进程的终端里跑
  `node tools/entry-placement-probe.mjs` 与 `tools/trash-panel-probe.mjs`。
- 实机只覆盖 Host 面的 8 条路由；浏览器面「打包下发」这一层（`client/client.js` 是否被
  profile 正确 load）由单测 `client-bin.test.mjs` 与 rc.2 的实机记录覆盖，本轮未重新验证。

## 复现命令

```sh
# 差异规模与契约面取证（必须读标签，不要读工作树）
cd <deepseek-harness>
git tag -l 'dsh-v0.2.2-rc.*'
git diff --shortstat dsh-v0.2.2-rc.2..dsh-v0.2.2-rc.3
git diff --name-only dsh-v0.2.2-rc.2..dsh-v0.2.2-rc.3 \
  -- packages/host packages/session packages/core packages/workspace \
     packages/boot packages/api packages/client/ui-slots packages/client/modules \
  | grep -v 'package.json$'   # 期望为空

# 插件回归（沙箱里 spawn 受限，逐文件直跑）
cd <本仓库>
node tools/trash.test.mjs
node tools/helpers.test.mjs
node tools/client-bin.test.mjs
node tools/pack-report.test.mjs

# 隔离实例 + Host 面实机
pwsh tools/probe-setup.ps1
DSH_HOME=<本仓库>/.probe-home dsh --profile web --no-open --port 3082 --host 127.0.0.1
```
