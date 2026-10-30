# dsh-session-purge × DSH 0.2.1-rc.4 兼容性核查

> **历史切片**：本文只覆盖 `rc.2 → rc.4`。之后版本的增量见
> [compat-0.2.1-rc.5.md](./compat-0.2.1-rc.5.md)（当前支持面的依据）。

日期：2026-10-28
插件：`dsh-session-purge@0.5.4`（工作区，未改版本号）
目标 DSH：`0.2.1-rc.4`（标签 `dsh-v0.2.1-rc.4`，HEAD `504a01a957`；npm `next` 指向此版本）
基线：`0.2.1-rc.2`（本仓库上一份清查 [compat-0.2.1-rc.2.md](./compat-0.2.1-rc.2.md) 的目标版本）

## 结论

**插件可用，无 BREAKING，本轮无需改代码。** `rc.2 → rc.4` 之间上游只动了菜单项属性、Tooltip
定位与侧栏面板排序；插件依赖的宿主契约（持久层、Agent/Session 注册表、webServer、bundle patch、
设置槽位、会话行菜单 DOM）**一个都没变**。

在本机隔离实例（npm 安装的 `0.2.1-rc.4`，独立 `DSH_HOME`、端口 3181）上实机验证：

- **宿主侧**：9 条 HTTP 路由全部可用；端到端「移入 → 列表消失 → 回收站条目 → 复原到原路径
  （sha256 逐字节一致）→ 再次移入 → 真实删除 → 目录从磁盘消失」**26 项断言全过**；设置读写、
  清扫、`undo`、`empty` 均返回预期结构。
- **浏览器侧**（真实 shell + Edge）：`tools/bin-live-probe.mjs` 的前 9 项全过——侧边栏回收站图标
  注入 1 次、紧跟在「添加工作区」之后、未被 60px 上限裁剪、点击开面板、空状态、不导航、
  面板宽 ≥ 700px、Escape 关闭。该脚本从「会话行」开始的断言依赖侧栏已展开工作区这一夹具状态，
  本次没有满足，因此改用针对性脚本逐项验证：会话行菜单在「归档会话」之后正确插入
  「移入回收站」（后接上游的「复制 Session ID」）；二次确认弹窗文案带保留期提示；成功后出 toast；
  面板列出条目与策略行；策略行点开设置页，导航含「回收站」且带图标，节内四个控件、统计行、
  页脚「版本 0.5.4 · 已是最新版本」全部渲染。
- **回归测试**：`npm test` **131/131 通过**（首轮有 1 项 `ENOTEMPTY` 抖动，见 DEVELOPING.md
  已记录的 Windows 收尾清理问题，复跑即过）。

**rc.3 没有再单独起实例跑一遍**：它到 rc.4 只差两处 tooltip 行为与 ACP/MCP 的诊断输出，
而 rc.2 → rc.4 的契约面已在 rc.4 上验证完整，故以 rc.4 的结论覆盖 rc.3。

## 差异范围

`dsh-v0.2.1-rc.2..dsh-v0.2.1-rc.4` 共 15 个提交（rc.2→rc.3 六个、rc.3→rc.4 九个）、649 个文件；
其中绝大多数是 monorepo 各包的 `version` 字段 bump。

**插件依赖的包，源码零改动**（只改了 `package.json` 的版本号）：

| 依赖面 | 0.2.1-rc.4 状态 |
|---|---|
| `session-persistence-jsonl/src`、`core/session/src`、`core/agent/src`、`core/agent-loop/src`、`core/scope/src` | 未改动 |
| `workspace/workspace`、`boot/app-boot/src`、`util/home-paths` | 未改动（`app-boot` 仅 `package.json`） |
| `bundle/base/src`、`bundle/web-app/src`、`boot/plugin-manager/src`（bundle patch 装载机制） | 未改动 |
| `client/web/src`（seed：react / react-dom / ui-primitives 的平台映射） | 未改动 |

**有实质改动、且需要逐项确认的三处**：

