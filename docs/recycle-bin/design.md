# 会话回收站 — 技术设计

配套文档：[spec.md](./spec.md)（产品功能规格 / 验收标准）。
本文只写**实现层面**：已核实的上游事实、磁盘与接口契约、算法、测试计划、改动清单与风险。

> 所有"上游事实"都带 `文件:行号`，均在本机 DSH 源码树 `D:\deepseek-harness`（版本 `0.2.1-rc.2`；
> 上一版基线为 `0.2.0-rc.2`，两代差异见 [compat-0.2.1-rc.2.md](../compat-0.2.1-rc.2.md)）中逐条读过。
> 之后的增量见 [compat-0.2.1-rc.4.md](../compat-0.2.1-rc.4.md) 与 [compat-0.2.1-rc.5.md](../compat-0.2.1-rc.5.md)：
> 这两段区间内本文引用的上游文件只有 `ui-primitives/src/Menu.tsx` 与
> `ui-settings-general/src/client/index.ts` 有改动，均为增量（`aria-current` / `minWidthFromAnchor`
> 与一处埋点），不改变本文的结论；rc.4 → rc.5 只动了 `ui-chat` 的 reasoning 渲染，本文未引用该文件。
> 标注 **UNVERIFIED** 的条目表示尚未实机验证，必须在 M1/M2 阶段用探针确认后再依赖。

## 0. 实现状态

| 里程碑 | 状态 | 落地位置与证据 |
|---|---|---|
| **M1 宿主回收站内核** | ✅ 已完成 | `lib/index.js`：`locateSessionDirectory()` 共享定位/安全闸门、`trashSession`/`restoreSession`/`purgeSession`/`emptyTrash`/`sweepTrash`/`recoverTrash`/`trashSummary`/设置读写/串行化 + 9 条路由 + 启动维护与 15 分钟清扫心跳；`tools/trash.test.mjs`（M1 时 27 例，现 32 例）；`tools/repro-trash.mjs` 对**真实 v4 JSONL 后端 + 真实 373 KB 会话副本**跑通 移入 → 列表不含 → 复原（逐字节一致 + 身份校验通过）→ 真实删除 → 过期清理 |
| **M2 客户端主流程** | ✅ 已完成 | `client/client.js`：侧边栏第 4 个图标（自建 React 根 + primitives `Tooltip`/`IconTrashOutlineRegular` + 运行期复用锚点 className + 覆写 60px 上限）、回收站面板（primitives `Modal`，含空态/列表/分页/逐行复原与真实删除/清空/失败重试）、菜单项「移入回收站」+ 中性确认弹窗 + 成功 toast（带「打开回收站」动作）、复原后 `sessions.refresh()`；`tools/client-bin.test.mjs`（M2 时 17 例，现累计 41 例）；`tools/trash-panel-probe.mjs`（真实 React + 主题，**7 种状态**、明暗两套）；`tools/bin-live-probe.mjs`（M2 时 20 项，现 45 个断言点，含"移入后行消失 / 复原后行回来，均不刷新页面"） |
| **M3 设置页与自动清理 UI** | ✅ 已完成 | `client/client.js`：`settings.section` 注册（可选注入 `slots`，`id: session-purge`，`order 50`，label 用 thunk 跟随语言）+ 设置页（primitives `Switch`/`SegmentedControl`/`Input`，缺失时自绘同语义控件）、每字段独立写入并采纳宿主回值、调度控件随 `autoClean` 锁定、统计行、立即清理、打开回收站；面板策略行变成进入设置页的入口（按 shell 自己的启动按钮的 aria-label）。`tools/settings-render-probe.mjs`（自绘路径逐控件断言，含页脚版本/更新链接）；`tools/bin-live-probe.mjs` 现 45 个断言点，含真 shell + primitives 的设置腿 |
| **M4 打磨与发布** | ✅ 已完成 | 2026-10-18 发布 `0.5.2`；2026-10-21 发布 `0.5.3`（设置页导航图标、页脚版本号、npm 更新提示）；2026-10-25 发布 `0.5.4`（失败路径修复 `fix(queue)`/`fix(bin)`/`fix(http)`/`fix(sweep)`/`fix(trash)`，成功提示改 toast）。README/README.en/DEVELOPING 已按回收站语义更新，`spec.md` §13 记录已知边界，CI 跑 `tools/*.test.mjs`。逐版变更见 `CHANGELOG.md` |

M1 期间被真实跑出来的两个缺陷（都已修 + 已加回归）：

1. `/session-purge/trash` 一度注册了**两个** exact 路由（GET 与 POST 各一个），
   后者会遮蔽前者——现在一个 handler 内按方法分派。
2. `removeSessionLog` 重构时把 `removeDirectoryWithRetry(ctx, dir)` 传错了参数，
   永久删除整条路径静默失败；`tools/repro-delete.mjs` 抓到，`tools/trash.test.mjs`
   现在钉住了永久删除的返回形状。

M2 期间被真实跑出来的三个实现细节（都已在代码里落地）：

1. 行菜单的 ⋯ 按钮在未悬停时是 `visibility:hidden`，探针必须直接派发 click
   （沿用 `tools/dialog-probe.mjs` 的老办法）；DOM 注入的锚点识别因此不能依赖"可点"。
2. 侧边栏注入用**锚点按钮的运行期 className** 渲染自己的按钮，视觉与三图标一致；
   集群的 `max-width` 由 `anchor.parentElement` 覆写——探针断言了"未被任何
   `overflow:hidden` 祖先裁掉"。
3. 第三方主题（本机探针 home 装着 Nord）会把 `--dsw-alias-state-warn-primary` 覆盖成
   十六进制 `#D08770`，所以任何"颜色对比"断言都必须同时解析 `#rrggbb` 与 `rgb()`。

一个刻意的实现取舍：面板挂在**插件自己的 React 根**上（`primitives.Modal` 负责遮罩/portal/
焦点层/Escape），而不是注册进 `shell.overlay`。原因是面板需要与"侧边栏图标是否找到锚点"无关地
始终可用，自有根在 0.1.5–0.2.0 全代都成立；`shell.overlay` 路线（§2.9）保留为后续增强，
它带来的只是与应用弹窗栈的登记关系，视觉与行为已由 Modal 原语保证。

---

## 1. 现有实现回顾

`0.4.5`（回收站之前的版本）做的事：

- `lib/index.js`：`GET /session-purge/state`、`POST /session-purge/delete`、`POST /session-purge/undo`；
  `deleteSession()` 先做驻留检查 → `tearDownResident()`（严格 idle 才拆）→ `removeSessionLog()`（`rm -rf` 会话目录）→ 尽力 `archiveSession()`。
- `client/client.js`：DOM 注入会话行菜单的「删除会话」+ 自有 React 确认弹窗（`.sd-dlg-host`）。
- 关键复用点（回收站直接沿用）：菜单注入框架、弹窗宿主与样式、`sessionDirectoryFromLogPath()` 安全校验、
  `resolveHome()`、`pending.json` 重启队列、`sameOrigin()`/`readJsonBody()`。

回收站把 `removeSessionLog()` 的 `rm` 换成 `rename`，并新增复原/真实删除/清理/设置。

---

## 2. 上游扩展点：已核实的事实与结论

### 2.1 侧边栏「工作区」行没有可用槽位

- 侧边栏外壳只声明这些槽位：`sidebar.brand.mark/name`、`sidebar.toggle.badge`、`sidebar.panellist`、
  `sidebar.workspaces`、`sidebar.settings`、`sidebar.footer.action`
  （`packages/client/ui-sidebar/src/client/index.ts:80-86`，契约 `.../contract/slots.ts:19-53`）。
- `sidebar.workspaces` 是 **single**，由 ui-workspace 的 `WorkspaceBrowser` 占位，它内部包含"整块浏览区域：
  section header、搜索、分组/扁平列表、工作区弹窗"（`packages/client/ui-workspace/src/client/contract/slots.ts:4-20`）；
  同优先级再注册一次会直接抛错（`ui-slots/src/index.ts:1216-1219`）。
- 「工作区」行的三个图标（搜索 / 视图选项 / 添加工作区）全部渲染在 `WorkspaceBrowser.tsx` 的
  `css.headerActions` 与 `css.searchSlot` 内（`.../rows/WorkspaceBrowser.tsx:1209-1303`），
  **没有为 header 动作声明任何槽位**；全量槽位目录（94 个 key）里不存在 `sidebar.workspaces.header*`。
