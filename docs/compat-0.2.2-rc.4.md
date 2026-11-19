# dsh-session-purge × DSH 0.2.2-rc.4 兼容性核查

日期：2026-11-18
插件：`dsh-session-purge@0.5.10`（本轮无产品代码改动，见 CHANGELOG「未发布」）
目标 DSH：`0.2.2-rc.4`（标签 `dsh-v0.2.2-rc.4`，`3f321d32bfe3`，2026-11-17 21:30）
基线：`0.2.2-rc.3`（标签 `dsh-v0.2.2-rc.3`，`38a6a5c965aa`，2026-11-13 13:26）
取证方式：**源码级 diff（按 git 标签）+ 隔离实例实机**。2026-11-18 本机 CLI 已是
`0.2.2-rc.4`；在隔离 `DSH_HOME`（仓库下 `.probe-home`）里以 `link:` 装入本仓库起
`dsh --profile web`，Host 半全部路由与回收站闭环实跑（见「实机证据」）。

## 结论

**无兼容性阻断项。rc.4 是发布性补丁版本：Host 与浏览器两面承载契约的文件，除
`package.json` 的版本号外零改动。**

`rc.3 → rc.4` 共 395 个文件、`+579 / −429`，但其中 379 个文件是各包
`package.json` 的版本号（每个 2 行）。去掉 `package.json` 后，全仓库只有 **16 个文件**动了：

| 区域 | 文件 | 说明 |
|---|---|---|
| `packages/llm/llm-deepseek` | `src/translate.ts`、3 份 README、2 个 spec | 新增 `safetyCheck` 开关；内容安全评审「总是请求」；拒答（refusal）不再触发安全评审 |
| `packages/llm/llm` | `src/error.ts` | 配套的拒答错误码 |
| `packages/experimental/liveshare` | `src/host/tunnel-worker.ts`、2 个 spec | tunnel worker 在 Host 的 Electron Node 模式下启动 |
| `docs/upgrade-guide/v0.2.2-rc.3/deepseek-refusal-code/` | `guide.md`、`guide.zh.md`、`guide.i18n.yaml` | 补写的 rc.3 升级指引 |
| `snapshots/session/deepseek-content-refusal/` | `session.v4.jsonl`、`snapshot.yml` | 拒答会话快照 fixture |

8 个 commit 全部属于上面四件事（`feat(llm-deepseek): add safetyCheck switch` 起，到
`release(dsh): 0.2.2-rc.4` 止），没有任何一条落在 Host / 会话 / 工作区 / 客户端壳层。

反向证明：对承载契约的包（`packages/host`、`packages/session`、`packages/core`、
`packages/workspace`、`packages/boot`、`packages/api`、`packages/client` 全树）做
`rc.3..rc.4` 的 diff → **65 个文件，全部是 `package.json`，每个 `2 +-`，零源码变化**。
因此 `docs/compat-0.2.2-rc.3.md` 里 16 项 Host 契约与 18 项浏览器契约的 **file:line 锚点
全部继续有效**，本文不再逐行重复，只记录本轮复核方式与实机结果。

三处既有事项原样继承，rc.4 没有加重任何一处（详见 rc.3 文档「问题清单」）：

1. `agents.enter()` 只收一个参数，回滚分支读到的 `AgentEntry.owner` 恒 `undefined`（低）。
2. `unarchiveSession` 的 `workspace/session-unarchiving` 钩子无 `try/catch`（中·条件）。
3. 非中英界面功能失效；`contextMenus.register` / `settings.section.icon` 迁移未做（既有）。

## 核查方法

- 差异规模：`git diff --shortstat dsh-v0.2.2-rc.3..dsh-v0.2.2-rc.4` → 395 files，
  `579 insertions(+)`，`429 deletions(-)`；`git log --oneline` → 8 个 commit。
- 过滤版本号：`git diff --name-status … | grep -v 'package\.json$'` → 16 行（上表）。
- 契约面：`git diff --stat … -- packages/host packages/session packages/core
  packages/workspace packages/boot packages/api packages/client` → 65 files，
  65 insertions / 65 deletions，逐文件均为 `package.json | 2 +-`。
- 上游文档：`docs/upgrade-guide/` 只有到 `v0.2.2-rc.3` 的目录，没有 `v0.2.2-rc.4`
  ——rc.4 没有新契约，也没有 breaking 清单可抄；仓库根同样没有 CHANGELOG 可对照。
- 实机：`DSH_HOME=D:\dsh-session-purge\.probe-home`、`dsh --profile web --no-open
  --port 3082 --host 127.0.0.1`，profile 的 bundles 仍是
  `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` / `dsh-session-purge`，
  `patchReload: live`，插件用 `link:D:\dsh-session-purge` 装入。