| 上游改动 | 对插件的影响 |
|---|---|
| `ui-primitives/src/Menu.tsx`：`MenuItemButton` 增加 `current` → `aria-current="page"`；`Menu` 增加 `minWidthFromAnchor` | 无。DOM 骨架仍是 `div.itemWrap > button[role=menuitem]`，菜单项可读标签未变，插件的序列识别与 `aria-hidden` 键帽过滤照常工作（实机已确认注入位置） |
| `ui-primitives/src/Tooltip.tsx`：定位逻辑抽到 `tooltip-placement.ts`，支持四向翻转；`maxWidth` 改为 `min(px, 100vw-24px)` | 无。Tooltip 仍是 `cloneElement` 直挂 anchor、不引入包装层，`anchor.parentElement` 仍是 `.headerActions`；插件自己覆写的 `max-width:60px` 不受影响 |
| `ui-sidebar/src/client/SidebarRoot.tsx`：面板列表新增「更多」菜单（`sidebar.panellist`），rc.3 起侧栏出现「插件 / 自动化任务 / 更多」三行 | 无。插件挂在**工作区行**的 `.headerActions`（搜索 / 视图选项 / 添加工作区），与 `sidebar.panellist` 是两套 DOM；实机截图确认垃圾桶图标仍紧跟「添加工作区」 |

其余改动与本插件无关：`ui-workspace/src/client/navigation.ts`（新建会话复用空白会话、`whenDraftExists`）、
`ui-settings-general` 的 developer-tools 行埋点、`ui-conversation` 视图 tab 的 tooltip 溢出判断、
新增 `ui-entry-customization` 包（bundle patch 里加一行）。

**上游升级指南**（`docs/upgrade-guide/v0.2.1-rc.3` 六篇 + `v0.2.1-rc.4` 一篇）逐条映射后均不适用：
`independent-session-forks`（普通 fork 不再写 `parentSession`；插件只按菜单标签识别，且不读该字段，
Session 格式仍为 V4）、`session-follow-activation`（插件不调用 `session.follow`）、
`generated-worktree-names`、`attachment-read-access`、`ptc-caller-cancellation`、
`cua-bundle-id-consent`、`model-listing-refresh` 均不涉及插件的任何调用面。

## 环境注记（与插件无关，但会绊住复验者）

- **隔离实例的 npm 安装可能残缺。** 本次首次安装遇到 `ECONNRESET`，留下缺 `package.json` 的残骸，
  并且 **`koffi` 原生模块没有 `.node` 产物**（`cnoke` 下载 prebuilt 失败后退回源码编译，又缺 CMake，
  且沙箱禁止 `reg.exe`）。表现是页面起得来、插件图标与面板都正常，但会话创建报
  `Cannot find the native Koffi module`，UI 停在「选择一个工作区开始」，**一条会话行都没有**——
  `bin-live-probe.mjs` 从「会话行」开始的断言会连锁失败。这不是兼容性问题：补齐缺失包
  （`dsh-client-ui-primitives`、`dsh-client-ui-settings-account`）后，同一实例全部恢复。
- **本机代理会劫持回环请求。** `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:55939` 时，对
  `127.0.0.1:3181` 的 `Invoke-WebRequest` 返回 502，`dsh web` 启动也可能卡在联网阶段。
  起服务与探针都要先清这两个变量（或设 `NO_PROXY=127.0.0.1,localhost,::1`）。
- `@opentelemetry/semantic-conventions` 缺失会让 `otel` 与 `session-telemetry-otel` 两个 entry
  未激活（启动日志里是 `2 entries did not activate`），不影响插件与主流程。

## 复现命令

```powershell
# 回归测试
npm test

# 隔离实例（端口 3181，独立 home）
npm install --prefix .compat-run\dsh-0.2.1-rc.4 @deepseek-ai/dsh@0.2.1-rc.4 --no-audit --no-fund
$env:DSH_HOME = 'D:\dsh-session-purge\.compat-run\home'
$env:HTTP_PROXY = ''; $env:HTTPS_PROXY = ''; $env:NO_PROXY = '127.0.0.1,localhost,::1'
node .compat-run\dsh-0.2.1-rc.4\node_modules\@deepseek-ai\dsh\lib\bin.js plugin --profile web add link:D:\dsh-session-purge
node .compat-run\dsh-0.2.1-rc.4\node_modules\@deepseek-ai\dsh\lib\bin.js web --no-open --port 3181 --host 127.0.0.1

# 宿主侧全链路（26 项断言，含逐字节复原）
# 注意：verify-chain.mjs 与本次的浏览器脚本是核查期间的临时产物，未入库；
#       脱离 `.compat-run/` 时需按上面的步骤自行重写等价断言。
node .compat-run\verify-chain.mjs

# 浏览器侧。bin-live-probe.mjs 不会自己展开工作区：全新 home 上它会在「会话行」
# 那一步停住（count=0），那是夹具前置条件、不是兼容性回归。会话行之后的链路
# 需先手工点开工作区，或另写脚本驱动。
node tools\bin-live-probe.mjs "http://127.0.0.1:3181/?token=<启动行 token>"
```

> `.compat-run/` 已在 `.gitignore` 中，不随包发布。
