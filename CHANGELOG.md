# 变更记录

每个已发布版本的**用户可见变化**记在这里。这样做是为了让文档里不再出现「当前发布是 X」这类
会腐的陈述——版本号由 npm 承担（见 README 顶部的 badge），历史由本文件承担，两者都不需要
每次发版手工同步。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 变更

- 清理 0.1.x 兼容代码：会话行识别不再接受 `onRename` / `onFork` / `onArchive` 三个旧
  props，兼容表、README 与测试用例一并去掉 0.1.5 / 0.1.7。支持面为 0.2.x
  （0.2.0-rc.2 起）；0.2.1 / 0.2.2 的 DOM 识别与降级行为不变。

### 修复

- 适配 DSH 0.2.2-rc.2 的菜单行克隆：归档行带 `separatorBefore` 分隔线与权限属性，
  克隆后会在「移入回收站」上方多出一条分割线，并可能继承 `aria-disabled` /
  `aria-describedby`（重复 DOM id）。现在克隆后删除分隔线并清掉这两个属性。
- 确认弹窗按钮 hover 态的边框色 token 拼写改为 `--dsw-alias-label-secondary`（原写
  `--dsh-`，恒取 fallback 色）。

### 文档

- 新增 `docs/compat-0.2.2-rc.2.md`：rc.2 相对 rc.1 的契约面核查（Host 16 项 / 浏览器 18 项），
  结论无阻断；记录 `agents.enter()` 所有权语义删除与 `unarchiveSession` 新钩子无 try/catch
  两个语义变化。
- `DEVELOPING.md` 兼容表新增 0.2.2-rc.2 列与「0.2.2 起的两个语义变化」小节，并把
  `docs/compat-0.2.2-rc.1.md` / `rc.2` 补进 compat 文档列表。
- 在 DSH 0.2.2-rc.2 实机上复验通过：隔离实例里回收站删除/复原逐字节一致、设置与回收站跨重启存活、
  插件浏览器半被 rc.2 的 client-modules 正常组合下发。结果写入 `docs/compat-0.2.2-rc.2.md`「rc.2 实机证据」。

## [0.5.8] - 2026-11-06

### 修复

- 适配 DSH 0.2.2 的两处视觉回归：0.2.2 起会话菜单的图标容器与设置导航的图标容器都带
  `aria-hidden="true"`，此前「移入回收站」菜单项的图标会被当快捷键键帽一并删掉（标签左移 20px）、
  设置导航会齿轮与垃圾桶并排。现在键帽清理会保留含 svg 的 `aria-hidden` 元素，设置导航的
  图标隐藏规则同时覆盖直挂 `<svg>`（0.2.1 及更早）与 `span` 包裹（0.2.2 起）两种结构，
  不按版本分支。详见 `docs/compat-0.2.2-rc.1.md`。

## [0.5.7] - 2026-11-03

### 修复

- 修复「会话移入回收站 → 重启 `dsh` → 复原」后落进「未分组」的问题：复原时先把工作区注册表
  的 header 索引从复原后的磁盘刷新（`sessionKnown`），再 `attachSession` 补归属；此前索引是启动时
  建的、看不见回收站里的目录，`attachSession` 对仍在记录里的 id 会短路，随后它触发的 workspace
  写入反而按陈旧索引把该 id 剪掉。复原后还会校验归属是否真的补上，失败时 `warn`（原来只进
  `debugLog`，用户完全看不到）。
- 修复复原后页面仍显示「未分组」、必须刷新才归位的问题：`attachSession` 对「记录里已有该 id」的
  调用是无写入的 no-op，注册表按设计不发布没有变化的记录，已连接页面便一直用启动时的旧投影。
  复原时若检测到「刷新索引前不可见、刷新后可见」，会以重设同一标题的方式重新发布该工作区投影，
  让会话立即归组；同一进程内的普通复原（投影本来就正确）不会产生这次多余写入。

### 变更

- 回收站整页重新排版：标题去掉图标（图标只留在弹窗里），条目数改成标题旁的胶囊；每条记录分成
  标题（15px / 600）、元信息（12px，`删除于… · 目录 · 大小`）、完整会话 ID（11px 等宽，带 `ID`
  标签）三层，ID 不再省略；整页按可用宽度自适应，窄于 780px 时退化为单列。行内「真实删除」在
  整页里改成红字按钮（hover 才上底色），避免一屏几十个实心红块压过标题。

## [0.5.6] - 2026-10-31

### 新增

