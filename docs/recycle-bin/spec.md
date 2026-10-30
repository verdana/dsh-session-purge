# 会话回收站 — 产品功能规格（PRD）

| | |
|---|---|
| 状态 | 已交付（`0.5.x` 系列，M1–M4 全部完成）；逐版变更见 [CHANGELOG.md](../../CHANGELOG.md) |
| 归属插件 | `dsh-session-purge`（npm 包名不变，功能从「永久删除」升级为「回收站」） |
| 目标版本 | `0.5.x` 系列：`0.5.0` 把删除改为回收站；`0.5.1` 修 DSH 0.2.1 兼容；`0.5.2` 修正发布/市场文档；`0.5.3` 发布设置页图标、版本页脚与更新提示；`0.5.4` 发布失败路径修复与「移入回收站」成功提示改 toast；`0.5.5` 修回收站面板列表在 Modal 里滚不动；逐版记录见 CHANGELOG.md |
| 目标 DSH | 主目标 `0.2.1-rc.5`（`rc.2` – `rc.4` 为同代版本，契约面一致）；`0.2.0-rc.2` 同为实机验证基线；`0.1.7-rc.2` 尽力兼容；`0.1.5-rc.3` 仅保留降级路径 |
| 技术设计 | 见 [design.md](./design.md) |

---

## 0. 摘要与关键决策

把「删除会话」从**不可恢复的磁盘删除**改为**移入回收站**，并在侧边栏提供一个与现有三图标同风格的入口，
用弹窗列出所有已删除（暂存）的会话，支持**复原**与**真实删除**；同时新增设置页，提供自动清理开关、
保留时长与清理时机。

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 软删除取代硬删除：会话目录**原样移动**到回收站区，不删除、不改写 | 复原必须是位级忠实的；rename 同卷瞬时完成，大会话也不慢 |
| D2 | 回收站位于 `<DSH_HOME>/session-purge/trash/`，默认与 `sessions/` 同卷（都在 `DSH_HOME` 下） | 同卷才能 `rename`；且**不能**放在 `sessions/` 内部——持久层按目录扫描，放进去会被当成正常会话列出。会话根被配置到别处时跨卷，走复制回退（design.md §4.1/§10） |
| D3 | 侧边栏图标用 **DOM 注入**（需同时覆写上游 60px 宽度上限）；面板用上游 `Modal` 原语；设置页注册到上游 `settings.section` 槽位 | 上游 `sidebar.workspaces` 是 single 槽位、header 没有扩展点（见 design.md §2.1）；`settings.section` 是公开的 list 槽位，第三方插件（`dsh-nord`）已有先例 |
| D4 | 设置持久化到插件自有 `settings.json` + 自有 HTTP 路由，**不**走上游 `configForms` | 插件是零依赖发行，无法 `import` `@deepseek-ai/schemastery`（已实测不可解析）；`configForms` 需要导出一个 schemastery `Config` |
| D5 | 复原成功后由客户端调用 `ctx.sessions.refresh()` 让侧边栏立即出现该会话 | 上游客户端会话服务提供 `refresh()`，宿主侧 `listSessions` 每次重新扫描磁盘 |
| D6 | 不再用「归档」隐藏已删会话；移入时记下 `wasArchived` 并立即 `unarchiveSession()` 清标记，复原时按记录恢复归档态 | 现有实现删除后调 `archiveSession`：内存 header 索引里通常还留着该 id，于是**可能成功**，把一个已消失的会话永久留在 registry 全局归档集合里——以后复原它会被"隐藏已归档"挡住。详见 design.md §2.6 |
| D7 | 自动清理默认**开启**、保留 **30 天**、启动时 + 每 6 小时各扫一次 | 直接对应需求 4a/4b，且是"删了忘了"场景的默认安全网 |
| D8 | 回收站默认常开，不提供"直接永久删除"模式；危险动作全部二次确认 | 需求 4a 只要求自动清理开关；回收站本身是产品承诺 |

---

## 1. 背景与问题

`0.4.5` 的「删除会话」把整个会话目录 `rm -rf`：确认之后没有任何撤销路径。真实世界的三个痛点：

1. **误删**——列表里点错一行，几十轮对话和工具调用记录一起没了。
2. **删除的心理成本**——因为不可恢复，用户宁可让列表越堆越长，也不愿意删。
3. **清理磁盘**——真正常用的诉求是"清掉上个月那些试验会话"，而逐个确认删除又慢又危险。

回收站同时解决三者：删除变成低成本、可逆的动作；真正的磁盘回收交给**按时间自动清理**。

## 2. 目标与非目标

**目标**

- G1 会话行菜单提供「移入回收站」，可逆、带确认、可撤销反馈。
- G2 侧边栏「工作区」行三图标之后新增同风格回收站入口，点击**不切换页面**，弹窗列出全部已删除会话。
- G3 弹窗内每个条目可**复原**、可**真实删除**；支持**清空回收站**。
- G4 设置页提供：自动清理开关、保留时长、清理时机、回收站用量统计与「立即清理」。
- G5 全部文案中英双语，跟随 DSH 界面语言。
- G6 失败可见、可重试；任何失败都不得造成"会话被删了一半"的中间态。