## 契约复核（本轮实测点）

| # | 契约 | rc.4 证据 | 判定 |
|---|---|---|---|
| 1 | `webServer.register` 形状 | `packages/host` 全树仅 `package.json`；实机 8 条路由全部就位（405/403/404 守卫也对） | 不变 |
| 2 | `sessionPersistence` 注入 + `locate()` | `packages/session` 仅 `package.json`；`GET /state` 返回 `"persistence":true` | 不变 |
| 3 | 会话格式版本 4 与落盘布局 | `packages/core/session`、`session-persistence-jsonl` 仅 `package.json`；probe home 的 10 个 `session.v3.jsonl.zstd` 仍能盘点/移动/复原 | 不变 |
| 4 | `workspaceRegistry` / `archiveSession` / `unarchiveSession` | `packages/workspace` 仅 `package.json` | 不变 |
| 5 | profile + `cordis.patch.yml`（`- insert:`）合成 | `packages/boot/app-boot` 仅 `package.json`；实机 profile web 起得来、插件路由全在 | 不变 |
| 6 | 客户端插件加载 / `client/modules` | `packages/client/modules` 仅 `package.json` | 不变 |
| 7 | `ctx.get('dshHomePath')` 是函数 | 实机 `trash`/`restore` 均落到 `<DSH_HOME>/session-purge/…` 与 `sessions/…` | 不变 |

浏览器半的 18 项锚点（会话行 ⋯ 触发器 `Rows.tsx:748-756`、`MenuSurface.tsx:11,25,41-46`、
`MenuRow.tsx:40-50`、`context-menus.tsx:35-68`、`SettingsRoot.tsx:73,79,91,92`、
`ui-settings slots.ts:57`、`ui-sidebar slots.ts:47`、`ui-layout index.ts:75,197`、
`WorkspaceBrowser.tsx:1290,1299-1305,191-195`、`.headerActions` 的 `max-width:60px`、
`api/session-controller service.ts:26-68,259,298`、`client/locale index.ts:75-82,205`）
所在的包在 rc.4 里全部只有 `package.json` 变化，锚点文件没有 hunk。

## 问题清单

| 严重度 | 问题 | 状态 |
|---|---|---|
| 低（rc.2 起） | `agents.enter()` 单参 → `AgentEntry.owner` 恒 `undefined`（`lib/index.js:743`） | rc.4 未改；不抛错，判定交上游 |
| 中·条件（rc.2 起） | `unarchiveSession` 钩子无 `try/catch` → 监听器抛错会「复原成功但仍归档」 | rc.4 未改；插件侧已包 try/catch |
| 低（既有） | 非中英界面功能失效；`contextMenus.register` / `settings.section.icon` 迁移 | 与 rc.4 无关 |
| 无新增 | rc.4 的改动（llm-deepseek 内容安全、liveshare tunnel worker、文档、快照）不在插件调用面上 | — |

## 本轮落码修复

产品代码零改动；只修了测试收尾（**2026-11-19 复核后更正归因**，rc.4 当时写成了
「boot sweep 竞态」，不成立）：

- 现象：`tools/trash.test.mjs` 的 `after` 钩子在本机恒报
  `Error: ENOTEMPTY: directory not empty, rmdir '…\session-purge\trash'`（进程仍 `exit 0`）。
- 真正根因：两个拒绝用例在回收站里造 Windows junction
  （`symlink(outside, join(bin, trashId), 'junction')`，`tools/trash.test.mjs:689`、`:725`）。
  `rm(home, { recursive: true, force: true })` 会顺着 junction 走进 `<home>/outside` 去删，
  随后对 `trash` 目录 `rmdir` 报 `ENOTEMPTY`。与 boot sweep 无关，所以重试多少次都不会好
  （实测 40×40ms 仍失败）。
- 修复：`removeHome` 改为自底向上遍历，`entry.isSymbolicLink()` 的项用 `rmdir(path)` 摘链
  （不碰目标；失败再 fallback `rm(path, { force: true })`），目录入栈，最后整体 `rm`。
- 修复后 `node tools/trash.test.mjs` 连跑 3 次均 `pass 34 / fail 0`，无 ENOTEMPTY。

## 本轮验证

- 差异取证：见「核查方法」。标签必须读 git tag，不读工作树（工作树 HEAD 是
  `ca33fd6843` 的 master，落后于 rc.4 标签之后的分支提交）。
- 单测（沙箱禁止 `node --test` 的 spawn，逐文件直跑）：
  `node tools/trash.test.mjs` 34 项、`tools/helpers.test.mjs` 55 项、
  `tools/client-bin.test.mjs` 46 项、`tools/pack-report.test.mjs` 6 项，合计 141 项全过。
