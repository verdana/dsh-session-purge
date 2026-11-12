# dsh-session-purge × DSH 0.2.2-rc.2 兼容性核查

日期：2026-11-11（2026-11-12 补 rc.2 实机复验）
插件：`dsh-session-purge@0.5.8`（本轮改动尚未发版，见 CHANGELOG「未发布」）
目标 DSH：`0.2.2-rc.2`（标签 `dsh-v0.2.2-rc.2`，`ddac96760b`）
基线：`0.2.2-rc.1`（标签 `dsh-v0.2.2-rc.1`，`66491b05e3`）
取证方式：**源码级 + rc.2 实机复验**。2026-11-12 本机 CLI 升级到 `0.2.2-rc.2` 后，在隔离
`DSH_HOME` 里以 `link:` 装入本仓库起 `dsh --profile web`，Host 半的路由与浏览器半的打包下发
全部实跑（见「rc.2 实机证据」）；DOM 交互仍未在浏览器里执行（见「取证局限」）。

## 结论

**无兼容性阻断项。** 插件依赖的契约面在 rc.2 中全部仍成立：5 个 `webServer.register` 路由、
`sessions` / `agents` / `workspaceRegistry` / `sessionPersistence` 的方法、持久层 `.jsonl` /
`.jsonl.zstd` 落盘约定、会话行菜单 DOM 与内置项顺序、设置页导航结构、`sidebar.panellist` /
`main` / `settings.section` 槽位、客户端插件加载模型（`dsh.client.inject` / `platform: web`）、
`cordis.patch.yml` 的 `- insert:` 合成；0.5.8 针对 0.2.2 的两处视觉修复（菜单图标容器、
设置导航图标容器）在 rc.2 的菜单基元重构后**仍然正确**。

但 `rc.1 → rc.2` 不是版本号翻转：**4645 个文件、+160844 / −58399 行**（1568 个提交），
因此本报告没有沿用「rc.x 只改 package.json」的旧结论，而是逐项重新取证。三类剩余事项均非阻断：

1. **语义退化（低）**：`agents.enter()` 在 rc.2 只收一个参数，回滚分支多传的 `owner` 被忽略、
   读到的 `AgentEntry.owner` 是 `undefined`——不抛错，但「以 owner 身份重新登记」不再存在。
2. **新条件风险（中·条件性）**：rc.2 在 `unarchiveSession` 里新增 `workspace/session-unarchiving`
   钩子且**不包 try/catch**；监听器抛错会让「复原」在会话已搬回 `sessions/` 之后仍留在归档集合。
   当前只有实验性 worktree 插件监听该钩子，官方 bundle 未装配。
3. **既有项**（rc.1 起就存在，不是 rc.2 回归）：非中英界面功能失效、`engines.node` 文档口径、
   `contextMenus.register` / `settings.section.icon` 迁移。

## 核查方法

按插件实际调用面取证，而不是按包名扫 diff：

- Host 半 `lib/index.js`（2210 行）：`ctx.inject(['sessionPersistence'])`(:1939)、
  `ctx.inject(['webServer'])`(:1946)、`host.webServer.register({kind:'exact', path, handler})`
  （:1960 / :1996 / :2038 / :2097 / :2162）、`sessions.list/get/store.get/detachEntered/flush`、
  `agents.list/get/store.get/detachEntered/enter`、`workspaceRegistry.list/archivedSessionIds/
  archiveSession/unarchiveSession`、`sessionPersistence.locate()`、`ctx.get('dshHomePath')`、
  `agent.phase.kind` + `agent.scope.dispose()`。
- 浏览器半 `client/client.js`（3003 行）：`div[role="menu"]` / `button[role=menuitem]` 选择器、
  菜单三项有序子序列、设置导航 `[role="dialog"] nav button`、`settings.section` /
  `sidebar.panellist` / `main` 槽位注册、`locale` 服务、`--dsw-alias-*` 主题变量。