- **该集群有硬性宽度上限**：`.headerActions { flex:none; display:flex; align-items:center; gap:4px;
  max-width:60px; overflow:hidden }`（`ui-workspace/src/client/rows/WorkspaceBrowser.module.css:118-132`）。
  2 个图标 28px + 4px 间距 = 恰好 60px。**注入第 4 个按钮必须同时覆写这个 `max-width`**，
  否则按钮会被裁掉。
- 上游 class 名是 CSS Module 哈希（`[hash]_[local]`，`packages/client/tsdown.client.ts:562`），
  没有可用的固定选择器；唯一稳定的 DOM 缝是 `[data-slot="<key>"]` 包装（`ui-renderer/src/client/scoped-slots.tsx:1081-1091`），
  而 section header 里没有。
- 三个按钮的可定位标识来自 locale（`.../client/locales.ts`）：
  | 按钮 | zh aria-label | en aria-label |
  |---|---|---|
  | 搜索 | 搜索会话 | Search sessions |
  | 视图选项 | 视图选项 | View options |
  | 添加工作区 | 添加工作区 | Add workspace |
  注意 section 标题会随视图模式变化（`section.workspaces` ↔ `section.sessions`，`WorkspaceBrowser.tsx:1212`），
  **不可**用标题文本做锚点。折叠态（rail）只渲染搜索与添加工作区（`:1273`、`:1325-1339`）。

**结论（D3）**：侧边栏第 4 个图标只能用 DOM 注入 + 覆写集群 `max-width`，锚点优先 `添加工作区`、退而 `视图选项`。
（上游 slot 提案见 spec.md §11。）

### 2.2 槽位注册 API 与第三方先例

- 注册形状：`ctx.slots.inject(slotName, () => ctx.slots.register({ name, id, order, label?, locale?, store?, inject? }, Component))`
  （`packages/client/ui-slots/src/index.ts` 的 `BaseOptions`/`SlotEntryOptions`；`ui-workspace/src/client/index.ts:295-303` 是内置项用法）。
- `store` / `inject` / `locale` / `label` 全部**可选**（`ui-slots/src/index.ts:776-777,824-890`），
  所以"组件自己 fetch、自己管状态"的注册是合法的。
- `sidebar.workspaces.session.menu.item` 是公开的 list 槽位，契约里直接给了第三方示例
  （`ui-workspace/src/client/contract/slots.ts:148-166`）。**UNVERIFIED**：本插件当前走的 DOM 注入
  是否可以迁移到该槽位（涉及 0.1.5 兼容与 `inject` face）。评估结论：为保留 0.1.5 兼容，当前仍走
  DOM 注入，未迁移到该槽位。

### 2.3 设置页：`settings.section` 是可用扩展点

- 槽位：`'settings.section': { kind: 'list'; scope: 'root'; owner: SettingsSectionOwnerProps }`，
  owner props 只有一个 `close()`；注册项选项携带 `id`（导航 key）、`order`、`label`（可传 thunk，语言切换自动跟随）
  （`packages/client/ui-settings/src/client/contract/slots.ts:46-57,119-129`）。
- 第三方先例：`dsh-nord` 就是这么做的（`D:\deepseek-harness\dsh-nord\src\client\index.ts:140-172`），
  编译产物里是 `ctx.slots.inject("settings.section", ...)`（`dsh-nord/lib/client.js:2141`）。

### 2.4 配置持久化：`configForms` 路线对本插件不可用

- `dsh-nord` 的持久化走宿主导出的 schemastery `Config` + 浏览器侧 `ctx.configForms.get(entryId)`
  （`dsh-nord/src/schema.ts:1-64`、`src/client/settings.ts:60-169`、`src/index.ts:83-127`）。
- 但本插件是**零依赖、免构建**发行，实测无法解析任何 `@deepseek-ai/*` 包：

  ```text
  在 D:\deepseek-harness\dsh-session-purge 与 %DSH_PROFILE_DIR% 下
  require.resolve('@deepseek-ai/schemastery')      -> 失败
  require.resolve('@deepseek-ai/dsh-client-ui-settings') -> 失败
  ```

  浏览器侧同样只能 require **平台 seed 表**里的包（`react`、`react-dom/client`、
  `@deepseek-ai/dsh-client-ui-primitives` 等，见 §2.8）；非 seed 包的 client 半必须声明进
  `dsh.client.external` 才可能到达。

**结论（D4）**：设置由插件自有 `settings.json` + 自有 HTTP 路由承载；设置页只借用上游的**导航与容器**槽位。

### 2.5 会话在磁盘上的形状

- 路径模型（`packages/session/session-persistence-jsonl/src/format.ts:225-288`）：
  `root/<projectKey(cwd)>/<encodeSegment(id)>/session.vN.jsonl[.zstd]`；无 cwd 时项目目录为 `_no-cwd`。
- `list()` **每次调用都重新扫描目录并读取 header**，没有持久索引
  （`session-persistence-jsonl/src/index.ts:481-516` 的 `listArtifacts` → `listProjectDirs`/`listSessionDirs`：
  `:1592-1614`）。
- 会话目录里除日志外还有 `session.lock`（POSIX 内核锁文件；Windows 用同名路径派生的内核信号量，
  没有锁文件）——`.../src/lease.ts:39-85`。
- 客户端会话列表由宿主 `sessionQuery.listSessions()` 现算：持久层 listing + live 会话合并
  （`packages/session-query/session-query/src/corpus.ts:62-87`）。
- 持久层对外接口只有 `create / open / flush / stat / list`（外加 Jsonl 后端上的 `locate`，作为诊断钩子），
  **没有 `remove` / `import` / `move`**
  （`packages/session/session-persistence/src/index.ts:150-203`）。所以"移入回收站 / 复原"只能由插件
  直接操作文件系统——这正是本设计选择 `rename` 而不是调用某个上游 API 的原因；也意味着任何索引层面的
  清理只能依赖上游自己的重扫（§2.9 与 §7.2 的 `sessions.refresh()`）。
- 客户端有 `refresh()`：`packages/api/session-controller/src/client/contract/sessions.ts:107-109`，
  实现 `.../src/client/sessions/service.ts:356-357` → `manager.refreshList()`。
  **结论（D5）**：复原后调用 `ctx.sessions.refresh()` 即可让新会话出现在侧边栏（宿主侧每次重新扫描磁盘）。
  **UNVERIFIED**：`session-query-sqlite` 索引引擎的 reconcile 触发时机（`session-query-sqlite/src/index.ts:495-562`
  观察到它按 `persistence.list()` 对齐索引），M1 用探针确认"复原 → refresh → 行出现"的端到端时延。

### 2.6 归档 / 置顶集合

- registry 全局集合：`archiveSession()` 先做存在性判定，`sessionKnown()` 的判定顺序是
  live → **内存里的 header 索引** → 重新 list 持久层
  （`packages/workspace/workspace/src/index.ts:363-384`、`:466-477`）。
  `unarchiveSession()` **不做存在性检查**，可安全清理脏标记（`:397-408`）。
- 现有 `deleteSession()` 是"先 `rm` 再 `archiveSession`"。此时会话已不在持久层，但 `sessionKnown()` 的
  内存 header 索引里通常**还留着**这条记录（`indexHeader()` 只 `set` 不删，
  `.../index.ts:804-822`），所以这一调用**可能成功**：于是一个已被删除的会话 id 永久留在
  registry 全局 `archivedSessionIds` 里。后果是——一旦以后复原该会话，它会被"隐藏已归档"过滤器挡住，
  只在「仅显示已归档」视图里出现。
- **结论（D6）**：回收站不依赖归档来隐藏行，改为依赖 `sessions.refresh()`；
  移入回收站时读一次 `archivedSessionIds` 记下 `wasArchived`，**随即 `unarchiveSession()` 清掉标记**；
  复原时先 `unarchiveSession()`（幂等兜底），`wasArchived` 为真再 `archiveSession()`。
  这样既保持用户原有的归档意图，也不会留下任何指向已消失会话的脏 id。