**非目标（本期不做）**

- N1 不做"回收站视图页"（不占用侧边栏面板位，不改路由）。
- N2 不做消息级/轮次级撤销、不做版本历史。
- N3 不做跨机器同步、不做云端备份。
- N4 不做回收站容量上限与 LRU 淘汰（记入 §11 待办）。
- N5 不复活"回收站中的会话继续运行"——回收站里的会话一定是非运行的。

## 3. 术语

| 术语 | 含义 |
|---|---|
| 会话目录 | `sessions/<工作区目录键>/<会话 id 编码>/`，内含 `session.vN.jsonl[.zstd]` 与可能的 `session.lock` |
| 回收站条目 | 一条被移入回收站的会话：一个载荷目录 + 一个同名（`trashId`）的元数据文件 |
| 移入回收站（trash） | 把会话目录 `rename` 到回收站区，并从会话列表中移除 |
| 复原（restore） | 把回收站条目的数据目录 `rename` 回原工作区目录 |
| 真实删除（purge） | 物理删除回收站条目（目录 + 元数据），不可恢复 |
| 保留期 | 条目被删除时间起算的存活天数，默认 30 天 |
| 清理（sweep） | 按保留期对过期条目执行真实删除的一次批处理 |

## 4. 用户故事

- **US-1** 我误删了一个会话，希望立刻在回收站里找到它并复原，侧边栏马上恢复这一行，内容一字不差。
- **US-2** 我要腾磁盘，希望回收站里能一眼看到每个条目占多少，并支持"清空回收站"。
- **US-3** 我不想让回收站无限增长，希望默认 30 天后自动清掉，且能关掉这个开关。
- **US-4** 我保留期想设成 90 天 / 永久保留，并且希望改完立即生效，不用重启 `dsh web`。
- **US-5** 我删了一个正在后台跑的会话，希望它被明确拒绝并告诉我先停止，而不是删一半。
- **US-6** 中文界面上我希望所有新文案都是中文；切到英文时全部变英文。

## 5. 交互设计

### 5.1 侧边栏入口

- **位置**：左侧边栏「工作区」行（section header）里，紧跟在 `添加工作区` 图标**之后**；折叠态（rail）同样紧跟在 `添加工作区` 之后。搜索框展开时该行整体隐藏，回收站图标一并隐藏（与现有三图标行为一致）。
- **外观**：与现有图标按钮完全同款——复用锚点按钮的运行期 `className`（上游 CSS Module 哈希名），
  图标用上游同族的 `IconTrashOutlineRegular`（展开态 `size=16`，折叠态 `size=18`）、36px 命中区、
  同样的 hover/焦点态；提示复用上游 `Tooltip` 组件（bottom、`delayMs=500`），行为与三图标一致。
- **提示**：`Tooltip` 文案「回收站」；回收站非空时为「回收站（N）」。
- **宽度**：上游 header 动作集群有 `max-width:60px; overflow:hidden` 的硬上限（恰好容下现有两个图标），
  注入时必须覆写为不限制，否则第 4 个图标会被裁掉；卸载时还原。
- **不显示角标**（变体 B 见 §11）：保持与三图标完全同风格。
- **无障碍**：`aria-label="回收站"` / `"Recycle bin"`，键盘 `Tab` 可达、`Enter`/`Space` 打开，`aria-haspopup="dialog"`。
- **降级**：找不到锚点（上游改了 header 结构 / 没有 directory-flow occupant 时 `添加工作区` 不存在）时，退化为锚在 `视图选项` 图标之后；两个锚点都找不到则不注入，只在 `/session-purge/state` 里记 `entryInjected: false`，不报错、不阻塞其它功能。
- **重挂载**：侧边栏宽窄切换、工作区列表刷新都会重建 header，注入逻辑由一个 `MutationObserver` + 幂等标记（`data-sd-trash-slot`）保证"任何时刻最多一个"。

### 5.2 回收站面板（模态弹窗）

**触发与关闭**：侧边栏图标 / 设置页的「打开回收站」/ 删除成功提示里的「打开回收站」。`Esc`、点遮罩、右上角关闭按钮均可关闭。**不改变当前路由、不切换会话**；关闭后焦点回到触发按钮。
面板用上游 `Modal` 原语渲染（自带遮罩、portal、焦点层与 Escape），与应用内其它弹窗同款。

**布局（自上而下）**

0. **尺寸**：卡片宽 **760px**（上游 `Modal` 默认 380px 的两倍），窄屏退化为 `min(760px, 100%)`。
   会话标题占据主要宽度，只有真正超长的标题才以省略号收尾（此前 380px 的默认宽度会把标题挤成一条细缝）。

1. **标题栏**：垃圾桶图标 + 「回收站」+ 条目数徽标 + 关闭按钮。
2. **工具条**（P1）：搜索框「按标题或目录筛选」（>20 条时才显示）；排序固定为**删除时间倒序**（不提供切换，减少认知负担）。
3. **列表**：每行一条，行内两行文本 + 右侧操作。
   - 第一行：标题（缺失时显示 `未命名会话`）+ 工作区目录 basename。
   - 第二行：`删除于 3 天前`（`title` 属性给绝对时间 `2026-10-11 09:32`）、`12.4 MB`、短 id `session-a22f…`。
   - 右侧操作：`复原`（主按钮）、`真实删除`（危险按钮，图标按钮或文字按钮）。
   - 已过期（超过保留期为自动清理待处理）的行：时间行追加 `· 将在下次自动清理时删除`。