- 包元数据：`package.json` 的 `dsh.bundle.patch`、`dsh.client.{inject,platform}`、`engines`；
  `cordis.patch.yml` 的插入结构；`scripts/publish-npm.mjs` 的发布闸门。
- 差异规模参考：packages 2713 文件、apps/web 172、.agents 301、docs 335；按包 client 699 /
  experimental 605 / subagent 109 / api 107 / web 89 / core 70 / session 47 / bundle 31。
  仓库根**没有** CHANGELOG.md，上游没有 breaking 清单可抄——只能按契约面读。

## 契约核对：Host 半

| # | 契约 | rc.2 证据（file:line） | 判定 |
|---|---|---|---|
| 1 | `webServer.register(route)` 形状 | `packages/host/webserver/src/index.ts:445`；`WebRoute` 接口 :52-58（`kind` / `path` / `handler`） | 不变。packages/host/* 九个包本轮**只改 package.json**；5 个 exact 路径互不冲突 |
| 2 | `sessionPersistence` 注入名 + `locate()` | `session-persistence/src/index.ts:144,149`（abstract class / `super(ctx,'sessionPersistence')`）、`:210` list；`session-persistence-jsonl/src/index.ts:345` private locate | 不变（两包本轮只改 package.json）。`SessionPersistenceSnapshot` 结构 :51 仍是 `{header, formatStatus?, revision, eventCount?, sizeBytes?, location?}`——可作为 `locate()` 的公开替代 |
| 3 | 会话格式版本 | `core/session/src/types.ts:90` `SESSION_FORMAT_VERSION = 4`；`session-format-v0-to-v1 … v3-to-v4` 仍在，**没有 v5** | 不变 |
| 4 | `.jsonl` / `.jsonl.zstd` 文件名 | `session-persistence-jsonl/src/format.ts:254,267,298`；`index.ts:1690` | 不变（`LOG_FILENAME_RE` 语义继续成立） |
| 5 | `sessions.list/get/flush`、`store` / `detachEntered` | `core/session/src/index.ts:1463`(list) / `:1455`(get) / `:1422`(flush) / `:1145`(private store) / `:1347`(private detachEntered) | 不变。rc.2 该文件 +128 行全是批量 append（`append(inputs)`、batchPublication），会话注册表区没有 hunk |
| 6 | `agents.list/get/enter/store/detachEntered` | `core/agent/src/index.ts:588`(list) / `:580`(get) / `:474`(enter) / `:250`(private store) / `:511`(private detachEntered) | **语义变化**：`enter(agent, owner)` → `enter(agent)`；`AgentEntry` 不再有 `owner`；`ClientAgentOptions.parentAgent` / `isOwnedBy` / `roots()` 删除。见下文专项 |
| 7 | `agent.phase.kind`、`agent.scope.dispose()` | `core/agent/src/runtime-types.ts`；`core/agent-loop/src/agent.ts:112,115,119,157`；`core/scope/src/index.ts:111` | 不变 |
| 8 | `workspaceRegistry.list()` / `archivedSessionIds` | `workspace/workspace/src/index.ts:308,360`；`workspace/types.ts:120` | 不变（该文件仅 +23/−1，且不含这些成员的 hunk） |
| 9 | `archiveSession(id)` / `unarchiveSession(id)` | `workspace/workspace/src/index.ts:381` / `:420` | **签名不变、语义新增**：`unarchiveSession` 在 :426 先 `await ctx.parallel('workspace/session-unarchiving', …)`，且不在 try/catch 内 |
| 10 | `attachSession` / 工作区条目 | `workspace/workspace/src/entity.ts:110`；`workspace/index.ts:524,496,883` | 不变 |
| 11 | `ctx.get('dshHomePath')` 是**函数** | `boot/app-boot/src/index.ts:1243` `ctx.provide('dshHomePath', dshHomePath)`；`util/home-paths/src/index.ts:160` | 不变。app-boot 本轮 50 行改动只涉及 `.env` 引导变量（`HOME_LAYER_PROXY_NAMES` 大小写、新增 `HOME_LAYER_ENDPOINT_NAMES={DEEPSEEK_BASE_URL, DEEPSEEK_SEARCH_BASE_URL}`） |
| 12 | profile / patch 合成（`- insert:`） | `boot/app-boot/src/profile-plugins.ts:73`；`profile.ts:699-700`；`compatibility-preflight.ts:63-77,172-186` | 不变。web-app 的 `cordis.patch.yml` 本轮改了 55 行（新增 mcp-manager / office-kit / workspace-dependencies / skill-office / ui-agent-team，移除 account-controller），**不涉及 purge 的服务 id** |
| 13 | 插件注册形状 / 版本预检 | `vendor/cordis/src/registry.ts:9,319`；`apps/cli/README`（安装与 profile 启动按 `engines.dsh`，缺省按 `@deepseek-ai/dsh*` peers 检查） | 不变；插件两者皆无 → preflight 走无约束分支，不拦也不告警（信息项） |
| 14 | 客户端插件加载 | `client/web/src/platform.ts:8-19`（`PLATFORM_MODULES` 含 ui-primitives）；`client/modules/src/client/manifest.ts:176-185` | 不变；`client/modules/src/client/entries.ts` 新增容错（单个 entry 创建失败只记 error，不中断启动）——对插件是净改善 |
| 15 | `link:` 安装 | `plugin-manager` 新增 `update?: 'registry' | 'git'`、`unmet`、`unexpected-package`、`expected` 校验、`pinnedGitOrigin`（`install-spec.ts`） | 不影响 `link:` 与 `dsh.bundle.patch` 装配 |
| 16 | `jobs.list(caller?)` | `jobs/jobs/src/index.ts:121`；`jobs-local/src/index.ts:321` | 不变（插件未直接依赖，仅作对照） |

## 契约核对：浏览器半

| # | 契约 | rc.2 证据 | 判定 |
|---|---|---|---|
| 1 | 会话行 ⋯ 触发器：`span.rowActions` 内 `button[aria-label]` + `data-context-menu-trigger` | `ui-workspace/src/client/rows/Rows.tsx:748-756`；`ui-context-menu/src/client/Button.tsx:32-62` | 结构变化、DOM 契约不变：rc.2 改由 `contextMenu.button` 工厂槽渲染，三个属性/层级全部保留 |
| 2 | 从 `aria-label` 解析会话标题 | `ui-workspace/src/client/locales.ts:100,226` | 不变 |
| 3 | 菜单容器 `div[role="menu"]` | `ui-primitives/src/MenuSurface.tsx:11,25,41-46`；`ui-workspace/src/client/session-actions/Menu.tsx:490,520,524-527` | 不变（archive 在 footer `div[role=presentation]` 内，`role=menu` 仍是祖先） |
| 4 | 菜单行 `button[role=menuitem]` | `ui-primitives/src/MenuRow.tsx:40-50`（rc.2 新文件） | 结构变化、选择器不变：克隆目标仍是 `div.itemWrap > button[role=menuitem]` |
| 5 | 图标容器 `span.itemIcon`（0.5.8 修复点） | `MenuRow.tsx:48`：`aria-hidden={decorativeIcon || undefined}`，内含 svg | 不变：组件行传 `decorativeIcon={false}`，图标不是 aria-hidden；行的 aria-hidden 只有快捷键键帽。0.5.8 的「含 svg 就保留」规则照样命中 |
| 6 | 键帽 `span[aria-hidden="true"]`（0.5.8 修复点） | `MenuRow.tsx:50`（`span.shortcut`） | 不变，删除规则仍有效 |
| 7 | 菜单项顺序：重命名 → 分叉 → 复制 Session ID → 归档 | `session-actions/context-menus.tsx:35-68`（pin 100 / rename 200 / fork 300 / id 450 / archive 600） | 不变；`session-actions/` 整目录 rc.1→rc.2 **零 diff**，有序子序列匹配继续成立 |
| 8 | 归档 / 取消归档文案 | `locales.ts:61-66,187-192`（归档会话 / 取消归档） | 不变 |
| 9 | 归档项 `separatorBefore: true` + `afterContent: true` | `context-menus.tsx:59-67` | **需注意**：克隆会连带分隔线与权限属性，本轮已清（见落码修复 1） |
| 10 | 设置页：`[role=dialog] nav button` + `span.navIcon[aria-hidden]` | `ui-settings-general/src/client/SettingsRoot.tsx:73,79,91` | 不变 |
| 11 | 设置导航图标隐藏（0.5.8 修复点） | `SettingsRoot.tsx:92` `renderSlot('settings.section.icon', …, { only: row.id, fallback: navIcon(row.id) })` | 不变：`> span[aria-hidden="true"]` 仍命中整个 navIcon |
| 12 | `settings.section` 注册与 label thunk | `ui-settings/src/client/contract/slots.ts:57`；`ui-settings-general/src/client/index.ts:163-181,237-243` | 不变 |
| 13 | `sidebar.panellist` 侧栏回收站入口 | `ui-sidebar/src/client/contract/slots.ts:47`；`ui-sidebar/src/client/index.ts:57-71,89-92` | 不变 |
| 14 | `main` keyed 槽 + `layout.selectPanel` | `ui-layout/src/client/index.ts:75,197`；`ui-layout/src/client/service.ts:74` | 不变（插件已带 key 注册） |
| 15 | 侧栏 header 锚点（添加工作区 / 视图选项） | `ui-workspace/src/client/rows/WorkspaceBrowser.tsx:1290,1299-1305,191-195` | 不变 |
| 16 | `ctx.sessions` 快照 `{ids, byId, displayTitle, cwd, running}` | `api/session-controller/src/client/sessions/service.ts:26-68,259,298` | 不变 |
| 17 | locale 服务 `getLocale().active` | `client/locale/src/client/index.ts:75-82,205` | 形状不变；语言集 rc.1 已是 8 个（de/en/es/fr/ja/pt/ru/zh），非 rc.2 新增 |
| 18 | 主题变量 `--dsw-alias-*` | `ui-theme` 未改名 | 不变（插件全部带 fallback） |

## 三处需要读懂的结构性变化

### 1. 菜单基元抽出 `MenuRow`（DOM 形状不变）

rc.2 新增 `packages/client/ui-primitives/src/MenuRow.tsx`，把 rc.1 `Menu.tsx` 里内联的菜单行
结构抽成独立组件（`Menu.tsx` 348 行改动、`Menu.module.css` +194，新增 `useMenuSubmenu.ts` /
`menu-submenu-position.ts` / `SubmenuPanel.tsx`）。DOM 与 rc.1 同构：

```
div.itemWrap[wrapperProps]          ← wrapperProps 可注入 aria-*
  ├─ div[role="separator"]          ← 仅 separatorBefore 时
  └─ button[role="menuitem"]
       ├─ span.itemIcon             ← aria-hidden = decorativeIcon || undefined（组件行 false，data 行 true）
       ├─ span.itemLabel
       ├─ span[aria-hidden="true"].shortcut   ← 仅快捷键
       ├─ svg.check                 ← 仅 selected
       └─ svg.check                 ← 仅 aria-haspopup="menu"（子菜单 chevron）
```

Tooltip 仍是 `cloneElement`、不产生 DOM 包裹，所以 `sourceBtn.parentElement` 仍是 `div.itemWrap`，
克隆与 `insertBefore(clone, wrap.nextSibling)` 全部照旧。`MenuSurface` 未改（根是 div，
`role={exiting === undefined && !submenu.page ? 'menu' : undefined}`），键盘导航仍是
`list.querySelectorAll('button:not(:disabled)')`（rc.2 :418 = rc.1 :428），注入的 button 仍参与
方向键循环。**结论：注入逻辑不需要改，0.5.8 的两处修复也不需要改。**

### 2. agents 所有权模型删除（插件只碰到一处）

rc.2 的 `AgentEntry` 变成 `{id, agent, carrier, announced, announcing, detachRequested}`，
`enter()` 去掉第二参数并改为 `register` 里 `yield this.enter(agent)`；`ownedBy()` 判定
（`return this.store.get(id)?.owner === owner`）删除，`ClientAgentOptions` 的 `parentAgent` /
`isOwnedBy` / `roots()` 一并删除。插件只有一处触碰：

```js
// lib/index.js:743（会话 detach 失败后回滚 agent 登记）
agents.enter(agent, agentEntry.owner);
```

rc.2 下多传的参数被忽略、`agentEntry.owner` 是 `undefined`（读属性不抛），所以**运行时兼容**；
代价是回滚退化为「只登记、不持有 teardown」。不按版本分支改（旧版继续传 owner 才有意义），
只在 DEVELOPING 的内部面表里记一笔。

### 3. `unarchiveSession` 新增无保护的钩子（条件性风险）

rc.2 `workspace/workspace/src/index.ts:426`：

```
if (!state.archivedSessionIds.includes(sessionId)) return        // 早退在钩子之前
await this.ctx.parallel('workspace/session-unarchiving', { sessionId })   // 无 try/catch
… // 之后才从 archivedSessionIds 移除
```

对照 `archiveSession`：它的同类钩子包了 try/catch，catch 里
`logger.warn('Session archived, but archive follow-up admission failed: %s', error)`——只有
unarchive 这一侧没保护。当前监听器只有 `packages/experimental/worktree/src/archive.ts:87`，
官方 bundle 未装配，所以是条件性风险。

插件的复原链路（`lib/index.js`）：`restoreSession` 把 `.jsonl` 搬回 `sessions/` 之后调
`reattachRestoredSession()`（:1665），其中 :1714-1719 无条件
`workspaces.unarchiveSession(entry.id)`，catch 只记 debug 日志；:1721-1728 再按
`entry.wasArchived === true` 补一次 `archiveSession`。失败模式：会话文件已复原、但归档集合仍
含该 id → 界面上「恢复成功却仍被归档隐藏」，刷新也不会自愈。若将来官方 bundle 装配了抛错的
监听器，这里需要在 catch 里复核 `archivedSessionIds`、重试一次，并把结果标进响应。

## 问题清单（按严重程度排序）

| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| 1 | **中·条件性** | rc.2 `unarchiveSession` 的 `workspace/session-unarchiving` 钩子无 try/catch；监听器抛错会让复原「成功但仍归档」 | 未落码（当前无官方监听器；DEVELOPING 已记） |
| 2 | **低** | `agents.enter(agent, owner)` 的 owner 语义在 rc.2 不存在；回滚退化为只登记 | 不改代码（兼容），文档记录 |
| 3 | **低** | 克隆归档行会把 `separatorBefore` 的分隔线与 `aria-disabled` / `aria-describedby` 带进新项（多一条分割线、重复 DOM id） | **已修复**（本轮） |
| 4 | **低** | `.sd-dlg-btn:hover` 的边框色写错变量（`--dsh-` 应为 `--dsw-`），永远取 fallback | **已修复**（本轮） |
| 5 | **低** | 非 zh/en 界面（rc.2 内置 8 语言）下菜单识别与设置导航标记失效、插件文案回退中文 | 既有缺口（rc.1 同样），非本轮引入 |
| 6 | **低** | 菜单打开期间 React 重渲染 footer（rc.2 支持权限/置顶快照实时更新）可能丢弃注入项；sweep 只在新增 `div[role=menu]` 时触发 | 已知，关闭重开可恢复；根治要迁 `contextMenus.register` |
| 7 | **低** | `engines.node` 声明 `^22.19.0 || >=24.0.0` 比 DSH 的 `>=24.9.0` 宽；Node 24.0–24.8 装得上插件但 DSH 自己拒绝启动 | 文档口径本轮补齐；engines 不改（旧版 DSH 还要用 22.x） |
| 8 | **信息** | 未声明 `engines.dsh` / `@deepseek-ai/dsh*` peerDeps，rc.2 的兼容性预检对插件走无约束分支（不拦、不告警） | 建议评估 |

## 本轮落码修复

两处都在浏览器半，都不按版本分支：

1. **克隆项清理**（`client/client.js`，`injectMenuItem`）：删掉 clone 里的
   `div[role="separator"]`，并移除 clone 内所有 `aria-disabled` / `aria-describedby`。
   rc.1 起归档项就声明 `separatorBefore: true`，克隆后会在「移入回收站」下方多出一条分割线；
   权限受限时还会继承 disabled 语义、让 `aria-describedby` 指向重复 id。
2. **主题变量拼写**：`.sd-dlg-btn:hover` 的 `border-color:var(--dsh-alias-label-secondary,…)`
   改为 `--dsw-`（全仓库其余 token 都是 `--dsw-`）。

回归测试见下节；两处都是纯 DOM 清理，无行为分支。

## 本轮验证

- 契约面逐项核对：Host 16 项 + 浏览器 18 项（表见上），全部有 rc.2 标签源码的 file:line 证据。
- `node --test --test-isolation=none tools/{helpers,trash,client-bin,pack-report}.test.mjs`：
  **138/138 通过**（`npm test` 的管道版会因沙箱禁止 spawn 子进程而 EPERM，所以用等价命令跑）。
  已知噪声：`trash.test.mjs` 收尾 `ENOTEMPTY` 清理告警（断言全过）。
- **rc.2 实机复验通过**（2026-11-12，本机 CLI 已是 `0.2.2-rc.2`）：在隔离 `DSH_HOME` 上以
  `link:` 装入本仓库起 `dsh --profile web`，Host 半 9 条路由与浏览器半的打包下发全部实跑，
  见下节「rc.2 实机证据」。

## rc.2 实机证据

2026-11-12 复验。隔离环境：`DSH_HOME=<temp>\purge-rc2-home`（`profiles/web/package.json` 里
`dsh-session-purge: "link:D:\\dsh-session-purge"`，bundles = base + web-app + 本插件），
`dsh --profile web --no-open --port 3081 --host 127.0.0.1`，请求带 `?token=` 换来的会话 cookie。

1. **Host 半全部路由实跑通过**（插件 `0.5.8`）：
   - `GET /session-purge/state` → `{ok:true, persistence:true, held:[…], sessions:[{id, cwd, sizeBytes, archived}…]}`
     —— `sessionPersistence.locate()/list()`、`sessions.store.get` 在 rc.2 正常工作。
   - `POST /session-purge/trash {"sessionId":…}` → `{ok:true, mode:"trashed", trashId:"t-20261112T082124-2b26b5"}`；
     会话目录移出 `sessions/<workspace>/`，回收站条目保留 `originalDir` / `cwd`。
   - `POST /session-purge/restore {"sessionId":…}` → `{ok:true, restoredTo:…, wasArchived:false, cwdMissing:false}`；
     复原文件 **sha256 与删除前逐字节一致**（`0a853d3a…`，24337 B；另一会话 24382 B 同样一致）。
   - `POST /session-purge/purge` → `{ok:true, freedBytes:24262}`，会话目录从磁盘移除。
   - `POST /session-purge/delete`（`/trash` 的兼容别名）→ `mode:"trashed"`，随后复原正常。
   - `GET/POST /session-purge/settings` → 枚举校验生效：`retentionDays ∈ {0,7,30,90,365}`、
     `entryPlacement ∈ {icon,menu}`，越界返回 `400 settings-invalid`。
   - `POST /session-purge/sweep {}` → `{ok:true, removed:0, reason:"manual"}`；启动时的 `sweepOnBoot`
     也真的跑了（`lastSweepAt` 有值）。路由体按 JSON 解析，裸 POST（无 body）返回 `400 bad-request`，
     客户端总是发 `{}`，故不影响使用。
   - **重启存活**：杀掉进程、重启同一 `DSH_HOME` 后，回收站条目与 `retentionDays=7` 设置都在，
     重启后复原仍逐字节一致。
2. **注册面**：5 条 exact 路由在 rc.2 的 `webServer` 上注册无冲突、无告警，服务正常启动。
3. **浏览器半被 rc.2 正常组合下发**：shell HTML 的 client 启动载荷里含
   `{"id":"dsh-session-purge","url":"plugins/??dsh-session-purge/client.js&rev=66318f022cc7"}`；
   `GET /plugins/??dsh-session-purge/client.js&rev=66318f022cc7` → `200 text/javascript`，
   **136911 字节**，内含 `sd-menu-item`×3、`sd-settings-nav`×4、`session-purge/trash`×2
   —— rc.2 的 client-modules 成功把插件浏览器半组装进模块图并下发，加载链路不是推断。

未覆盖：DOM 交互（Playwright 启动浏览器被沙箱拒绝），见「取证局限」。

## 取证局限

- **DOM 仍未在浏览器里跑过**：Playwright 启动 msedge 被本机沙箱拒绝（`spawn EPERM`），提权重试
  在 120s 内未返回审批，故「Escape 关闭菜单」「React 重渲染丢弃注入节点」两条仍是源码推断；
  但插件浏览器半已被 rc.2 的 client-modules 成功组合并下发（见实机证据第 3 条），加载链路本身不是推断。
- rc.1→rc.2 差异巨大（1568 commits / 4645 files / apps/web +7743 / −1042），本报告只覆盖插件
  实际依赖的契约面，不是全量回归。
- 行号取自 rc.2 标签源码；`git show dsh-v0.2.2-rc.2:<path>` 是权威读法——当前工作树 HEAD 比
  rc.2 标签新 528 个文件，直接读工作树会得到错误结论。
- 详细的逐文件审计材料在 `.compat-run/audit-host.md` 与 `.compat-run/audit-client.md`
  （已 gitignore，不随包发布）。

## 复现命令

```powershell
# 差异规模与契约面取证（必须读标签，不要读工作树）
git -C D:\deepseek-harness diff --stat dsh-v0.2.2-rc.1..dsh-v0.2.2-rc.2
git -C D:\deepseek-harness diff dsh-v0.2.2-rc.1..dsh-v0.2.2-rc.2 -- packages/core/agent packages/workspace/workspace
git -C D:\deepseek-harness show dsh-v0.2.2-rc.2:packages/client/ui-primitives/src/MenuRow.tsx

# 插件回归（沙箱里 spawn 受限，用 test-isolation=none 等价跑）
node --test --test-isolation=none tools/helpers.test.mjs tools/trash.test.mjs tools/client-bin.test.mjs tools/pack-report.test.mjs
```

> **rc.2 实机复验**（2026-11-12 已跑通）：
> ```powershell
> $home = "$env:TEMP\purge-rc2-home"   # profiles/web/package.json: dsh-session-purge = "link:D:\dsh-session-purge"
> $env:DSH_HOME = $home; dsh --profile web --no-open --port 3081 --host 127.0.0.1
> curl -c jar.txt "http://127.0.0.1:3081/?token=<token>"     # 换 cookie
> curl -b jar.txt http://127.0.0.1:3081/session-purge/state
> curl -b jar.txt -X POST -H "content-type: application/json" -d "{\"sessionId\":\"<id>\"}" http://127.0.0.1:3081/session-purge/trash
> ```
> 浏览器探针（`tools/bin-live-probe.mjs` 等）需在允许 spawn 子进程的环境里跑。