- **工作区归属也要补**（比归档更容易踩）：`Workspace.sessionIds` 是一个**实时过滤的 getter**
  （`entity.ts:101-103`，按 registry 内存里的 header 索引筛）。本进程内移走目录时缓存还在、
  槽位保留；但**重启**后 `replaceHeaderIndex()` 只索引磁盘上还在的会话，于是那个槽位在
  下一次 workspace 写入时被**永久剪掉**，复原后的会话就落进浏览器本地的 “Ungrouped” 分组，
  而不是原来的工作区。M1 的实现（§4.2 第 6 步）在复原后调用
  `workspaceRegistry.resolveByPath(cwd)` 拿到工作区实体并 `attachSession(id)`，
  主动把归属补回来（`attachSession` 会顺带触发 header 重索引）。
  这同时解释了为什么 `/workspace` 的日志里会出现
  “filtered session 'S' from membership: session header is missing”。

### 2.7 投影缓存

- `sessionProjectionCache` 用 (formatVersion, createdAt, cwd, isSeeded) 做生命周期身份匹配，
  日志未被改写时缓存命中是"可能旧但不会错"（`packages/session/session-projection-cache/src/index.ts:104-169`）。
- 影响：会话被移出再原样移回后，缓存仍可能命中同一身份 → 内容正确；不需要主动清理。
  "从未命名会话里补标题"可作为增强（spec.md §11.6）。

### 2.8 浏览器模块加载：可用的 require 表

- 插件客户端入口固定为 `window.__ModuleLoader__.load({ id, factory })`，`id` **必须等于包名**
  （`dsh-session-purge`），`package.json` 必须有 `dsh.client.platform = 'web'` 与 `exports['./client']`。
- `factory(require)` 只能解析**平台单例表**（`packages/client/web/src/platform.ts:8-14`）：

  ```text
  react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis,
  @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
  @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
  ```

  其它包必须写进 `dsh.client.external` 且图中有对应行，否则 require 失败。
- **关键收获**：`@deepseek-ai/dsh-client-ui-primitives` 在表内，`Modal`、`Tooltip`、`Button`、
  `Switch`、`SegmentedControl`、`Input`、`MenuItemButton`、全部 `Icon*`、`relativeTime()`、
  `fileSizeText()` 都可直接用（`ui-primitives/src/index.ts:12-115`）。
  这解决了"注入按钮的提示样式/clone 节点没有 React 行为"的难题（§7.1）。
- `dsh.client.inject`（package.json）在类型文档里被标注为**信息性**声明
  （"Informational package-name dependencies, not Cordis service injection"，
  `packages/util/package-manifest/src/types.ts:80-93`），但它同时驱动**模块到达顺序**
  （`client/modules/src/client/system.ts:267-277`：先 `external` 再 `inject`）。本插件两个都不需要新增：
  bundle 只用 seed 词（`react` / `@deepseek-ai/dsh-client-ui-primitives`），设置槽位由 ui-settings-general
  声明、由 `ctx.slots.inject` 等待，**不需要** require `@deepseek-ai/dsh-client-ui-settings`。
- 真正保证"槽位声明已就绪"的是 `ctx.slots.inject(key, cb)` 本身——它在槽位声明出现时（以及 owner 重挂载后）
  才回调；往未声明的槽位裸 `register` 会抛错
  （`ui-slots/src/index.ts:1204-1207`；`ui-renderer/src/client/registry.ts:194-269`）。
- **`exports.inject` 是硬激活闸门**：列出一个永不出现的服务会让整条插件行停在 `pending` 且启动审计报错
  （`client/web/src/boot-client.ts:79-88`）。因此：
  - 本插件保持 `inject = ["sessions"]` 不变；
  - 依赖槽位的功能用**可选注入** `ctx.inject(['slots'], …)` 挂载（`dsh-nord/src/client/index.ts:31-39` 的注释
    明确记录了这个模式：可选服务绝不进 `inject`）；
  - 依赖 primitives 的地方用 `try/catch` 包住的 `require`，缺失时回退到自绘样式。

### 2.9 应用级浮层与提示：`shell.overlay` 是官方座位

- `shell.overlay` 是 list / root 槽位："Frame-wide floating layer… a badge, a toast stack or a status pill
  all belong here. The layer itself is click-through"
  （`packages/client/ui-layout/src/client/index.ts:95-105`；`root` 槽位的契约注释直接写"不要注册在 root，
  要挂到 `shell.overlay`"，`ui-renderer/src/client/registry.ts:36-49`）。
- 官方自己的弹窗/提示就注册在这里：ui-workspace 的 `workspace.session-rename`、`workspace.session-archive`、
  `workspace.row-toast`（`ui-workspace/src/client/index.ts:307-318`），ui-schedule / ui-plugin-manager 同理。
- `Toast` 是纯展示组件（`{ text, icon?, tone?, anchor?, holdMs?, actions?, onDone }`，
  `ui-primitives/src/Toast.tsx:46-60`），**由 owner 渲染**，官方约定就是挂在 `shell.overlay` 条目里
  （参考 `ui-workspace/src/client/session-actions/RowActionToast.tsx:5,20-76`）。
- 结论：回收站面板与结果提示优先走 `shell.overlay` + 可选注入；`slots` 不可用时退回本仓库现有的
  `.sd-dlg-host` 自有 React 浮层（§7.2 两条路径都保留）。

---

## 3. 磁盘布局与数据契约

### 3.1 目录布局

```text
<DSH_HOME>/session-purge/
  pending.json            # 沿用：重启后待处理（语义改为「重启后移入回收站」）
  settings.json           # 新增：回收站设置
  trash/
    .state.json           # 新增：{ schema, lastSweepAt, lastSweepRemoved }
    .lock                 # 新增：跨进程串行锁（O_EXCL + 陈旧检测，可选）
    t-20261014T034100-a1b2c3/     # 条目载荷：原会话目录，原样 rename 进来
      session.v4.jsonl.zstd
      session.lock
    t-20261014T034100-a1b2c3.json # 条目元数据（与载荷目录同名）
```

**为什么载荷目录名不直接用会话 id**：目录名由插件自己生成（`t-<UTC 时间戳>-<6 位随机>`），
既避免重实现上游 `encodeSegment()`/`projectKey()`（改版风险），也天然幂等、无碰撞。
会话 id 只出现在元数据里。

**为什么不能放进 `sessions/` 内部**：持久层把 `sessions/` 下每个目录当项目目录、每个子目录当会话目录扫描
（§2.5），放进去会被当成正常会话列出来。

### 3.2 条目元数据 `<trashId>.json`

```json
{
  "schema": 1,
  "id": "session-a22fa2ed-d0aa-4797-b4c6-38a90d65f2e6",
  "title": "重构回收站",              // 可为 null（宿主读不到标题）
  "cwd": "D:\\deepseek-harness\\dsh-session-purge",  // 可为 null（_no-cwd）
  "originalDir": "<DSH_HOME>/sessions/--D-deepseek-harness-dsh-session-purge--/session-a22f...",
  "sessionsRoot": "<DSH_HOME>/sessions",
  "deletedAt": "2026-10-14T03:41:00.000Z",
  "sizeBytes": 13012345,
  "wasArchived": false,
  "status": "trashed",                // "moving" | "trashed"
  "trashedBy": "dsh-session-purge"
}
```

- `originalDir` + `sessionsRoot` 让复原**不需要**重新实现上游路径编码：直接 `rename` 回原路径。
- 复原前额外校验：`originalDir` 必须位于 `sessionsRoot` 之内（`path.relative` 不以 `..` 开头），
  且载荷目录里存在规范日志文件名（复用 `LOG_FILENAME_RE`）。
- `status` 用于崩溃恢复（§4.4）。

### 3.3 设置 `settings.json`

```json
{ "schema": 1, "autoClean": true, "retentionDays": 30, "sweepOnBoot": true, "sweepIntervalHours": 6 }
```

- 读写规则：缺失/损坏 → 回退默认值，并把坏文件改名为 `settings.json.bak`；写入用 `tmp + rename` 原子替换。
- 归一化（写入与读取都做）：`retentionDays ∈ {0,7,30,90,365}`（0 = 永久）；
  `sweepIntervalHours ∈ [1,168]` 整数；布尔字段强转；未知字段丢弃。

---

## 4. 宿主算法

### 4.1 移入回收站 `trashSession(ctx, sessionId, hints)`