4. **底栏**：左侧 `共 N 个会话 · 占用 128.3 MB`；中间策略提示 `自动清理：保留 30 天 / 自动清理已关闭`（可点击跳设置页）；右侧 `清空回收站`（危险文本按钮）。
5. **空态**：居中垃圾桶线稿 + 「回收站是空的」+ 副文案「删除的会话会先放到这里，可在保留期内随时复原。」
6. **加载态**：首次打开显示 3 行骨架；操作中的行显示 `处理中…` 并禁用该行按钮。
7. **错误态**：面板级错误显示在底栏上方（可重试）；行级错误显示在该行下方。
8. **规模**：超过 50 条时分页（每页 50，`加载更多`）；不做虚拟滚动（简单可靠优先）。
9. **滚动**：列表是面板里**唯一的滚动区**——条目超过可用高度时在列表内部滚动，标题栏、内联确认行与底栏保持原位不随之移动；列表另带 `calc(100vh - 280px)` 的上限兜底，应付 `Modal` 没有把自己的卡片高度约束传给内容的宿主。几何断言由 `tools/trash-panel-probe.mjs` 承担（此前 body 是匿名 `div`，列表拿不到确定高度，超过一屏的条目被裁掉且滚不动）。

**交互细则**

- 复原成功：该行从列表移除并播放 120ms 高度收起；列表为空时切空态；**随即刷新侧边栏会话列表**（见 5.4）。
- 复原失败（目标已存在 / 存储错误）：行内红字 + `重试`。
- 真实删除（单条）：点行内 `真实删除` 后，**该行下方展开一条内联确认行**（不再叠一层弹窗）：
  文案 `永久删除「X」？不可恢复。`，右侧两个按钮 `取消` / **`确定`**——
  确认按钮只说"确定"，因为后果已经写在确认行里；再叫一次「真实删除」等于把刚点的按钮重复一遍。
- 清空回收站：同样用内联确认行，文案 `永久删除全部 N 个会话（共 128.3 MB）？不可恢复。`，
  按钮 `取消` / `确定`。
- 面板打开期间如果发生自动清理，列表静默刷新并出现一行提示 `已自动清理 2 个过期会话`。

### 5.3 「移入回收站」流程（会话行菜单）

- 菜单项：`移入回收站` / `Move to recycle bin`，插在 `归档会话`（或 `取消归档`）之后，**改为中性/警示色**（不再是危险红——动作可逆）；沿用现有 DOM 注入与键帽清理逻辑。
- 确认弹窗：「移入回收站」，正文 `将把「X」移入回收站，可随时复原。`，目录行，提示行 `回收站自动清理：保留 30 天（或"已关闭"）`；按钮 `取消` / `移入回收站`。
- 运行中的会话：沿用现有闸门——`live`（正在跑）与 `busy`（压缩/收尾中）**拒绝**并给出原因文案；无法安全释放时进"重启后移入回收站"队列。
- 成功：确认弹窗立即关闭，改由**顶部 toast** 报告 `已移入回收站「X」。`（`role=alert`，保持约 6 秒后淡出），toast 内附 `打开回收站` 动作。成功不需要用户再决策，不应为此多收一次点击；与宿主自身「归档 → toast 带撤销」的惯例一致。
- 队列态的文案：`该会话暂驻内存，已转为重启后移入回收站。`（队列态、无法定位与错误**留在弹窗内**——它们需要用户阅读并决策，几秒即逝的横幅承载不了。）

### 5.4 复原流程

1. 客户端 `POST /session-purge/restore { sessionId }`。
2. 宿主校验条目存在、数据目录完整（含规范日志文件名），把载荷 `rename` 回**记录的原始目录**（不重新推导路径——上游会校验路径与 header 是否自洽，放错会让整个会话列表报错）。
3. 归属与归档：按 `cwd` 找回工作区并 `attachSession`（补回可能已被剪掉的 `sessionIds` 槽位，避免落进 "Ungrouped"），再清理归档脏标记（`unarchiveSession`），`wasArchived = true` 的重新归档。任何一步失败只记日志，不影响复原结果。
4. 客户端成功后调用 `ctx.sessions.refresh()`（侧栏即时出现该行、无需刷新页面），并用**顶部 toast** 报告 `已复原「X」`（`role=alert`，约 6 秒后淡出）——与移入成功同一套报告方式，面板内不再重复同一句。若该服务没有 `refresh`（旧版本），toast 改报 `已复原，刷新页面（Ctrl+Shift+R）后可见`。
5. 边界：目标目录已存在 → `conflict`，行内提示 `该会话已存在，无法复原`；原始目录（cwd）已不存在、或该会话本来就没有 cwd → 允许复原，但提示 `原始目录已不存在，复原后可能不会显示在列表中`（没有 cwd 的会话上游列表投影根本不显示，属于同一种"复原成功但看不到"的情况）。

