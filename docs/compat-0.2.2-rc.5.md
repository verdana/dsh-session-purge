# dsh-session-purge × DSH 0.2.2-rc.5 兼容性核查

日期：2026-11-19
插件：`dsh-session-purge@0.5.10`（本轮无产品代码改动，见 CHANGELOG「未发布」）
目标 DSH：`0.2.2-rc.5`（标签 `dsh-v0.2.2-rc.5`，`9c2670d3bc`，2026-11-18 17:45）
基线：`0.2.2-rc.4`（标签 `dsh-v0.2.2-rc.4`，`3f321d32bfe3`，2026-11-17 21:30）
取证方式：**源码级 diff（按 git 标签）+ 隔离实例实机**。2026-11-19 本机 CLI 已是
`0.2.2-rc.5`；在隔离 `DSH_HOME`（仓库下 `.probe-home`）里以 `link:` 装入本仓库起
`dsh --profile web`，Host 半全部路由与回收站闭环实跑（见「实机证据」）。

## 结论

**无兼容性阻断项。rc.5 只做了两件事，都不在插件的调用面上：网页搜索的默认提供方改为
按模型路由自动选择；设置页的搜索卡新增 Automatic 选项。**

`rc.4 → rc.5` 共 433 个文件、`+917 / −594`，去掉 `package.json` 后剩 53 个文件，全部落在
下面五处：

| 区域 | 文件 | 说明 |
|---|---|---|
| `packages/bundle/base` | `cordis.patch.yml`、`tests/base.spec.ts` | 删掉 `@deepseek-ai/dsh-web` 行的 `searchProvider: deepseek-search-api`（保留 `fetchProvider: http`），改由 dsh-web 自己按模型路由挑后端 |
| `packages/web/{web,tool-web,web-search-deepseek,web-deepseek-api}` | 8 个源文件 + README/测试 | `deepseek-official` / `deepseek-account` 路由改走 legacy Messages 搜索（`web-search-deepseek`，端点默认 `https://api.deepseek.com/anthropic/v1`，env `DEEPSEEK_API_KEY`）并追加 `web/deepseek-search-llm-request` 会话事件；其他路由仍用 `deepseek-search-api` |
| `packages/client/ui-settings-web-search` | `WebSearchCard.tsx`、`locales.ts`、`tests/card.client.spec.tsx` 等 6 个文件 | 搜索卡新增 Automatic（`AUTO_ID`）与 `searchAutoHint`（跟随当前会话的模型）；`providerLegacy` 文案改为「DeepSeek 服务端搜索」等 8 语言 |
| `docs/upgrade-guide/v0.2.2-rc.4/web-search-deepseek-model-default/` | `guide.md`、`guide.zh.md`、`guide.i18n.yaml` | rc.5 唯一新增的升级指引 |
| `docs/{config-catalog,subsystems/web}`、`.agents/notes`、`apps/web/tests`、`snapshots/session`、`packages/extensions/tool-cordis` | 其余约 30 个文件 | 文档同步、e2e 覆盖、会话快照 fixture、cordis 工具 API 清单 |

5 个 commit（`0f0cd323c4` test(liveshare): derive owner credential horizons from the real
clock、`6368d91027` 与 `f47a0a2b52` 两个 merge、`9bf478edde` release(dsh): 0.2.2-rc.5、
`9c2670d3bc` release merge）没有一条落在 Host / 会话 / 工作区 / 客户端壳层。

反向证明：对承载契约的包（`packages/host`、`packages/session`、`packages/core`、
`packages/workspace`、`packages/boot`、`packages/api`）做 `rc.4..rc.5` 的 diff →
**57 个文件，57 insertions / 57 deletions，逐文件只有 `package.json` 的一行版本号**。
`packages/client` 全树 77 个文件 `126 + / 95 −`：71 个是 `package.json`，剩下 6 个全在
`ui-settings-web-search`——设置页里另一张卡，插件与它没有任何交集（插件自己的设置段是
`ui-settings-general` 里的一行导航，见下文契约表）。因此 `docs/compat-0.2.2-rc.3.md` 里
16 项 Host 契约与 18 项浏览器契约的 **file:line 锚点全部继续有效**，本文不再逐行重复。