```text
1. 校验 validSessionId；读取设置（用于弹窗策略提示，可选）
2. 幂等短路：遍历条目元数据，若已有同 id 且 status=trashed → 返回 { ok, mode:'already' }
3. 驻留检查（沿用现逻辑）：
   - 非驻留 → 直接进入 4
   - 驻留 → tearDownResident()：严格 idle 才拆；live/busy 拒绝；内部面缺失 → 写入 pending.json 返回 { mode:'queued' }
4. 定位目录并证明（复用 removeSessionLog 的前半段）：
   persistence.list() → findSessionSnapshot → persistence.locate(header)
   → sessionDirectoryFromLogPath(location.path)，失败 = 'unsupported'/'unknown'/'storage'
   同时取到 sessionsRoot = dirname(dirname(dirname(logPath)))，projectKey = basename(dirname(dir))
5. 预留条目：
   - trashId = `t-${UTC yyyyMMddTHHmmss}-${6 hex}`
   - 先写 `<trashId>.json`（status:'moving'，含全部字段）→ 原子改名生效
6. 移动：rename(sessionDir → trash/<trashId>)；跨卷 EXDEV → 递归复制到 `<trashId>.partial` 再 rm 源、改名
7. 收尾：重写元数据 status:'trashed'，sizeBytes 用移动前统计值
8. 归档标记：wasArchived = workspaceRegistry.archivedSessionIds.includes(id)（步骤 5 时读）
   → unarchiveSession(id)（清掉任何指向该会话的脏标记；失败只记日志）
9. 返回 { ok:true, mode:'trashed', trashId, name: title ?? null }
```

- **顺序**保证不变量 I1：第 5 步先落元数据，第 6 步才动原目录；第 6 步失败时删掉预留元数据、原目录不动。
- 复用现有 `tearDownResident()`（含 jobs 闸门、scope dispose、registry detach）与 3 次重试的 `rm`/rename 抗占用逻辑。
- 标题来源：客户端在菜单点击时从 DOM 行捕获（现有能力），随请求体 `title` 传入；宿主不信任它做路径用途。

### 4.2 复原 `restoreSession(ctx, sessionId)`

```text
1. 找到条目（status='trashed'）；不存在 → 'unknown'
2. 校验载荷目录存在且含规范日志文件 → 否则 'unsupported'
3. 目标 = meta.originalDir
   - 目标必须位于 meta.sessionsRoot 之内，否则 'unsupported'
   - 目标已存在（非空）→ 'conflict'
4. rename(trash/<trashId> → 目标)；EXDEV → 复制 + 校验 + 删源
5. 删除 `<trashId>.json`
6. 归属与归档一致性（best effort，任何一步失败都只记日志、不影响复原结论）：
   - `workspaceRegistry.resolveByPath(cwd)` 找到工作区实体 → `attachSession(id)`
     （把重启后被剪掉的 `sessionIds` 槽位补回来，避免会话落进 Ungrouped）；
   - `unarchiveSession(id)`（幂等兜底）→ `wasArchived` 为真再 `archiveSession(id)`。
7. 返回 { ok:true, restoredTo, wasArchived, cwdMissing: !existsSync(meta.cwd) }
```

- `cwdMissing` 同时覆盖两种“显示不出来”的情况：原始 cwd 目录已不存在，或会话本来就没有 cwd
  （`_no-cwd`）。后者更隐蔽——上游的列表投影**完全丢弃**没有 cwd 的冷会话
  （`api/session-controller/src/list.ts:144`：只有 `record.header.cwd !== undefined` 才进列表），
  所以这类会话复原后本来就不会出现在侧边栏里，面板必须把话说清楚。

- 客户端据 `cwdMissing` 决定是否显示"原始目录已不存在"的警告文案。

### 4.3 真实删除 `purgeEntry()` / 清空 `emptyTrash()`

```text
purgeEntry(trashId):
  1. 条目必须存在，且 trashId 匹配 /^t-\d{8}T\d{6}-[0-9a-f]{6}$/
  2. 载荷目录 realpath 后必须严格位于 trashRoot 之内（防符号链接逃逸）
  3. rm -rf 载荷目录，再删元数据（顺序：先删载荷，后删元数据 → 崩溃后留下"孤儿元数据"，sweep 会清理）
  4. best-effort 删掉投影缓存文档 <DSH_HOME>/storages/session_projcache/sessions/<id>.json：
     它是可重建缓存、按 id 单记录存放、读取时做生命周期身份匹配，删掉不会影响任何重建路径；
     不删的话永久删除会留下一份永不匹配的小文件
emptyTrash(): 逐条 purgeEntry，聚合结果 { removed, failed }
              ok:true 只表示请求跑完；客户端必须按 failed[].trashId 保留没删掉的条目
              （整表置空会让失败条目隐身到下次重开面板）
```

### 4.4 崩溃恢复（启动时，`processPendingQueue` 之后）

```text
遍历 trash/*.json：
  status='moving' 且载荷目录存在        → 补写 status='trashed'（补全 sizeBytes）
  ↑ 若原目录也还在（跨卷「已发布、未删源」窗口）→ 同样定稿，但源目录**不删**（不替用户删数据），
    日志点名两条路径；此后该会话 restore 答 conflict、trash 答 duplicate，去路由见 spec.md §13
  status='moving' 且载荷不存在、原目录仍在 → 从原目录重新移动
  status='moving' 且两者都不存在         → 删除元数据（记账一条 warn）
载荷目录存在但无同名 .json（孤儿载荷）    → 留在原地并记 warn（M1 不尝试重建）
`<trashId>.partial` 暂存目录（无元数据）  → 点名 warn（只提示，不删）；复制/校验失败时由
                                          moveDirectory 当场清掉，崩溃留下的由重试路径先 rm 再复制
```

**为什么孤儿载荷不重建**：要从日志里读回 id/cwd 就得解压 zstd 并解析 header，而猜错就意味着
把一个会话复原到错误的工作区（甚至触发上游的整表校验错误）。留在原地是安全且可人工处理的；
`recoverTrash()` 只会在日志里点名它，不会删。

### 4.5 清理 `sweepTrash(ctx, { now, reason })`

```text
1. 读设置：autoClean=false → 返回 { skipped:'disabled' }
2. 取串行队列（与 trash/restore/purge 共用一把进程内互斥；跨进程可选 .lock）
3. 逐条判断：retentionDays > 0 且 now - deletedAt >= retentionDays * 86400e3 → purgeEntry
4. 写回 .state.json：{ lastSweepAt: now, lastSweepRemoved: n }
5. 汇总日志：'[session-purge] sweep(%s): removed %d/%d expired'
```

**调度**：一次 15 分钟的 `setInterval` 心跳 + "到期判断"（`now - lastSweepAt >= sweepIntervalHours`），
避免改设置时重挂定时器；`sweepOnBoot` 时启动即刻跑一次。定时器用 `ctx.effect()` 挂载，随插件 fiber 释放。

### 4.6 并发与锁

- 进程内：一个 promise 链（`operationTail`，与现有 `enqueueOperation` 手法一致）串行化
  trash / restore / purge / empty / sweep。
- 跨进程（同一 home 起两个 `dsh web`）：`trash/.lock` 以 `wx` 创建，内含 `{pid, at}`；
  60 秒未刷新或 pid 不存在视为陈旧可抢占；拿不到锁时 sweep 跳过本轮、用户操作返回 `busy`。
  本期实现"尽力而为"，不追求强一致（spec.md §7 已声明）。

---

## 5. 路由契约

| 方法 | 路径 | 请求体 | 成功响应 | 说明 |
|---|---|---|---|---|
| GET | `/session-purge/trash` | — | `{ ok, version, entries[], totalBytes, settings, lastSweepAt, lastSweepRemoved }` | 面板数据源 |
| POST | `/session-purge/trash` | `{ sessionId, title? }` | `{ ok, mode:'trashed'\|'queued'\|'already', trashId?, name? }` | 移入回收站；条目已存在但源目录还在 → `{ok:false, code:'duplicate'}` |
| POST | `/session-purge/restore` | `{ sessionId }` | `{ ok, restoredTo, wasArchived, cwdMissing }` | 复原 |
| POST | `/session-purge/purge` | `{ sessionId }` | `{ ok, freedBytes }` | 真实删除单条 |
| POST | `/session-purge/empty` | `{ confirm: true }` | `{ ok, removed, failed, freedBytes }` | 清空；`ok:true` 只表示请求跑完，客户端必须按 `failed[].trashId` 保留未删掉的条目 |
| POST | `/session-purge/sweep` | — | `{ ok, removed, skipped? }` | 立即清理 |
| GET | `/session-purge/settings` | — | `{ ok, version, settings, stats }` | 设置页读；失败响应也带 `version` |
| POST | `/session-purge/settings` | 局部 patch | `{ ok, settings }` | 设置页写 |
| GET | `/session-purge/state` | — | 现有结构 + `trash:{count,totalBytes,lastSweepAt,lastSweepRemoved}` + `settings` | 诊断；`entryInjected`（侧边栏注入是否成功）仍未上报（spec.md §13 已知边界） |
| POST | `/session-purge/undo` | `{ sessionId }` | `{ ok }` | 现有：取消重启队列 |
| POST | `/session-purge/delete` | `{ sessionId }` | 同 `/trash` | **兼容别名**（老客户端缓存），语义已变为软删除 |

