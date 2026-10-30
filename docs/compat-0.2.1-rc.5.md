# dsh-session-purge × DSH 0.2.1-rc.5 兼容性核查

日期：2026-10-30
插件：`dsh-session-purge@0.5.5`（npm `latest` 同版本）
目标 DSH：`0.2.1-rc.5`（标签 `dsh-v0.2.1-rc.5`；npm `latest` 与 `next` 均指向此版本）
基线：`0.2.1-rc.4`（[compat-0.2.1-rc.4.md](./compat-0.2.1-rc.4.md)）；更早的 0.2.0 对照见
[compat-0.2.1-rc.2.md](./compat-0.2.1-rc.2.md)

## 结论

**插件可用，无 BREAKING，本轮无需改代码。** `rc.4 → rc.5` 是 0.2.1 系列里最小的一次升版：
4 个提交、368 个文件，其中 349 个是各包 `package.json` 的版本号，19 个实质文件全部落在
`ui-chat` 的思考过程（reasoning）渲染与 `experimental/client-ui-cot-translation`。
插件依赖的每一个面——会话行菜单 DOM、工作区行 `.headerActions`、设置页槽位与导航、持久层、
bundle patch——**一处未动**。

## 差异范围

| 上游改动 | 对插件的影响 |
|---|---|
| `ui-chat`：`ReasoningContent.tsx` / `ReasoningRow.tsx` / `reasoning-text.ts` / `process-activity.ts` 重构思考块渲染 | 无。位于消息内容区，插件不读取 |
| `ui-chat/src/client/contract/slots.ts`：`conversation.chat.reasoning.body` 的 ownerProps 由 `{text, running}` 增加为 `{rawText, text, running}` | 无。插件注册的是 `settings.section`，不涉及该槽位 |
| `experimental/client-ui-cot-translation`：`TranslationBody.tsx` 跟随 `rawText` | 无。插件不做推理翻译 |
| `cordis-client-runner/src/client/slot-catalog.ts`：8 处 `source:` 行号 +6 偏移，另加 reasoning.body 的 props 文档 | 无。槽位目录的文档同步；槽位名与注册面未变 |

上游本轮的升级指南 `docs/upgrade-guide/v0.2.1-rc.4/reasoning-body-props` 只影响**自定义推理渲染器
与翻译包装组件**，插件不属于此列。

插件依赖的包——`session-persistence-jsonl`、`core/{session,agent,agent-loop,scope}`、`workspace`、
`app-boot`、`home-paths`、`bundle/{base,web-app}`、`plugin-manager`、`client/web`——以及 UI 侧的
`ui-workspace` / `ui-primitives` / `ui-sidebar` / `ui-settings-general` / `ui-settings-account`
**src 均为零改动**。

## 实机验证

隔离实例：本机全局安装的 `0.2.1-rc.5`，独立 `DSH_HOME=.compat-run/home-rc5`、端口 3181。

- **宿主侧** 26 项断言全过：9 条 HTTP 路由；移入 → 列表消失 → 回收站条目 → 复原到原路径
  （sha256 逐字节一致）→ 再次移入 → 真实删除 → 目录从磁盘消失；设置读写、清扫、`undo`、`empty`。
- **浏览器侧**（真实 shell + Edge）：会话行菜单在「归档会话」之后正确插入「移入回收站」
  （后接上游的「复制 Session ID」）；二次确认弹窗文案带保留期；成功 toast；面板列出条目与
  策略行「自动清理：保留 30 天›」；策略行点开设置页，导航含「回收站」且带图标，节内四个控件、
  统计行、页脚「版本 0.5.5 · 已是最新版本」全部渲染。
- **回归测试**：`npm test` **131/131 通过**。

## 环境注记

- 本次改用**本机全局安装**的 dsh 起隔离实例（上次是把 635 MB 安装到 `.compat-run`）。全局安装的
  依赖嵌在 `dsh/node_modules` 下；它的 `koffi` 缺 `.node` 产物，因此**新建会话**会失败（页面停在
  「选择一个工作区开始」）。但插件的移入 / 复原 / 删除不依赖创建会话，宿主侧与既有会话的
  菜单注入验证不受影响。
- 本机 `HTTP_PROXY` / `HTTPS_PROXY` 会劫持回环请求（对 `127.0.0.1:3181` 返回 502），起服务与
  探针前需清空，或设 `NO_PROXY=127.0.0.1,localhost,::1`。
- rc.5 的侧栏**默认展开**工作区。探针脚本若还去点工作区标题，会把列表折叠、会话行随之消失——
  这是测试脚本里的坑，与插件无关（`rc.4` 时代默认折叠，脚本里的那一步已改成「找不到会话行才点」）。

## 复现命令

```powershell
# 回归测试
npm test

# 隔离实例（用本机全局安装，不额外下载）
$env:DSH_HOME = 'D:\dsh-session-purge\.compat-run\home-rc5'
$env:HTTP_PROXY = ''; $env:HTTPS_PROXY = ''; $env:NO_PROXY = '127.0.0.1,localhost,::1'
$bin = 'C:\Users\Verdana\scoop\apps\nodejs\current\bin\node_modules\@deepseek-ai\dsh\lib\bin.js'
node $bin plugin --profile web add link:D:\dsh-session-purge
node $bin web --no-open --port 3181 --host 127.0.0.1

# 宿主侧全链路（26 项断言，含逐字节复原）
$env:COMPAT_HOME = $env:DSH_HOME
node .compat-run\verify-chain.mjs
```

> 验证脚本在 `.compat-run/`（已 gitignore），不随包发布。