### 5.5 真实删除流程

- 单个：二次确认 → `POST /session-purge/purge` → 行移除。
- 清空：确认 → `POST /session-purge/empty { confirm: true }` → 列表清空、切空态、侧边栏无变化（不涉及会话列表）。
- 两个动作都不触碰 `sessions/` 下的任何目录（安全校验见 design.md §5）。

### 5.6 设置页

- **位置**：DSH 设置面板新增一个导航项「回收站」（`settings.section`，`order = 50`，排在通用/模型/插件等内置项之后）。面板为单一滚动列。导航项使用与侧边栏入口同族的**垃圾桶图标**；上游槽位没有图标参数，插件在 DOM 里标记自己的导航行，再用 CSS 替换 shell 为未知 id 生成的默认齿轮（见 design.md §7.4）。
- **页脚**：内容底部有一条分隔线，下面显示**当前运行中的宿主版本号**（读 `package.json`，不是浏览器包里的副本）；随后做一次尽力而为的 npm 更新检查，有新版本时给出提示与链接，离线/被阻断时只显示版本号，不报错。
- **内容**：

| 分组 | 控件 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| 自动清理 | 开关 | `autoClean` | 开 | 关闭后不再自动删除任何条目 |
| 自动清理 | 保留时长（分段选择） | `retentionDays` | 30 | `7 / 30 / 90 / 365 / 永久`；`永久` 记 `0` |
| 自动清理 | 启动时清理一次（开关） | `sweepOnBoot` | 开 | 依赖 `autoClean`；关闭时置灰 |
| 自动清理 | 清理周期（数字输入，小时） | `sweepIntervalHours` | 6 | 范围 1–168，整数；空/非法回退默认值 |
| 回收站 | 统计行 | — | — | `N 个会话 · 128.3 MB · 最近清理 2 小时前` |
| 回收站 | 按钮「立即清理」 | — | — | 立即执行一次按保留期清理，返回删除条数 |
| 回收站 | 按钮「打开回收站」 | — | — | 打开 5.2 的面板（`close()` 后打开） |

- **生效时机**：保存即写入 `settings.json`，宿主**每次读设置都重新读文件**（不做长缓存），因此下一次定时器/请求即生效；不需要重启 `dsh web`。
- **失败**：写入失败在控件下方显示红字错误并回滚控件显示到服务端真实值。
- **文案**：`回收站` / `Recycle bin`，全部子文案见 §8。

## 6. 数据模型（产品视角）

一个回收站条目对用户可见的字段：

| 字段 | 展示 | 来源 |
|---|---|---|
| 标题 | 第一行；缺失→`未命名会话` | 移入回收站时从会话行捕获（客户端传入）；宿主侧尽力从投影缓存补齐 |
| 工作区目录 | 第二行的 basename | 会话 header 的 `cwd` |
| 删除时间 | `删除于 3 天前` | 宿主在移入时写入 `deletedAt` |
| 大小 | `12.4 MB` | 移入时统计一次并落盘（不每次遍历目录） |
| 是否原为归档 | 不直接展示；复原后保持归档态 | 移入时记录 `wasArchived` |
| 过期 | 超过保留期时提示 | `deletedAt + retentionDays` 实时计算（保留期改了立即反映，不改写条目） |

## 7. 错误与边界（用户可见行为）

| 场景 | 行为 | 文案（zh） |
|---|---|---|
| 会话正在运行 | 拒绝，弹窗按钮置灰 | `会话正在运行——请先停止或等它完成，再移入回收站` |
| 会话在压缩/收尾 | 拒绝 | `会话正在后台整理（压缩/收尾），请稍等几秒再试` |
| 无法安全释放内存中的会话 | 排队，重启后处理 | `该会话暂驻内存，已转为重启后移入回收站。` |
| 找不到会话记录 | 拒绝 | `未找到该会话的记录（磁盘上可能已不存在）` |
| 日志目录无法证明 | 拒绝（安全优先） | `无法确认该会话的目录，已拒绝操作` |
| 重复移入同一会话 | 幂等成功 | `该会话已在回收站中` |
| 重复移入，且源目录仍在（跨卷窗口） | 拒绝，说明出路 | `回收站里已有该会话，但目录仍在磁盘上；请先复原或永久删除回收站中的那条` |
| 清空时个别条目删不掉（载荷异常） | 已删的消失，删不掉的**保留在列表里**并在行内标原因，另给一条汇总提示 | `有 {n} 个会话未能删除，已保留在列表中` |
| 复原时目标已存在 | 拒绝 | `该会话已存在，无法复原` |
| 复原时原始目录不存在 | 允许 + 警告 | `原始目录已不存在，复原后可能不会显示在列表中` |
| 跨卷（会话根不在同一卷） | 复制 + 删除回退，显示 `处理中…` | （无专门文案） |
| 文件被占用（Windows） | 自动重试 3 次，仍失败则报错 | `操作失败（文件可能被占用，请稍后重试）` |
| 磁盘/权限错误 | 报错，不产生半成品 | `存储服务暂时不可用，请稍后重试` |
| 回收站为空 | 面板空态 | `回收站是空的` |
| 设置写入失败 | 行内红字 + 回滚 | `设置保存失败，请重试` |