- 全部路由沿用 `sameOrigin()` 校验与 `readJsonBody()`（8 KiB 上限）；方法不匹配 → 405 + `allow`。
- 请求体超限不再断连：停止缓冲、排空到 `end` 后以 `code:'too-large'` 拒绝并答 **413**（8 KiB 上限是同源本地面板的天花板，排空成本可忽略；先 `destroy()` 会让客户端只看到 ECONNRESET）。
- 状态码：成功 200；策略性拒绝 409（`live`/`busy`/`conflict`/`unknown`/`unsupported`/`invalid`/`duplicate`）；
  存储故障 503（`storage`/`rm`）；请求格式 400（`bad-request`），请求体超限 413（`too-large`）。
  settings 路由的解析失败与读写失败分开报：前者 400/413，后者才 503。
- 错误体统一 `{ ok:false, code, error? }`。

## 6. 安全校验清单

- S1 会话 id：`validSessionId()`（非空、无 `/`、无 `\`）。
- S2 只移动**能证明身份**的目录：日志文件名必须匹配 `^session(\.v\d+)?\.jsonl(\.zstd)?$`，
  且父目录不是根/自身（复用 `sessionDirectoryFromLogPath()`）。
- S3 目的地必须在 `meta.sessionsRoot` 之内（`path.relative(root, dest)` 非 `..` 开头、非绝对）。
- S4 真实删除目标 realpath 后必须严格位于 `trashRoot` 之内。
- S5 trashId 形状校验后再拼路径。
- S6 不跟随符号链接（`lstat`/`realpath` 检查），遇到符号链接一律拒绝。
- S7 所有写盘操作走 `tmp + rename`，不留半截文件。

## 7. 客户端实现要点

### 7.1 侧边栏入口 `installSidebarTrashEntry()`

```text
锚点解析（每次 DOM 变化后重跑，幂等）：
  1. 在 document 中查找 aria-label ∈ {添加工作区, Add workspace} 的 button（排除 [role=menu] 内的）
  2. 找不到 → 查找 aria-label ∈ {视图选项, View options}
  3. 都找不到 → 不注入，内存里记 entryInjected=false（由 /session-purge/state 上报）
  4. 已有 [data-sd-trash-slot] 且其锚点仍在文档中 → 直接返回

构建（两段式，视觉与行为都对齐上游）：
  1. 读锚点 button 的运行期 className（CSS Module 哈希名，运行期可取）与集群元素
  2. 在锚点之后插入自建容器 <span data-sd-trash-slot>，用 createRoot 渲染：
       <Tooltip label={tr('sidebar.trash' | 'sidebar.trashWithCount')} side="bottom" delayMs={500}>
         <button type="button" className={anchorClassName} aria-label={tr('sidebar.trash')}
                 aria-haspopup="dialog" onClick={openTrashPanel}>
           <IconTrashOutlineRegular size={wide ? 16 : 18} />
         </button>
       </Tooltip>
     —— Tooltip / IconTrashOutlineRegular 都来自 `require('@deepseek-ai/dsh-client-ui-primitives')`
     （`ui-primitives/src/icons/index.tsx:570-587` 与上游三图标同族、同 stroke 规格）
  3. 覆写集群宽度上限：cluster.style.maxWidth = 'none'（保存原值，卸载时还原）——否则会被裁掉
  4. 条目数 N 缓存在内存：打开面板后、每次操作后、以及面板打开期间刷新一次
