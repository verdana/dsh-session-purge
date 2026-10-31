# 会话回收站 — 设计资料

本目录是 `dsh-session-purge` 把「永久删除会话」升级为「会话回收站」的完整功能定义与实现记录。

| 文档 | 内容 | 读者 |
|---|---|---|
| [spec.md](./spec.md) | 产品功能规格（PRD）：目标/非目标、交互设计、数据模型、文案表、**验收标准**、里程碑、开放问题、**已知边界** | 产品、使用者、验收 |
| [design.md](./design.md) | 技术设计：已核实的上游扩展点（带 `文件:行号`）、磁盘与接口契约、宿主算法、客户端实现要点、测试计划、改动清单、风险 | 维护者 |

一句话概括：侧边栏「工作区」行三图标之后新增一个同风格回收站入口，点击弹出模态面板列出所有已删除会话，
可**复原**、可**真实删除**、可**清空**；设置页提供自动清理开关、保留时长（默认 30 天）与清理时机，
导航项使用垃圾桶图标，页脚显示运行中的版本并尽力提示 npm 更新。

## 交付状态

M1（宿主内核）、M2（客户端主流程）、M3（设置页与自动清理）、M4（打磨与发布）均已完成。
**逐版变更记在仓库根的 [CHANGELOG.md](../../CHANGELOG.md)**，npm 上的最新版本见 README 的 badge；
本文件与 spec / design 都不再声明「当前发布是哪个版本」——那种陈述每次都腐。

截至 2026-10-28 的 `main`（**历史快照**，不是「当前」声明）：单元/回归用例 **131 个**
（helpers 52 + trash 32 + client-bin 41 + pack-report 6），全绿；覆盖重启队列、清空部分失败、请求体 413/400、
跳过清理不记账、跨卷重复会话、面板列表滚动，以及「移入成功改 toast、其余终态留弹窗」的契约。
三个渲染探针与隔离实例探针（45 个断言点）也随 toast 改版全绿重跑过（2026-10-25，见
`DEVELOPING.md`「测试」与 design.md §8.4）。

尚未覆盖的边界（运行中会话、重启队列、跨重启分组、英文界面等）逐条列在 **spec.md §13**。

## 关键结论速览

- **删除变成软删除**：会话目录 `rename` 到 `<DSH_HOME>/session-purge/trash/`，不删不改写，复原位级忠实。
- **侧边栏入口必须 DOM 注入**：上游 `sidebar.workspaces` 是 single 槽位且 header 没有 hole，
  同时要覆写 `.headerActions{max-width:60px}`，否则第 4 个图标会被裁掉。
- **入口也可以放到顶部文字菜单**：`sidebar.panellist` 是与「插件 / 自动化任务」同一列，
  但每行硬绑一个 `main` 页面（`layout.selectPanel` 对未注册的 id 直接抛错），所以菜单形态
  必然是「一行 + 整页」，不存在「只换位置、仍开弹窗」；取舍见 design.md §7.5。
- **面板用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Modal`**（平台 seed 词，不新增 npm 依赖），
  卡片宽 **760px**——上游默认 380px 会把会话标题挤成一条缝。
- **设置页走 `settings.section` 槽位**，但配置**不**走 `configForms`（插件无法 import
  `@deepseek-ai/schemastery`），改为插件自有 `settings.json` + 自有 HTTP 路由。
- **设置导航图标没有槽位参数**：`settings.section` 只有 `id`/`order`/`label`，未知 id 会被 shell
  回退成齿轮。插件在 DOM 里标记自己的导航行，再用 CSS mask 换成与侧边栏同几何的垃圾桶。
- **页脚版本来自宿主**：`GET /session-purge/settings` 与 `/trash` 返回 `version`（启动时读
  `package.json`），浏览器只用宿主的值；npm 更新检查是尽力而为，失败时静默。
- **复原后调用 `ctx.sessions.refresh()`**，侧边栏无需刷新即可出现该会话。