**不变量**

- I1 移入回收站失败时，`sessions/` 下的原目录必须**原封不动**（rename 原子性）。
- I2 复原失败时，回收站条目必须保持可用（不清元数据）。
- I3 任何真实删除只允许发生在回收站区内部，且目标必须是回收站条目目录（路径包含校验 + 规范日志文件名校验）。
- I4 回收站中的会话永远不会处于运行态。
- I5 自动清理绝不与用户操作并发地处理同一条目（串行队列）。

## 8. 文案（zh / en）

| key | zh | en |
|---|---|---|
| `menu.trashSession` | 移入回收站 | Move to recycle bin |
| `dialog.trash.title` | 移入回收站 | Move to recycle bin |
| `dialog.trash.target` | 将把「{name}」移入回收站，可随时复原。 | “{name}” will be moved to the recycle bin. You can restore it later. |
| `dialog.trash.policy` | 回收站自动清理：保留 {days} 天 | Auto-clean: keep for {days} days |
| `dialog.trash.policyOff` | 回收站自动清理：已关闭 | Auto-clean: off |
| `dialog.trash.done` | 已移入回收站「{name}」。 | Moved “{name}” to the recycle bin. |
| `dialog.trash.openBin` | 打开回收站 | Open recycle bin |
| `dialog.trash.queued` | 该会话暂驻内存，已转为重启后移入回收站。 | This session is resident in memory; it will move to the recycle bin on restart. |
| `bin.title` | 回收站 | Recycle bin |
| `bin.entryCount` | {n} 个会话 | {n} sessions |
| `bin.empty.title` | 回收站是空的 | The recycle bin is empty |
| `bin.empty.hint` | 删除的会话会先放到这里，可在保留期内随时复原。 | Deleted sessions land here and can be restored until the retention period ends. |
| `bin.untitled` | 未命名会话 | Untitled session |
| `bin.deletedAt` | 删除于 {when} | Deleted {when} |
| `bin.expiring` | 将在下次自动清理时删除 | Will be removed by the next auto-clean |
| `bin.restore` | 复原 | Restore |
| `bin.purge` | 真实删除 | Delete permanently |
| `bin.confirm` | 确定 | Confirm |
| `bin.restored` | 已复原「{name}」 | Restored “{name}” |
| `bin.restoreHint` | 已复原，刷新页面（Ctrl+Shift+R）后可见 | Restored — refresh the page (Ctrl+Shift+R) to see it |
| `bin.restoreConflict` | 该会话已存在，无法复原 | That session already exists and cannot be restored |
| `bin.restoreMissingCwd` | 原始目录已不存在，复原后可能不会显示在列表中 | The original folder no longer exists; the restored session may not appear in the list |
| `bin.purgeConfirm.title` | 永久删除会话 | Delete permanently |
| `bin.purgeConfirm.body` | 将永久删除「{name}」及其全部磁盘记录，不可恢复。 | This permanently deletes “{name}” and all of its stored records. |
| `bin.emptyAll` | 清空回收站 | Empty the recycle bin |
| `bin.emptyAllConfirm.body` | 将永久删除 {n} 个会话（共 {size}），不可恢复。 | This permanently deletes {n} sessions ({size}). |
| `bin.emptyPartial` | 有 {n} 个会话未能删除，已保留在列表中 | {n} session(s) could not be deleted and stay in the list |
| `bin.footer` | 共 {n} 个会话 · 占用 {size} | {n} sessions · {size} |
| `bin.swept` | 已自动清理 {n} 个过期会话 | Auto-cleaned {n} expired sessions |
| `bin.loadMore` | 加载更多 | Load more |
| `bin.filter` | 按标题或目录筛选 | Filter by title or folder |
| `sidebar.trash` | 回收站 | Recycle bin |
| `sidebar.trashWithCount` | 回收站（{n}） | Recycle bin ({n}) |
| `settings.section` | 回收站 | Recycle bin |
| `settings.autoClean` | 自动清理回收站 | Auto-clean the recycle bin |
| `settings.retention` | 保留时长 | Retention period |
| `settings.retention.forever` | 永久 | Forever |
| `settings.retention.days` | {n} 天 | {n} days |
| `settings.sweepOnBoot` | 启动时清理一次 | Sweep once at startup |
| `settings.sweepInterval` | 清理周期（小时） | Sweep interval (hours) |
| `settings.stats` | 共 {n} 个会话 · 占用 {size} · 最近清理：{when} | {n} sessions · {size} · last swept: {when} |
| `settings.sweepNow` | 立即清理 | Clean up now |
| `settings.openBin` | 打开回收站 | Open the recycle bin |
| `settings.saveFailed` | 设置保存失败，请重试 | Could not save the setting — try again |
| `settings.autoCleanHint` | 关闭后回收站不再自动删除任何条目，只能手动清理。 | When off, nothing is deleted automatically — only manual clean-up runs. |
| `settings.retentionHint` | 超过保留期的条目会在下一次清理时被永久删除。 | Entries older than this are permanently deleted by the next sweep. |
| `settings.sweepOnBootHint` | 每次启动 dsh web 时按保留期清理一次。 | Run one retention sweep each time dsh web starts. |
| `settings.sweepIntervalHint` | 1–168 小时；改完立即生效，无需重启。 | 1–168 hours; takes effect immediately, no restart. |
| `settings.never` | 从未 | never |
| `settings.unavailable` | 暂时读不到回收站设置，请重试 | The recycle-bin settings are temporarily unavailable — retry |
| `settings.version` | 版本 {version} | Version {version} |
| `settings.upToDate` | 已是最新版本 | Up to date |
| `settings.updateAvailable` | 有新版本 {version} 可用 | Version {version} is available |
| `settings.viewOnNpm` | 在 npm 上查看 | View on npm |
| `bin.settingsHint` | 打开左下角账号菜单 → 设置 → 回收站 | Open the account menu (bottom left) → Settings → Recycle bin |