```

**降级**：`require('@deepseek-ai/dsh-client-ui-primitives')` 抛错时，退化为"克隆锚点 button 的 DOM +
原生 `title` 提示"（现有 `client.js` 的手法是同一套），功能不变、提示样式退化。

**生命周期**：`MutationObserver` 监视 `document.body`（与现有菜单注入并列一个，不新增热点判断），
在 `ctx.effect()` 的 disposer 里卸载 React 根、移除容器、还原 `maxWidth`、断开 observer。

### 7.2 回收站面板 `TrashPanel`

M2 落地的形态（与最初设想的差别写在后面）：

- **挂载**：`installTrashPanelMount()` 建一个 `.sd-bin-host` 容器 + 自有 React 根，渲染
  `TrashPanelHost`；`TrashPanelHost` 在 `binStore.open !== true` 时返回 `null`。宿主唯一性由
  `ensureTrashPanelRoot()` 保证（热重载留下的旧宿主会被清掉）。
- **视觉**：`primitive("Modal")` 可用时用它承载（`{ open, onClose, title, closeLabel }`）——遮罩、
  portal、`useModalLayer` 焦点层、Escape 与遮罩点击关闭全部由原语提供，"不切换页面"因此天然成立；
  不可用时用 `.sd-bin-card` + `.sd-bin-mask` 自绘同一表面（探针 `trash-panel-probe.mjs` 覆盖这条）。
- **内容**：`TrashPanelBody` 一个组件覆盖 加载/空/列表/失败 四种主体状态 + 提示/错误 + 内联二次确认
  + 底栏（统计 · 策略 · 清空）。>50 条时给出「加载更多」（`BIN_PAGE_SIZE`）。
- **二次确认**：面板内的永久删除与清空都用**内联确认条**（`.sd-bin-confirm`），不叠第二层模态框；
  行内错误（如 `conflict`）留在行上，失败不清行。
- **行为**：打开即 `GET /session-purge/trash`；操作后局部更新（不整表重拉）；复原成功后调用
  `ctx.sessions.refresh()`（`api/session-controller/src/client/contract/sessions.ts:105-109`）重新基线化
  宿主权威列表；`refresh` 不存在时改为提示刷新页面。
- 与设置页联动：设置页的「打开回收站」切换同一个 `binStore.open`（M3 接线）。

**与最初设计的偏离（有意）**：面板没有注册进 `shell.overlay`，而是用自有根。理由是面板必须与
"侧边栏图标是否找到锚点"解耦、并在无 `slots` 服务的旧代上照样可用；`Modal` 原语已经提供了
overlay 座位能提供的全部交互保证。`shell.overlay` 版本保留为后续可选增强。

**宽度（用户反馈后调整）**：上游 `Modal` 的卡片是 `width: min(380px, 100%)`
（`ui-primitives/src/Modal.module.css` 的 `.dialog`），会话列表挤成一条细缝。面板通过
`Modal` 的 `className` 传 `sd-bin-modal`，用**同名双写选择器** `.sd-bin-modal.sd-bin-modal{width:min(760px,100%)}`
覆盖：双写把特异性提到 (0,2,0)，从而不依赖"我们的 `<style>` 在上游 CSS 之后"这一顺序假设。
自绘降级路径的 `.sd-bin-card` 同步为 760px。两条路径都在探针里断言了
"卡片 ≥ 700px、标题列 ≥ 500px"，避免以后再退回窄卡。

### 7.3 会话行菜单与确认弹窗

- `DICTS` 已按 spec §8 全量替换；`menu.deleteSession` → `menu.trashSession`。
- `injectMenuItem()` 文案改「移入回收站」、配色从 danger 红改为 warn 琥珀
  （`--dsw-alias-state-warn-primary`），键帽清理逻辑不动。
- 确认弹窗更名为 `TrashConfirmDialog`：请求体 `{ sessionId, title }` 打 `/session-purge/trash`；
  确认按钮改为中性 `sd-dlg-btn-primary`（动作可逆）；策略行来自 `/trash` 返回的 settings；
  成功即关弹窗、改由顶部 toast 报告（带「打开回收站」动作），并在成功后
  `sessions.refresh()` + 刷新面板计数。
- 终态的归属：成功 = toast（无决策，不值得一次点击）；排队 / 定位失败 / 出错 = 留在弹窗
  （需要用户阅读并决策），配色琥珀，不再使用危险红。
- 0.5.5 之后**复原也复用同一个 toast 通道**（`showToast()`，`showTrashToast()` 成为它的薄封装）：
  面板内不再写 `bin.restored` 的 notice——同一件事只留一个报告点；`cwdMissing` 与「刷新后可见」
  这类补充信息并入 toast 文案，由纯函数 `restoreNoticeText()` 组装，单测钉住。
  面板 notice 此后只服务清扫结果、清空部分失败与设置入口提示。
- **已同步更新** `tools/helpers.test.mjs` 的菜单 fixture 与文案断言（DEVELOPING.md 的硬规矩）。

### 7.4 设置页注册设计（M3 草稿）

```js
// 注意：'slots' 不进 exports.inject（硬激活闸门），走可选注入
ctx.inject(['slots'], (scope) => {
  scope.slots.inject('settings.section', () => scope.slots.register({
    name: 'settings.section',
    id: 'session-purge',
    order: 50,                              // 内置项 -10/0/10/15/20，社区惯例 40（dsh-nord），取 50
    label: () => tr('settings.section'),   // thunk：语言切换自动跟随，不需要重新注册
  }, SettingsSection))
})
```

### 7.4 设置页实现（M3，已落地）

```js
// 注意：'slots' 不进 exports.inject（硬激活闸门），走可选注入
ctx.inject(['slots'], (scope) => {
  scope.slots.inject('settings.section', () => scope.slots.register({
    name: 'settings.section',
    id: 'session-purge',
    order: 50,                              // 内置项 -10/0/10/15/20，社区惯例 40（dsh-nord），取 50
    label: () => tr('settings.section'),   // thunk：语言切换自动跟随，不需要重新注册
  }, SettingsSection))
})
```

实际落地的细节（与最初设想一致的部分不再重复）：

- **控件**：primitives `Switch`（`{checked,onChange,label,disabled,title}`）、`SegmentedControl`
  （`{id,value,options,onChange,label,disabled}`，值必须是字符串，转回数字再写）、`Input`
  （`forwardRef` + 原生属性透传，用 `type=number` + `defaultValue` + `key` 让宿主值回弹）。
  三个原语都缺失时用同语义的自绘控件（`.sd-set-switch`/`.sd-set-segment`/`.sd-set-number`）。
- **写入**：每个控件只写自己那一个字段（`POST /session-purge/settings` 的局部 patch），
  成功后用**宿主返回的 settings** 覆盖本地副本（夹取/校验因此可见），并同步 `binStore.settings`，
  让面板底部的策略行立刻跟着变；失败时保留上一层已知良好值并给出 `settings.saveFailed`。
- **锁定**：`autoClean` 关闭时，`sweepOnBoot` 与 `sweepIntervalHours` 一起置灰（附原因 tooltip）；
  任何写入进行中时全部控件锁定，避免并发 patch 互相覆盖。
- **统计**：`GET /session-purge/settings` 同时返回 `stats`（条目数、占用、最近清理时间），
  最近清理时间用相对时间，从未清理显示「从未」。
- **两个动作**：「立即清理」打 `/sweep`（`autoClean` 关闭或保留期为永久时禁用）并显示结果；
  「打开回收站」先 `close()` 再开面板。
- **面板 → 设置**：面板底部的策略行现在是一个按钮，点击后按 shell 自己启动按钮的
  `aria-label`（设置 / Settings）找到并点击它——上游没有"打开设置面板"的公开 API；
  找不到时退化为一句提示，不做死点击。
- **导航图标**：上游 `settings.section` 的注册参数只有 `id`/`order`/`label`，`navIcon()` 按 id 查表、未知 id 回退齿轮
  （`ui-settings-general/src/client/SettingsRoot.tsx:31-39`）。插件保留 `id: session-purge`，在
  `[role="dialog"] nav button` 中按本地化 label 找到自己的行并打上 `data-sd-settings-nav="trash"`，CSS 隐藏
  shell 的 `<svg>` 并用 mask 画出 `IconTrashOutlineRegular` 同几何的垃圾桶（Medium 权重 1px stroke、
  `currentColor`，与设置导航其他图标一致）。标记只加属性、不插节点，React
  仍完全拥有自己的子树；MutationObserver 用 150 ms 合并重建，`childList` 观察（不观察 `characterData`，
  避免流式输出时抖动）。
- **页脚**：`GET /session-purge/settings` 与 `/trash` 都带 `version`（宿主启动时从 `../package.json` 读一次），
  浏览器半从先到者记住；设置页底部渲染 `.sd-set-about`（`border-top` 分隔线 + 「版本 x.y.z」）。
- **更新提示**：设置页挂载后做一次 npm registry 检查（`GET https://registry.npmjs.org/dsh-session-purge/latest`，
  5 s `AbortController` 超时）。只在 `document` 存在时发起，所以无 DOM 的单测不触网；失败/离线/CSP 阻断时
  静默，只留版本行。版本比较是内置的小 semver 解析（`compareVersions`），registry 返回不可解析的值时
  不产生提示。npm 已有更新时那行是链接，指向包主页。
- `package.json` **不需要**追加 `dsh.client.inject`：bundle 只用 seed 词，槽位就绪由
  `ctx.slots.inject` 保证（§2.8、§2.9）。
- 上游没有 `settings.section`（0.1.5）时注册不生效但**不报错**；此时设置只能通过
  `GET/POST /session-purge/settings` 访问（降级路径，写进 README）。

### 7.5 入口形态：图标 / 菜单（`entryPlacement`）

**需求**：让用户选「工作区行的小图标 + 弹窗」还是「和插件 / 自动化任务并列的一行 + 整页」。
前半句是既有实现（§7.1），这一节只讨论后者为什么必须同时是**页面**。

**上游契约（0.2.1-rc.5 源码核对）**

- 那列导航叫 `sidebar.panellist`（`packages/client/ui-sidebar/src/client/contract/slots.ts:36`），
  注册参数只有 `id` / `order` / `label`；行按钮、hover、tooltip、选中态全部由上游拥有。
  上游把每一行渲染成「glyph + （`wide` 时）文字」，所以折叠成 56px 轨道后**只剩图标**，这不是我们能改的。
- **一行 = 一个主面板**。`PanelRow` 的 `onClick` 直接 `layout.selectPanel(id)`，而
  `ui-layout` 的实现是 `if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(...)`。
  也就是说「只注册导航项、点击仍开我们的弹窗」这条路**第一步就抛错**，不存在「零成本换位置」的写法。
- `main` 是 `keyed` 槽位，`entryKey = activePanelId ?? "conversation"`，所以页面必须用**同一个 id**
  注册成 `main` 的一个 key。
- `order`：内置 `plugins = 0`、`schedules = 10`；我们取 `20`，落在「自动化任务」之后、「更多」之前。
- `label` 是 thunk，但 `ui-sidebar` 的 `syncPanels` 只在 locale / slot 变更时重读，**条目数变化不会触发**。
  想在行上显示「回收站（N）」就得每次计数变化重新注册一次 → 整列重建、`更多` 菜单跟着抖。
  第一版因此只显示静态「回收站」，计数仍在图标形态的 tooltip 里（§13 记为已知取舍）。

**三种可行路线与取舍**

| 路线 | 做法 | 结论 |
|---|---|---|
| A 官方槽位 + 真页面 | `sidebar.panellist` + 同 id 的 `main` 页 | **采用**：零 DOM 猜测，选中态/折叠/无障碍全由上游给 |
| B 官方槽位 + 桥接页抢帧 | `main` 页在 `useLayoutEffect` 里开弹窗再 `selectPanel(null)` | 否：拿框架时序做技巧，上游改过渡就闪一下 |
| C 在 `nav` 里 DOM 插一行 | 克隆现有 `panelRow` 的哈希 class | 否：要处理展开/折叠/重排，且拿不到 pin / 更多 |

**实现**

- `installEntryPlacement()`（`client/client.js`）按 `settings.entryPlacement` 挂**一种且仅一种**入口：
  - **首帧等设置**：`settings` 还没到时不装任何东西，否则菜单用户每次刷新都会先闪一下图标；
    设置请求失败（或老 shell 没有该路由）→ 退回图标。
  - 装菜单前先确认 `ctx.get("slots")` 存在，装图标前先 `releasePage()`：只有当前选中的正是
    `session-purge-trash` 时才 `selectPanel(null)`，绝不把用户从「插件」页踢出去。