- 实机 HTTP：见下表；回收站闭环 `trash → state → restore → state` 全绿，复原后
  `sizeBytes` 与移入前逐字节同值（24382）。
- 浏览器半：只做源码级取证（与 rc.3 同口径）。本会话沙箱禁止创建子进程，
  Playwright 报 `browserType.launch: spawn EPERM`，DOM 未实跑（见「取证局限」）。

## 实机证据（2026-11-18，端口 3082）

启动：`DSH_HOME=D:\dsh-session-purge\.probe-home dsh --profile web --no-open --port 3082 --host 127.0.0.1`
→ `dsh web: http://127.0.0.1:3082/?token=…`。

| 请求 | 结果 |
|---|---|
| `GET /session-purge/state` | 200，`persistence:true`，列出 10 个会话（id/title/cwd/sizeBytes） |
| `GET /session-purge/trash` | 200，`entries:[]`、`version:"0.5.10"`、settings 默认值 |
| `GET /session-purge/settings` | 200，`stats.lastSweepAt` 已刷新（boot sweep 跑过） |
| `POST /session-purge/sweep` | 200，`{"ok":true,"removed":0,"failed":[],"reason":"manual"}` |
| `POST /session-purge/restore`（不存在的 id） | 409 `{"ok":false,"code":"unknown"}` |
| `POST /session-purge/purge` / `delete`（不存在的 id） | 409 `code:"unknown"` |
| `POST /session-purge/empty`（`confirm` 缺失） | 400 `code:"bad-request"` |
| `POST /session-purge/undo` | 200 `{"ok":true}` |
| `GET /session-purge/restore`（方法不对） | 405，`allow:POST` |
| 跨源 `Origin: http://evil.example` | 403 `code:"origin"` |
| 未知路径 `/session-purge/nope` | 404 |

回收站闭环（真实会话 `session-0c3de1d1-5e92-4a75-afca-534cee0b0af7`，24382 B）：

1. `POST /session-purge/trash {"sessionId":"session-0c3de1d1-…"}` →
   `{"ok":true,"mode":"trashed","trashId":"t-20261118T114447-345fba","name":null}`。
2. `GET /session-purge/state` → 该 id 不在 `sessions` 列表，`trash.count = 1`。
3. `POST /session-purge/restore {"sessionId":"session-0c3de1d1-…"}` →
   `{"ok":true,"restoredTo":"D:\\dsh-session-purge\\.probe-home\\sessions\\--D-deepseek-harness-.playwright-mcp-ws--\\session-0c3de1d1-…","wasArchived":false,"cwdMissing":false}`。
4. `GET /session-purge/state` → 会话回归，`sizeBytes` 仍 24382，`trash.count = 0`。

设置往返：`POST /settings {"retentionDays":7}` → `GET /settings` 读到 7 → 写回 30，
两次均 200。

## 取证局限

- **浏览器半未实跑**：与 rc.3 同一限制——本会话沙箱禁止 node 创建子进程，
  `browserType.launch: spawn EPERM`；菜单注入、设置导航图标、回收站面板的 DOM 行为仍只有
  源码级证据与 `client-bin.test.mjs` 的纯函数用例。
- 实机只覆盖 Host 面 8 条路由；「客户端 bundle 是否被 profile 正确下发」这一层由
  `client-bin.test.mjs` 与 rc.2 的实机记录覆盖，本轮未重跑。
- token 一次性（`GET /?token=…` 二次即 401），Host 路由本身不校验 token，故用 curl 直连
  `/session-purge/*` 不受影响。

## 复现命令

```sh
# 差异规模与契约面取证（读标签，不读工作树）
cd <deepseek-harness>
git diff --shortstat dsh-v0.2.2-rc.3..dsh-v0.2.2-rc.4
git log --oneline dsh-v0.2.2-rc.3..dsh-v0.2.2-rc.4
git diff --name-status dsh-v0.2.2-rc.3..dsh-v0.2.2-rc.4 | grep -v 'package\.json$'   # 期望 16 行
git diff --name-only dsh-v0.2.2-rc.3..dsh-v0.2.2-rc.4 \
  -- packages/host packages/session packages/core packages/workspace \
     packages/boot packages/api packages/client \
  | grep -v 'package.json$'   # 期望为空

# 插件回归（沙箱里 spawn 受限，逐文件直跑）
cd <本仓库>
node tools/trash.test.mjs
node tools/helpers.test.mjs
node tools/client-bin.test.mjs
node tools/pack-report.test.mjs

# 隔离实例 + Host 面实机
DSH_HOME=<本仓库>/.probe-home dsh --profile web --no-open --port 3082 --host 127.0.0.1
curl -s -H 'Origin: http://127.0.0.1:3082' http://127.0.0.1:3082/session-purge/state
```