- 设置页新增「入口位置」：**图标**（默认，工作区行的小图标 + 弹窗）或**菜单**（与「插件 /
  自动化任务」并列的一行 + 整页）。两种形态随时切换、立即生效，不用重启 `dsh web`，也不用刷新页面。
  菜单形态下点开的是中间栏的整页——列表更宽、行信息不挤，底部的策略行与「清空回收站」留在页面底部；
  会话行删除后的 toast、设置页的「打开回收站」都跟随形态（菜单跳页面，图标开弹窗）。
  页面标题与「插件 / 自动化任务」同字号（20px），列表用页面自身的滚动条，不再套一层内部滚动。
  老版本 shell 没有全局面板列的，自动退回图标形态。

### 变更

- 复原会话后也弹出顶部 toast（`已复原「X」`），与移入回收站保持一致；面板内不再重复同一句，
  「原始目录已不存在」「刷新页面后可见」这类补充信息并入 toast 文案。

### 文档

- 兼容性说明更新到 DSH `0.2.1-rc.5`：`rc.4 → rc.5` 之间上游只改了思考块（reasoning）渲染，
  插件依赖的契约面未变，实机复验通过，无需改动代码（见
  [docs/compat-0.2.1-rc.5.md](https://github.com/verdana/dsh-session-purge/blob/main/docs/compat-0.2.1-rc.5.md)）。

## [0.5.5] - 2026-10-28

### 文档

- 兼容性说明更新到 DSH `0.2.1-rc.4`：`rc.2 → rc.4` 之间插件依赖的契约面未变，实机复验通过，
  无需改动代码（见 [docs/compat-0.2.1-rc.4.md](https://github.com/verdana/dsh-session-purge/blob/main/docs/compat-0.2.1-rc.4.md)）。

### 修复

- 回收站面板的会话列表不再在条目超过一屏时失去滚动：列表成为面板里唯一的滚动区，末尾几条
  可见也可点，底栏的「清空回收站」与策略提示保持原位
  （[#1](https://github.com/verdana/dsh-session-purge/issues/1)）。

## [0.5.4] - 2026-10-25

### 修复

- 重启后「移入回收站」的队列不再吞掉仍需重试的删除（`fix(queue)`）。
- 清空回收站部分失败时保留失败行并在行内标注原因，不再当作全部成功（`fix(bin)`）。
- 请求体超限返回 413、JSON 畸形返回 400，与其他路由一致（`fix(http)`）。
- 关闭自动清理后不再改写「最近清理」时间，禁用即纯 no-op（`fix(sweep)`）。
- 跨卷移动窗口留下的重复会话有了名字，残留的暂存目录不再无人清理（`fix(trash)`）。

### 变更

- 「移入回收站」成功后改为顶部 toast 提示（带「打开回收站」动作），不再多要一次点击。

## [0.5.3] - 2026-10-21

### 新增

- 设置页导航项使用垃圾桶图标（DOM 标记 + CSS mask，不依赖槽位参数）。
- 设置页页脚显示正在运行的插件版本，并向 npm 查一次新版本：有新版本给可点击提示，已是最新
  则注明；离线或被网络策略阻断时静默跳过。

## [0.5.2] - 2026-10-18

### 变更

- `package.json` 的 description 改为回收站口径，并补上 `repository` 字段（npm 页面上的
  README 相对链接因此可用）。
- 市场提交材料（`market/`）随仓库状态同步。

无功能变更。

## [0.5.1] - 2026-10-18

### 修复

- 兼容 DSH 0.2.1：设置入口改走账号菜单、后端导出形态、`dshHomePath` 探测改为调用函数。

## [0.5.0] - 2026-10-14

### 新增

- 会话回收站：删除不再是永久删除，而是把会话目录原样移入回收站，可复原（逐字节还原）、
  可真实删除、可清空。
- 保留期自动清理：默认保留 30 天，启动时与每 6 小时各扫一次。
- 侧边栏「工作区」行的回收站入口、回收站面板、设置页（`settings.section`）与自动清理设置。

[未发布]: https://github.com/verdana/dsh-session-purge/compare/v0.5.8...HEAD
[0.5.8]: https://github.com/verdana/dsh-session-purge/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/verdana/dsh-session-purge/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/verdana/dsh-session-purge/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/verdana/dsh-session-purge/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/verdana/dsh-session-purge/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/verdana/dsh-session-purge/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/verdana/dsh-session-purge/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/verdana/dsh-session-purge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/verdana/dsh-session-purge/compare/v0.4.5...v0.5.0
