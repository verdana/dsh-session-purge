# dsh-session-purge

给 DeepSeek Harness (DSH) 的会话行菜单加上「删除会话」——和「重命名 / 分叉会话 /
归档会话」并列。上游的「归档」只是把会话从侧边栏隐藏，日志永远留在磁盘上；
这个插件做的是**真正删除**：把该会话的日志目录从磁盘上移除。

> 本项目 fork 自 `dsh-session-delete`（v0.4.0 起改名并独立维护）。
> 原版在这台机器上每次删除都会失败（会话其实没被删掉），本分支修掉了它并补上了
> POSIX 支持、更严的安全校验和发布流程。

## 安装

```sh
# npm（推荐）
dsh plugin --profile web add dsh-session-purge

# GitHub 仓库
dsh plugin --profile web add github:verdana/dsh-session-purge

# Release 预构建 tarball（免构建授权）
dsh plugin --profile web add <release-tarball-url>

# 本地开发：link: 是指向源码目录的链接，改完不用重装
dsh plugin --profile web add link:D:/deepseek-harness/dsh-session-purge
```

装完**重启 `dsh web`**（Host 侧插件只在启动时装载），然后 Ctrl+Shift+R 刷新页面。

升级与卸载：

```sh
dsh plugin --profile web update dsh-session-purge
dsh plugin --profile web remove dsh-session-purge
```

## 使用

鼠标悬停任意会话行 → 点 `⋯` → **删除会话**（红色）→ 弹窗里点「删除」确认。
完成后弹窗只剩一行结果：`已删除会话「<名称>」。`

删掉的目录就是 `~/.dsh/sessions/<workspace-dir>/<session-id>/` 整个目录，不可恢复。

**已归档的会话删不掉**：它们不在侧边栏，菜单里也就点不到。要删归档会话，先把它的 id
从 `~/.dsh/storages/workspace.json` 的 `archivedSessionIds` 里移出（重新显示后再删），
或者直接删磁盘目录。

## 说明

- **运行中的会话不能删。** 前端会禁用删除按钮，Host 侧还会再校验一次；请先停止该会话
  （或等它跑完）再来删。
- **删除前会二次确认**，且只删由持久层 `sessionPersistence.locate()` 定位到、并且文件名
  能证明是会话日志（`session[.vN].jsonl[.zstd]`）的目录——宁可拒绝，也不会删错目录。
- **删除后会自动归档**，侧边栏立即消失该行，不用手动刷新。
- **内存中常驻但已空闲的会话**：插件会先按官方 `AgentHandle.dispose()` 的顺序把它释放
  （flush → 释放 scope fiber → 从 agents/sessions 注册表摘除），再删日志。运行时内部结构
  不可用时，会退化成「重启后删除」队列（`$DSH_HOME/session-purge/pending.json`）。
- HTTP 路由（`/session-purge/*`）只接受同源请求；删除/撤销只接受 POST。
- 排查问题可设 `DSH_PURGE_DEBUG=1` 打开详细日志。`GET /session-purge/state` 会列出持久层
  当前认识的会话（id / 标题 / 大小 / 是否在内存 / 是否已归档），可用来核对「到底删掉没有」。

## 环境要求

- DSH（`dsh web` 能正常运行）
- 插件本身零依赖、零编译，Windows / Linux / macOS 同一份代码；测试覆盖三平台（CI 矩阵）

## 开发

```sh
npm test                       # 回归测试（快照取值 / 路径推导 / 字典一致性）
node tools/repro-delete.mjs    # 端到端：真实 JSONL 后端 + 真实日志副本跑完整删除链路
node tools/smoke-install.mjs ./dsh-session-purge.tgz   # 隔离 home 里装包冒烟

npm run release:check          # 发布前六道闸门 + tarball 清单，不发布
npm run release -- --smoke     # 真发布，并把发布的版本装进隔离 home 冒烟
```

上面几条都不会碰你的 `~/.dsh`（都用临时 `DSH_HOME`）。发布闸门与参数说明：
`node scripts/publish-npm.mjs --help`。

代码结构：

- `lib/index.js` — Host 半：`/session-purge/{state,delete,undo}` 路由与删除逻辑
- `client/client.js` — 浏览器半：会话行菜单注入 + 确认弹窗（React，无 JSX）
- `cordis.patch.yml` — bundle 补丁，把插件行插入 profile 合成树
- `scripts/publish-npm.mjs` — npm 发布流水线（默认只核查）
- `tools/` — 回归测试、端到端脚本、冒烟脚本、浏览器探针

MIT License.