上表覆盖主流程文案；`error.*`（按宿主返回的 `code` 直接取用的行内原因，如 `live` / `busy` /
`conflict` / `duplicate` / `unsupported` / `too-large`）与 `row.*` / `time.*` 属实现级 key，
不逐条列举。新增 code 时两份词典都要加 key，`tools/helpers.test.mjs` 会断言中英 key 集合一致、
且代码里用到的 key 都存在于词典。

## 9. 验收标准

**入口与面板**

- [ ] AC-1 侧边栏「工作区」行在 `添加工作区` 之后出现第 4 个同风格图标按钮；宽窄两种侧边栏都正确；宽度/主题/语言切换后仍只有一个。
  ✅ 已由 `tools/bin-live-probe.mjs` 自动验证（注入唯一、紧跟锚点、未被 60px 上限裁掉）。
- [ ] AC-2 点击图标打开模态面板，URL 与当前会话不变；`Esc`/遮罩/关闭按钮都能关闭，焦点回到触发按钮。
  ✅ 已自动验证（打开不改变 URL、Escape 可关）；"焦点回到触发按钮"仍是手工检查项。
- [ ] AC-3 面板列出全部回收站条目，字段完整（标题/目录/删除时间/大小），按删除时间倒序。
  ✅ 已自动验证（真实条目含标题、目录、相对时间、大小、短 id）。
- [ ] AC-4 空回收站显示空态；>200 条时分页可用。
  空态与分页均已自动验证（`tools/trash-panel-probe.mjs` 用 60 条数据断言「先 50 条 + 加载更多，
  点后 60 条且按钮消失」）；200+ 条的真实数据演练仍属可选。
- [ ] AC-5 面板打开时发生自动清理，列表能反映变化并给出提示。
  逻辑与单测已覆盖（`bin.swept` 只在清理确实推进时出现）；端到端演练仍未补做。

**移入 / 复原 / 真实删除**

- [ ] AC-6 会话行菜单出现「移入回收站」，点击后确认弹窗文案正确；确认后该行从列表消失，`sessions/` 下目录不存在，回收站出现该条目。
  ✅ 菜单项、确认弹窗、行消失、回收站出现条目均已由 `tools/bin-live-probe.mjs` 自动验证（目录不存在由 `repro-trash.mjs` 验证）。
- [ ] AC-7 运行中会话被拒绝且文案正确；严格空闲会话可安全移入（无残留内存占用）。
  宿主侧闸门与文案由 `tools/trash.test.mjs` 覆盖；端到端（真跑一个会话再移入）仍未补做（见 §13）。
- [ ] AC-8 复原后原目录逐字节等于移入前的目录（含 `session.lock` 与所有 generation 文件）；`persistence.list()` 重新包含该会话；侧边栏无需刷新即出现（`sessions.refresh()` 生效），且仍归属原工作区分组（重启后槽位被剪掉的情况由复原时的 `attachSession` 补回）。
  ✅ 逐字节 + 身份校验由 `tools/repro-trash.mjs` 自动验证；"侧边栏无需刷新即出现"已由 `tools/bin-live-probe.mjs` 自动验证；
  "归属原工作区"由宿主侧 `attachSession` 实现 + 单测覆盖，跨重启的分组演练仍未补做（见 §13）。
- [ ] AC-9 复原目标已存在时返回 `conflict`，条目保持完整可重试。
- [ ] AC-10 真实删除单个条目后目录与元数据都消失；清空回收站后回收站区为空且 `sessions/` 不受影响。
  ✅ 宿主侧由 `tools/trash.test.mjs` 覆盖（含目录与元数据都消失、清空后为空）；界面侧已由
  `tools/bin-live-probe.mjs` 自动验证（面板内「真实删除」二次确认 → 宿主条目归零、行消失；
  「清空回收站」二次确认显示条数 → 宿主归零、面板回到空态）。
- [ ] AC-11 任何失败路径都不会留下"半移入"状态（I1/I2/I3 有自动化用例覆盖）。

**设置与自动清理**