需要留意一处归属问题：`docs/upgrade-guide/v0.2.2-rc.4/` 下另有两份指引
（`forge-rate-limited-failure`、`workspace-write-boundary-follows-root`），但 `git log` 在
`rc.4..rc.5` 范围内对它们为空——它们是 rc.5 之前就落的，**不是本轮变化**（指引目录按
「变化发生前的那个版本」命名，容易误读）。这两份与插件也无关：插件不 import
`@deepseek-ai/dsh-experimental-forge`（不涉及 `ForgeFailure['code']` 的穷举 switch），
`lib/` 里也 grep 不到 `workspaceChanges` / `sandboxPolicy` / `workspaceRoot`。

三处既有事项原样继承，rc.5 没有加重任何一处（详见 rc.3 文档「问题清单」）：

1. `agents.enter()` 只收一个参数，回滚分支读到的 `AgentEntry.owner` 恒 `undefined`（低）。
2. `unarchiveSession` 的 `workspace/session-unarchiving` 钩子无 `try/catch`（中·条件）。
3. 非中英界面功能失效；`contextMenus.register` / `settings.section.icon` 迁移未做（既有）。

## 核查方法

- 差异规模：`git diff --shortstat dsh-v0.2.2-rc.4..dsh-v0.2.2-rc.5` → 433 files，
  `917 insertions(+)`，`594 deletions(-)`；`git log --oneline` → 5 个 commit。
- 过滤版本号：`git diff --name-status … | grep -v 'package\.json$'` → 53 行（上表）。
- 契约面：`git diff --shortstat … -- packages/host packages/session packages/core
  packages/workspace packages/boot packages/api` → 57 files，57 insertions / 57 deletions
  （全是版本号）；`packages/client` → 77 files，126 / 95，源码 hunk 只在
  `ui-settings-web-search`。
- 升级指引归属：`git log --oneline rc.4..rc.5 -- docs/upgrade-guide/…` 只有
  `web-search-deepseek-model-default`；另两份为空。
- 实机：`DSH_HOME=D:\dsh-session-purge\.probe-home`、`dsh --profile web --no-open
  --port 3084 --host 127.0.0.1`，profile 的 bundles 仍是
  `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` / `dsh-session-purge`，
  `patchReload: live`，插件用 `link:D:\dsh-session-purge` 装入。

## 契约复核（本轮实测点）

| # | 契约 | rc.5 证据 | 判定 |
|---|---|---|---|
| 1 | `webServer.register` 形状（5 处调用，`lib/index.js:1998/2034/2076/2135/2200`） | `packages/host` 全树仅 `package.json`；实机 9 条路由全部就位，405/403/409/400 守卫也对 | 不变 |
| 2 | `sessionPersistence` 注入 + `locate()`（`lib/index.js:1977`） | `packages/session` 仅 `package.json`；`GET /state` 返回 `"persistence":true` | 不变 |
| 3 | 会话格式版本 4 与落盘布局 | `packages/core`、`session-persistence-jsonl` 仅 `package.json`；probe home 的会话仍能盘点/移入/复原，复原后 `sizeBytes` 逐字节同值 | 不变 |
| 4 | `workspaceRegistry` / `archiveSession` / `unarchiveSession` | `packages/workspace` 仅 `package.json`；`restore` 回 `wasArchived:false`、`cwdMissing:false` | 不变 |
| 5 | profile + `cordis.patch.yml`（`- insert:`）合成 | `packages/boot/app-boot` 仅 `package.json`；**base patch 删掉的 `searchProvider` 与插件无关**——插件 patch 只有 `- insert: - id: session-purge`，不锚定任何 config 键；实机 profile web 起得来、路由全在 | 不变 |
| 6 | 客户端插件加载 / `client/modules` | `packages/client/modules` 仅 `package.json`；实机 shell 预载 `plugins/??…dsh-session-purge/client.js`，取回 200 | 不变 |
| 7 | `ctx.get('dshHomePath')` 是函数（`lib/index.js:156`） | 实机 `trash`/`restore` 均落到 `<DSH_HOME>/session-purge/…` 与 `sessions/…` | 不变 |
| 8 | 浏览器设置导航锚点（`ui-settings-general` 的 `span.navIcon`） | rc.5 未动 `ui-settings-general` / `ui-primitives` / `ui-sidebar` / `ui-layout` / `locale`；插件自己的 `SETTINGS_NAV_ATTR="data-sd-settings-nav"` 打在导航行上 | 不变 |
| 9 | 平台 seed word `@deepseek-ai/dsh-client-ui-primitives`（`client/client.js:16`） | 实机 shell 仍预载 `ui-primitives` | 不变 |