- `installMenuEntry()` 注册两格：
  `sidebar.panellist`（`id = session-purge-trash`, `order = 20`, `label = () => tr("sidebar.trash")`）
  与 `main`（`key = session-purge-trash`）。两者用同一个常量，因为 id/key 一旦不一致，
  `selectPanel` 就会抛「not registered」。
- `TrashPage` 是页面外壳：标题行 + **复用 `TrashPanelBody`**。弹窗与页面因此共享同一个 store、
  同一套加载/空态/分页/确认条/错误文案，不存在第二份实现。
- `openTrashPanel()` 成为唯一入口：菜单形态先 `selectPanel(TRASH_PANEL_ID)`，**抛错就回落弹窗**
  （面板页没注册成功时不会变成死路）；图标形态照旧开 `Modal`。toast 与设置页的「打开回收站」都走它，
  所以「从哪进都是同一种形态」，不需要用户记两套规则。
- 布局：`.sd-bin-page` 是 `height:100%` 的 flex 列，`.sd-bin-page-body` 把高度预算传给
  `.sd-bin-body`（同 §7.2 的理由），列表 `max-height` 在页面里解除；空态/加载态在页面里
  `flex:1` + 居中，避免一大片空白把文案顶在标题下面。
- 设置项 `entryPlacement`（`icon` 默认 / `menu`）走 `lib/index.js` 的
  `SETTINGS_DEFAULTS` → `normalizeSettings`（闭集，未知值回 icon）→ `validateSettingsPatch`
  （严格拒绝），与其余四个字段同一套读写路径；设置页用 `SegmentedControl`（无原语时用
  `.sd-set-segment` 兜底）呈现，改完立即重挂入口，不重启、不刷新。

**验证**：`tools/entry-placement-probe.mjs`（隔离 rc.5 实例，21 项断言）覆盖
「图标 → 设置页切菜单 → 导航行/顺序/选中态/整页/行宽/折叠轨道 → 复原 → 切回图标」；
纯逻辑（`placementOf`、`iconMarkup`、id 一致性）由 `tools/client-bin.test.mjs` 覆盖。

## 8. 测试计划

### 8.1 单元/回归（`node --test tools/*.test.mjs`）

| 用例组 | 覆盖 |
|---|---|
| 路径安全 | `pathInside()` 的 win32/posix 双风味；`validTrashId()`；`sessionDirectoryFromLogPath()` 回归不破 |
| 元数据 | 读写往返、缺字段、损坏 JSON、原子替换（临时文件不残留） |
| 设置 | 默认值、越界夹取、布尔强转、损坏回退 + `.bak`、未知字段丢弃 |
| 保留期 | `retentionDue()` 边界（恰好到期、retention=0、时钟回拨） |
| 复原目标 | `restoreDestination()`：正常、目标已存在、root 外、缺 cwd |
| 崩溃恢复 | `moving` × {载荷在/不在} × {原目录在/不在} 四种组合 |
| 客户端（`tools/client-bin.test.mjs`，41 例） | 锚点优先级与隐藏孪生；`formatBytes`/`formatRelativeTime`（中英）/`displayTitle`/`shortSessionId`；`isExpiringEntry` 跟随实时策略；`refreshBin` 的加载/失败/“已自动清理”提示；复原（成功/缺 cwd/冲突保持行）；永久删除与清空的二次确认与拒绝保持（含清空部分失败时只保留 `failed[]` 点名的行）；**设置页**：保留期选项、统计文案、`pickLabeledButton`、`refreshSettings`/`saveSetting`/`runSweepNow` 的写入与失败、注册参数（id/order/label）、页脚版本（成功与失败响应）、`compareVersions` 更新判断、npm 检查的成功/静默失败、导航行标记、无 `slots` 时不崩 |
| 渲染（`tools/dialog-render-probe.mjs`、`tools/trash-panel-probe.mjs`、`tools/settings-render-probe.mjs`） | 真实 React + 真实主题下：确认弹窗配色 + 确认后 toast（绿勾、action 可点、hold/淡出变量、明暗两套）；面板 7 种状态、明暗两套；**设置页**逐控件驱动（开关只写 autoClean、保留期写 90、周期写 12、越界回弹、清理报告、打开回收站、关掉自动清理后调度控件锁定、暗色可渲染、页脚分隔线 + 宿主版本 + 更新链接） |
| 现有回归 | `hasActiveJob`、`diskSessionReport`、`tearDownResident` 全套不得回归 |

### 8.2 端到端（新增 `tools/repro-trash.mjs`，对标 `repro-delete.mjs`）

用真实 `JsonlSessionPersistence` + 临时 `DSH_HOME` + 真实日志目录副本：

1. `list()` 含目标会话 → `trashSession()` → 原目录消失、`sessions/` 下无残留、`trash/` 出现条目
2. `persistence.list()` 不含该会话（证明"真的从磁盘上移走了"）
3. `restoreSession()` → 目录逐字节一致（递归比对文件名+内容哈希）→ `persistence.list()` 再次包含
4. `purgeEntry()` → 回收站与元数据都消失
5. 保留期清理：把 `deletedAt` 回拨 31 天 → `sweepTrash()` 删掉它；`autoClean=false` 时不动

### 8.3 渲染探针（真实 React + 真实主题 CSS）

- `tools/trash-panel-probe.mjs`：把面板的 7 种状态（关闭/空/列表/**60 条分页**/清扫提示/确认/失败）全部
  渲染出来，在**明暗两套主题**下读计算样式并断言（空态文案、未命名占位、过期提示、底栏统计与策略、
  危险按钮 = error token、暗色卡片颜色不同、**卡片 ≥ 700px 且标题列 ≥ 500px**、
  **一页 50 条 + 「加载更多」点开后 60 条**）。走的是**自绘降级路径**，正是旧代 shell 的表面。
- `tools/dialog-render-probe.mjs`：确认弹窗（中性确认）与确认后的成功 toast（绿勾 + action），按钮变体（中性确认、琥珀排队、危险红留给面板内删除）。
- 需要 DSH 源码树（`DSH_REPO`，默认 `D:\deepseek-harness`）。

### 8.4 隔离实例端到端（`tools/bin-live-probe.mjs`）

```powershell
pwsh -File tools/probe-setup.ps1                  # 复制 profile/sessions 到 .probe-home，link 本仓库
$env:DSH_HOME = '<repo>\.probe-home'
dsh --profile web --no-open --port 3081 --host 127.0.0.1
node tools/bin-live-probe.mjs "http://127.0.0.1:3081/?token=..."
```

45 个断言点，覆盖只有真 shell 才能证明的东西：图标注入一次且未被裁掉、面板打开不改变 URL、
Escape 可关、行菜单出现「移入回收站」且用 warn token、确认弹窗与中性按钮、
**移入后侧边栏行消失 / 复原后行回来（都不刷新页面）**、移入成功后弹窗关闭且 toast 报告
（toast 的「打开回收站」action 直接开面板）、**真实删除与清空的二次确认后宿主条目归零**，
以及设置腿：面板策略行进入设置页、导航项与四行控件（真 primitives）、**导航行的垃圾桶图标**
（标记属性 + shell 齿轮隐藏）、**页脚分隔线与宿主版本**、开关/保留期/周期**落库**
（在页面内 `fetch` 回读宿主状态）、关掉自动清理后调度控件锁定、「立即清理」报告结果、
「打开回收站」回到面板、无未捕获页面错误。截图落在 `%TEMP%\dsh-bin-live\`。

> 0.5.2 发布前跑过的是 40 项版本；45 项版本在 toast 改版后于隔离实例全绿（2026-10-25 补跑见下）。

**两条环境事实**（本次调研确认）：

- 当前 GUI（`http://127.0.0.1:3080`）跑的是 pnpm 全局安装的 DSH，与源码树 `D:\deepseek-harness` 不是同一份；
  在源码树里跑 `pnpm run dev:web` 的 watcher 不会影响 3080。手工验证一律用探针实例（3081 + 隔离 `DSH_HOME`）。
- 客户端插件热重载由 `dsh-client-hmr` 提供（轮询各包 stamp 过的 `lib/client.js`，`packages/client/hmr/README.md:12-70`）。
  本插件的浏览器入口是 `client/client.js`，**不保证**被轮询到 → 改完刷新页面（Ctrl+Shift+R）；
  宿主半 `lib/index.js` 改完必须重启 `dsh web`（沿用 DEVELOPING.md:21-22 的规矩）。

