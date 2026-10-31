# 变更记录

每个已发布版本的**用户可见变化**记在这里。这样做是为了让文档里不再出现「当前发布是 X」这类
会腐的陈述——版本号由 npm 承担（见 README 顶部的 badge），历史由本文件承担，两者都不需要
每次发版手工同步。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.6]

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

[未发布]: https://github.com/verdana/dsh-session-purge/compare/v0.5.6...HEAD
[0.5.6]: https://github.com/verdana/dsh-session-purge/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/verdana/dsh-session-purge/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/verdana/dsh-session-purge/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/verdana/dsh-session-purge/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/verdana/dsh-session-purge/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/verdana/dsh-session-purge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/verdana/dsh-session-purge/compare/v0.4.5...v0.5.0