## 问题清单

| 严重度 | 问题 | 状态 |
|---|---|---|
| 低（rc.2 起） | `agents.enter()` 单参 → `AgentEntry.owner` 恒 `undefined`（`lib/index.js:743`） | rc.5 未改；不抛错，判定交上游 |
| 中·条件（rc.2 起） | `unarchiveSession` 钩子无 `try/catch` → 监听器抛错会「复原成功但仍归档」 | rc.5 未改；插件侧已包 try/catch |
| 低（既有） | 非中英界面功能失效；`contextMenus.register` / `settings.section.icon` 迁移 | 与 rc.5 无关 |
| 无新增 | rc.5 的改动（搜索后端路由、设置卡 Automatic、文档/快照）不在插件调用面上 | — |

## 本轮落码修复

产品代码零改动；只修了测试收尾，并纠正了 rc.4 文档里对它的误诊。

- 现象：`tools/trash.test.mjs` 的 `after` 钩子在本机恒报
  `Error: ENOTEMPTY: directory not empty, rmdir '…\session-purge\trash'`（进程仍 `exit 0`）。
- rc.4 文档当时归因为「boot sweep 竞态」（`void runBootMaintenance(ctx)` 在 `rm` 之后写
  `trash/.state.json`），并据此加了 10×20ms 重试——**该归因不成立**，实测 40×40ms 仍失败。
- 真正根因：两个拒绝用例在回收站里用
  `symlink(outside, join(bin, trashId), 'junction')`（`tools/trash.test.mjs:689`、`:725`）
  造 Windows junction。`rm(home, { recursive: true, force: true })` 会顺着 junction 走进
  `<home>/outside` 去删，随后对 `trash` 目录 `rmdir` 报 `ENOTEMPTY`；重试多少次都不会好
  （MSYS 的 `rm -rf` 把 junction 当链接摘掉，所以手工能删干净）。
- 修复：`removeHome` 改为自底向上遍历，`entry.isSymbolicLink()` 的项用 `rmdir(path)` 摘链
  （失败再 fallback `rm(path, { force: true })`），目录入栈，最后整体
  `rm(home, { recursive: true, force: true })`；import 行补 `rmdir`。
- 修复后 `node tools/trash.test.mjs` 连跑 3 次均 `pass 34 / fail 0`，无 ENOTEMPTY。

## 本轮验证

- 差异取证：见「核查方法」。标签必须读 git tag，不读工作树（工作树 HEAD 是
  `2e39e70496` 的 master，含 rc.5 之后的合并提交）。
- 单测（沙箱禁止 `node --test` 的 spawn，逐文件直跑）：
  `node tools/trash.test.mjs` 34 项、`tools/helpers.test.mjs` 55 项、
  `tools/client-bin.test.mjs` 46 项、`tools/pack-report.test.mjs` 6 项，合计 141 项全过。
- 实机 HTTP：见下表；回收站闭环 `delete → state → restore → state` 全绿，复原后
  `sizeBytes` 与移入前逐字节同值（24382）。
- 客户端 bundle：带 token 取 `/` 得 200、`shell.html` 41239 字节，预载
  `plugins/??…dsh-session-purge/client.js&rev=7fe67247014e`；直接取该 URL 得 200、
  168610 字节（本地 `client/client.js` 168536 字节，差 74 字节是 loader 包装），首行为
  `window.__ModuleLoader__.load({ id: "dsh-session-purge", factory: (require) => {`。
- 浏览器半：只做源码级取证（与 rc.3/rc.4 同口径，见「取证局限」）。

## 实机证据（2026-11-19，端口 3084）

启动：`DSH_HOME=D:\dsh-session-purge\.probe-home dsh --profile web --no-open --port 3084 --host 127.0.0.1`
→ `dsh web: http://127.0.0.1:3084/?token=…`。