- [ ] AC-12 设置面板出现「回收站」导航项，四个控件 + 统计 + 立即清理可用；中英文案正确。
  ✅ 已由 `tools/bin-live-probe.mjs` 自动验证（真 shell + primitives：导航项、四行控件、统计、双按钮、中英文案）。
  降级路径由 `tools/settings-render-probe.mjs` 覆盖（自绘控件逐项写入且只写自己的字段）。
  导航项垃圾桶图标、页脚版本与更新提示随 `0.5.3` 发布，覆盖情况见 §13。
- [ ] AC-13 关闭 `autoClean` 后，过期条目在启动与定时扫描中都不被删除；重新打开后按保留期删除。
  ✅ 宿主侧由 `tools/trash.test.mjs` 的 `/sweep` 路由用例覆盖；页面侧由 live 探针验证"开关落库 + 锁住调度控件"。
- [ ] AC-14 保留期改为 7/90/永久立即生效，无需重启；`settings.json` 内容可读且带 schema 版本。
  ✅ live 探针验证了 90 天落库；`settings.json` 带 `schema: 1` 由 `tools/trash.test.mjs` 覆盖。
- [ ] AC-15 启动时（`sweepOnBoot`）与每 `sweepIntervalHours` 小时各执行一次清理；`sweep` 只删过期条目，且不会并发处理用户正在复原的条目。
  清理选择与串行化由 `tools/trash.test.mjs` 覆盖（含 `retentionDue` 边界、`disabled` 跳过、启动维护）；live 探针验证了「立即清理」按钮与清理周期落库。
- [ ] AC-16 设置文件损坏/非法值时回退默认值并把坏文件另存为 `.bak`，插件不崩溃。
  ✅ 由 `tools/trash.test.mjs`（损坏文件 + `.bak`）与 `tools/client-bin.test.mjs`（读失败提示）覆盖。

**质量门槛**

- [ ] AC-17 `node --test tools/*.test.mjs` 全绿（新增用例见 design.md §8）。
  ✅ **120 passed / 0 failed**（helpers 52 + trash 32 + client-bin 36），CI 已改为跑该命令。
  Windows 上 trash 套件收尾可能对测试自己创建的 junction 目录报 `ENOTEMPTY` 清理噪音；用例断言仍是 32/32。
- [ ] AC-18 `node tools/repro-trash.mjs` 端到端通过（真实 JSONL 持久层副本：移入 → 列表不含 → 复原 → 列表含且字节一致）。
  ✅ 通过：真实 v4 后端 + 真实会话副本（含一份真实用户日志的拷贝），逐字节比对与身份校验都过。