M2/M3 已走通：注入图标 → 面板（空）→ 行菜单移入 → 确认 → 行消失 → 面板列出 → 复原 → 行回来 →
面板策略行进入设置 → 设置页四项落库 → 立即清理 → 回到面板 → 真实删除 → 清空回收站 → 无页面错误。
发布前若要再加一轮，建议按 `spec.md` §13 的"已知边界"逐条补：运行中会话的拒绝、重启队列、
跨重启分组、英文界面。

### 8.5 探针运行的五个坑（都已踩过）

1. 行菜单 ⋯ 按钮在未悬停时 `visibility:hidden`：必须直接 `dispatchEvent(new MouseEvent('click'))`。
2. 会话标题可能重复（同一 home 里有多个同名行）：断言要用**计数**而不是"标题还在不在"。
3. 移入成功后弹窗已关闭、成功报告在 `.sd-toast` 里（带「打开回收站」action，且会自动淡出）：
   断言 `.sd-dlg` 还在是错的，点击 `.sd-toast-action` 即可开面板。
4. 复原后的提示文案里也含标题，"还在不在"要只看 `.sd-bin-row-title`。
5. 隔离 home 若没有可用凭据，进站就会被「开始使用 / Get started」登录门挡住：整页 mask 会让
   侧边栏图标的 `click` 一直超时（`mask intercepts pointer events`），而 §1 的 DOM 断言照样全绿。
   按 `Escape` 即可关掉（不动任何状态），`bin-live-probe.mjs` 已这么处理。

## 9. 兼容性与降级

| DSH 版本 | 侧边栏注入 | 面板 | 设置页 | 复原即时可见 |
|---|---|---|---|---|
| `0.2.1-rc.5`（主目标） | ✅ | ✅ | ✅ 账号菜单 → 设置（`settings.launcher` 被账号菜单占用） | ✅ `sessions.refresh()` |
| `0.2.1-rc.4` | ✅ | ✅ | ✅ 同上 | ✅ `sessions.refresh()` |
| `0.2.1-rc.2` / `rc.3` | ✅ | ✅ | ✅ 同上 | ✅ `sessions.refresh()` |
| `0.2.0-rc.2` | ✅ | ✅ | ✅ 侧边栏「设置」按钮 | ✅ `sessions.refresh()` |
| `0.1.7-rc.2` | ✅（同代 header） | ✅ | ✅ | 预期 ✅，**UNVERIFIED** |
| `0.1.5-rc.3` | ✅（同代 header 无按键帽） | ✅ | ❌ 无 `settings.section` → 只能走路由 | ❌ 提示刷新页面 |

表中 rc.2 / rc.4 / rc.5 为实机验证；**rc.3 未单独起实例**，它与相邻两版只差 tooltip 与日志输出
层面，故沿用同代结论（见 [compat-0.2.1-rc.4.md](../compat-0.2.1-rc.4.md)、
[compat-0.2.1-rc.5.md](../compat-0.2.1-rc.5.md)）。

降级原则：任何一处上游面缺失都只让**该功能**降级，不影响其它功能；所有降级都要在 `/session-purge/state`
与启动日志里可诊断。

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| aria-label 锚点随上游改版失效 | 侧边栏入口消失 | 双锚点 + fixture 测试 + `/state` 上报 + 上游 slot 提案（§2.1） |
| `.headerActions` 的 60px 上限/上游布局变化 | 第 4 个图标被裁掉或换行 | 注入时覆写 `maxWidth`；探针跑 3 种侧边栏宽度与中英两种语言；失败降级为不注入 |
| 克隆/注入节点脱离 React 树 | 交互或提示异常 | 改为自建 React 根 + 运行期复用锚点 className + primitives `Tooltip`，不再依赖 clone 的行为 |
| 跨卷（会话根不在 home 同卷） | rename 失败 | EXDEV 回退到复制 + 校验 + 删源；`.partial` 标记保证可重入 |
| `sessions.refresh()` 在 sqlite 索引引擎下不立即反映 | 复原后行不出现 | M1 探针实测；必要时面板给出"刷新页面"提示（已有文案） |
| 两实例并发操作同一 home | 条目状态竞争 | 进程内串行 + `.lock`；拿不到锁降级为 `busy` |
| 回收站无限增长 | 磁盘占用 | 默认 30 天自动清理；设置页显示用量 |
| 复原时 cwd 目录已删除 | 行不显示 | 允许复原 + 明确警告文案 |
| 大目录跨卷复制很慢 | 面板长时间 busy | 行级 busy + `处理中…`；同一时刻只允许一个复原任务 |
| 上游改成把回收站目录也当项目扫描（未来把 trash 放在 sessions 下） | —— | 设计上固定在 `sessions/` 之外，不依赖命名约定 |

## 11. 改动文件清单

| 文件 | 改动 |
|---|---|
| `lib/index.js` | + 回收站内核（trash/restore/purge/empty/sweep/崩溃恢复）、设置读写、新路由、`pending` 语义、`/state` 扩展（M1 已落地，~+1150 行） |
| `client/client.js` | + 词典全量替换、primitives 可选加载、回收站 helpers/store/actions、侧边栏注入、面板（`TrashPanelHost`/`TrashPanelBody`）、`TrashConfirmDialog`、`__test` 导出扩展（M2 已落地，~+700 行） |
| `.github/workflows/ci.yml` | 回归步骤改为 `node --test tools/*.test.mjs`（覆盖两个新套件） |
| `tools/helpers.test.mjs` | 菜单 fixture 与文案断言同步到新词典；弹窗终态断言钉「成功离场改 toast、其余留弹窗」的契约 |
| `tools/trash.test.mjs` | 新增：宿主回收站 32 例（路径安全/元数据/设置/保留期/崩溃恢复/路由表/请求体超限/重启队列） |
| `tools/client-bin.test.mjs` | 新增并持续扩展：客户端 41 例（锚点/格式化/过期/面板 store 流程/设置页写入与注册/页脚版本/更新比较/导航行标记/清空部分失败/面板列表滚动的 CSS 契约） |
| `tools/repro-trash.mjs` | 新增：真实后端端到端（移入 → 复原逐字节 → 删除 → 清理） |
| `tools/trash-panel-probe.mjs` | 新增：面板渲染探针（7 状态 × 明暗两套） |
| `tools/settings-render-probe.mjs` | 新增：设置页渲染探针（自绘路径逐控件驱动，含页脚版本/更新链接） |
| `tools/bin-live-probe.mjs` | 新增：隔离实例端到端探针（现 45 个断言点，含设置腿、导航图标与页脚版本） |
| `tools/dialog-render-probe.mjs` / `dialog-probe.mjs` | 组件改名与新按钮变体同步 |
| `scripts/pack-report.mjs` / `tools/pack-report.test.mjs` | 新增：`npm pack --json` 两种形状（npm 10 及更早的对象、npm 11 起的数组）的解析与其 6 例回归——闸门 4 曾因只认对象形状，在发版当天抛 `SyntaxError` |
| `package.json` | **不新增依赖**（primitives 是平台 seed 词）；`dsh.client.inject` 保持不变；版本由发布脚本管理 |
| `README.md` / `README.en.md` | 已按回收站语义更新；版本由 npm badge（最新版）与 `CHANGELOG.md`（逐版变更）承担，文档不再写死当前版本 |
| `DEVELOPING.md` | 回收站模型、五条不变量、测试命令 |
| `docs/recycle-bin/spec.md`、`design.md` | 本次新增（功能定义与实现记录） |

## 12. 实施顺序（M1 → M4）

1. **M1** 先落 `lib/index.js` 内核 + 单测 + `repro-trash.mjs`（此时用 curl 就能验收宿主行为）。
2. **M2** 客户端：先改菜单/弹窗文案（复用现成测试），再做侧边栏注入，最后做面板。
3. **M3** 设置与清理：`settings.json` → 路由 → 设置页 → 启动/定时清理。
4. **M4** 打磨 + 文案表核对 + 文档 + `0.5.0` 发布（六道闸门）；之后 `0.5.1` 做 DSH 0.2.1 兼容修复，
   `0.5.2` 修发布/市场文档，`0.5.3` 发布设置页图标、版本页脚与更新提示，`0.5.4` 发布失败路径修复与
   成功提示改 toast。此后的版本记录见 `CHANGELOG.md`。