| 请求 | 结果 |
|---|---|
| `GET /session-purge/state` | 200，keys `ok/held/pending/persistence/sessions/trash/settings`，`persistence:true`，10 个会话 |
| `GET /session-purge/trash` | 200，keys `ok/version/entries/totalBytes/settings/sweep` |
| `GET /session-purge/settings` | 200，`version:"0.5.10"`，settings 六项、stats 四项齐全 |
| `POST /session-purge/state` | 405，`allow: GET` |
| `POST /session-purge/delete`（非 POST 的读取） | 405，`allow: POST` |
| `POST /delete {sessionId:42}` | 400 `{ok:false,code:"invalid"}` |
| `POST /delete` / `restore` / `purge`（不存在 id） | 409 `code:"unknown"` |
| `POST /delete`（`Origin: http://evil.example`） | 403 `code:"origin"` |
| `POST /empty {confirm:false}` | 400 `{code:"bad-request",error:"confirm must be true"}` |
| `POST /sweep` | 200 |
| 未知路径 `/session-purge/nope` | 404 |

回收站闭环（真实会话 `session-0c3de1d1-5e92-4a75-afca-534cee0b0af7`，24382 B）：

1. `POST /delete {"sessionId":"session-0c3de1d1-…","title":"probe-rc5"}` →
   `{"ok":true,"mode":"trashed","trashId":"t-20261119T050858-7e32f6","name":"probe-rc5"}`。
2. `GET /state` → 该 id 不在 `sessions`（`held` 不是回收站清单，需读 `/trash`）。
3. `POST /restore` 同 id →
   `{"ok":true,"restoredTo":"D:\\dsh-session-purge\\.probe-home\\sessions\\--D-deepseek-harness-.playwright-mcp-ws--\\session-0c3de1d1-…","wasArchived":false,"cwdMissing":false}`。
4. `GET /state` → 会话回归，`sizeBytes` 仍 24382。

补充语义（非缺陷，写入文档避免下次误判）：`POST /undo` 只把 id 从 `pending` 队列里移除
（`lib/index.js:2205` 起：`readPending` → `writePending(filter)` → `console.log('[session-purge] unqueued', id)`），
**不是「撤销删除」**；对不在队列里的 id 返回 200 `{ok:true}` 是幂等空操作。

## 取证局限

- **浏览器半未实跑**：本会话沙箱禁止浏览器子进程与 mojo。Chrome headless 报
  `crashpad_client_win.cc:431 OpenProcess: 拒绝访问 (0x5)` → `crash server failed to launch`；
  加 `--disable-breakpad --no-sandbox` 后改报
  `mojo/public/cpp/platform/platform_channel.cc:112 Check failed: . : 拒绝访问 (0x5)`，进程
  `exit 4294930433`。菜单注入、设置导航图标、回收站面板的 DOM 行为仍只有源码级证据与
  `client-bin.test.mjs` 的纯函数用例。
- 实机只覆盖 Host 面 9 条路由；客户端 bundle 是否被 profile 正确下发，本轮用「shell 预载
  URL + 取回字节数」验证到下发层，DOM 渲染未验。
- token 一次性（`GET /?token=…` 二次即 401），Host 路由本身不校验 token，故用 curl 直连
  `/session-purge/*` 不受影响。

## 复现命令

```sh
# 差异规模与契约面取证（读标签，不读工作树）
cd <deepseek-harness>
git diff --shortstat dsh-v0.2.2-rc.4..dsh-v0.2.2-rc.5      # 433 files, 917+/594-
git log --oneline dsh-v0.2.2-rc.4..dsh-v0.2.2-rc.5          # 5 commits
git diff --name-status dsh-v0.2.2-rc.4..dsh-v0.2.2-rc.5 | grep -v 'package\.json$'  # 期望 53 行
git diff --name-only dsh-v0.2.2-rc.4..dsh-v0.2.2-rc.5 \
  -- packages/host packages/session packages/core packages/workspace \
     packages/boot packages/api \
  | grep -v 'package.json$'                                 # 期望为空
git diff --name-only dsh-v0.2.2-rc.4..dsh-v0.2.2-rc.5 -- packages/client \
  | grep -v 'package.json$'                                 # 期望只剩 ui-settings-web-search(6)

# 插件回归（沙箱里 spawn 受限，逐文件直跑）
cd <本仓库>
node tools/trash.test.mjs
node tools/helpers.test.mjs
node tools/client-bin.test.mjs
node tools/pack-report.test.mjs

# 隔离实例 + Host 面实机
DSH_HOME=<本仓库>/.probe-home dsh --profile web --no-open --port 3084 --host 127.0.0.1
curl -s http://127.0.0.1:3084/session-purge/state | head -c 400
```