- [ ] AC-19 在隔离 home 的探针实例（`tools/probe-setup.ps1`，端口 3081）里手工走通 §5–§7 的全部主流程；截图归档。
  ✅ 0.5.2 发布前：`tools/bin-live-probe.mjs` **40 项全通过**（入口/面板/移入/复原/真实删除/清空/设置页全部腿），
  截图 8 张落在 `%TEMP%\dsh-bin-live\`。当前脚本已扩到 **44 个断言点**，新增导航图标与页脚版本断言；
  最近这次改动后尚未重跑（见 §13）。
- [ ] AC-20 README / README.en / DEVELOPING 更新：删除语义、回收站、设置、路由表、故障排查。
  ✅ 三份文档已按 0.5.x 重写（README 正文不再是 0.4.x 语义），并新增 `docs/recycle-bin/`；0.5.2 后又补了版本状态与设置页页脚说明。

## 10. 里程碑

| 里程碑 | 内容 | 退出标准 | 状态 |
|---|---|---|---|
| **M1 宿主回收站内核** | 回收站路径与元数据、`trash`/`restore`/`purge`/`empty`/`sweep`、路由、`pending.json` 语义改为"重启后移入"、安全校验 | AC-6/7/8/9/10/11 的宿主侧用例通过；`repro-trash.mjs` 通过 | ✅ 已完成（28 个单测 + 真实 v4 后端端到端） |
| **M2 客户端主流程** | 菜单项改文案与配色、确认弹窗、回收站面板（列表/复原/真实删除/清空）、侧边栏图标注入 | AC-1/2/3/4/6/8 手工 + 探针验证通过 | ✅ 已完成（客户端单测 + 面板渲染探针 + 隔离实例端到端） |
| **M3 设置与自动清理** | `settings.json`、设置路由、`settings.section` 注册、启动+定时清理、统计 | AC-12/13/14/15/16 通过 | ✅ 已完成（宿主侧 M1 已就绪；M3 补齐 `settings.section` 页面 + 控件探测 + live 验证） |
| **M4 打磨与发布** | 分页/筛选/提示、i18n 校验、README/DEVELOPING、版本 `0.5.x`、发布流水线 | AC-17/18/19/20 通过，发布检查六道闸门通过 | ✅ `0.5.2`（2026-10-18）、`0.5.3`（2026-10-21）、`0.5.4`（2026-10-25）均已发布到 npm 与 GitHub Release；`0.5.3` 带上设置页图标/版本页脚/更新提示，`0.5.4` 带上失败路径修复与成功提示改 toast |

## 11. 开放问题与后续增强

1. **角标（变体 B）**：在垃圾桶图标右上角显示条目数。会打破"与三图标完全同风格"，本期不做。
2. **撤销 toast**：移入后 5 秒内提供「撤销」（直接复原）。上游 `Toast` 原语已可用（`shell.overlay` 惯例），
   基建成本很低，仍列为 P2 以免主流程复杂化。
3. **容量上限与 LRU**：`maxBytes` / `maxEntries` 触发最旧优先淘汰，P2。
4. **批量操作**：多选 + 批量复原/删除，P2。
5. **上游槽位提案**：向 DSH 上游提 `sidebar.workspaces.header.action`（list）槽位，之后把侧边栏图标从 DOM 注入切到槽位注册，可去掉对 aria-label 的依赖。
6. **设置页图标参数**：`settings.section` 目前没有 icon 选项；可向上游建议增加，之后去掉导航行的 DOM 标记与 CSS mask。
7. **投影缓存补标题**：宿主侧尝试从 `sessionProjectionCache` 读最后已知标题，减少"未命名会话"。

## 12. 待确认的产品取舍（需拍板）

以下四点本规格已给出默认值，但都属于"一句话就能改"的产品决策，实现前确认一次最稳：

1. **是否保留"直接永久删除"入口？** 现设计：不保留，菜单里只有「移入回收站」；永久删除只在回收站面板内提供（最安全，也最贴近需求描述）。
2. **侧边栏是否显示条目数角标？** 现设计：不显示，只在 tooltip 里写「回收站（N）」，以保持与三图标完全同风格。
3. **默认策略**：自动清理开启、保留 30 天、启动时 + 每 6 小时各扫一次（需求里的示例值）。
4. **清空回收站是否需要输入确认词？** 现设计：不需要，只做二次确认 + 明示条数与占用体积。

## 13. 已知边界（0.5.x 交付时的诚实清单）

功能已完整可用，下面这些是**已知但可接受**的边界，交付时明确记录，避免以后被当成"没做"：

| 项 | 现状 | 影响 / 后续 |
|---|---|---|
| 运行中的会话 | 宿主闸门（`live` / `busy`）有单测，"真跑一个会话再移入"没有端到端演练 | 行为由 `tearDownResident` 的严格 idle 条件保证；要演练需要真的跑一轮对话 |
| 重启后移入队列（`pending.json`） | 写入侧（gate 重排队）与 boot 消费侧都有回归用例；没有制造真实排队条目的端到端 | 触发条件苛刻（内存里有无法安全释放的会话）；`/undo` 可取消 |
| 跨卷移动的「已发布、未删源」窗口 | `recoverTrash` 把条目标成 `trashed`，源目录保留（不替用户删数据）；该会话再删除返回 `duplicate`，复原返回 `conflict` | 只在 EXDEV（会话根与 `DSH_HOME` 不同卷）时出现；出路是先真删回收站里那条，再重新删除 |
| 跨卷复制中途崩溃留下的 `<trashId>.partial` | 复制/校验/发布任何一步失败都会当场清理；被直接杀掉时 boot 的孤儿扫描只点名 warn，不擅自删目录 | 需要人工到 `trash/` 下删除 `*.partial`；只在 EXDEV 回退 + 崩溃时出现 |
| 删不掉的回收站条目（安全闸门拒绝） | 清空/永久删除会跳过它，响应 `failed[]` 点名具体 `trashId`，面板保留该行并标原因；没有「强制删除」开关 | 载荷异常时该条目会一直留着；出路是先复原取回会话、修好目录再删（README「排查」已写明） |
| 跨重启的工作区分组 | 复原时 `attachSession` 有单测；"重启后再复原仍回到原工作区"没有端到端 | 复位失败只会落进 "Ungrouped"，不会丢数据 |
| 英文界面 | 词典中英一致性与 `tr()` 行为有单测；live 探针只在中文下跑过 | 文案已按 §8 表核对；后续可加一条英文腿 |
| 同一 home 起第二个 `dsh web` | 只有进程内串行，没有跨进程锁 | 设计文档 §4.6 已声明为尽力而为；两进程同时操作同一条目是未定义行为 |
| `/session-purge/state` 的 `entryInjected` | 未实现（客户端没有上报锚点是否命中） | 纯诊断字段；侧边栏图标缺失时现在只能靠肉眼看 |
| 设置页导航图标 / 版本页脚 / 更新提示 | 单测已覆盖；DSH 0.2.1-rc.4 / rc.5 实机已验证导航图标、页脚版本号与「已是最新版本」提示 | 下一次发布前仍建议补跑 `settings-render-probe.mjs` |
| 角标 / 撤销 toast / 批量操作 / 容量上限 / 筛选框 | 未实现，见 §11 | 都是 P2 增强，不影响主流程闭环 |
| 归档行菜单 | 归档行没有「归档会话」内置项，菜单序列识别不会注入「移入回收站」 | 先「取消归档」，再在普通会话行上移入回收站；README「需要知道的」已写明 |
| 0.1.7-rc.2 / 0.1.5-rc.3 | 沿用同一套 DOM 识别，这一轮没有重新实机验证；0.1.5 无设置扩展点 | 设置页在 0.1.5 上不可用，改用 HTTP 路由；README「环境要求」已写明 |
