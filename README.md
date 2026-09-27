# dsh-session-purge

给 DeepSeek Harness (DSH) 的会话行菜单加上**删除会话**，和「重命名 / 分叉会话 /
归档会话」并列。

上游的「归档」只是把会话从侧边栏隐藏，日志永远留在磁盘上；这个插件做的是
**真正删除**：把该会话的日志目录从磁盘上移除，不可恢复。

## 安装

```sh
# npm（推荐）
dsh plugin --profile web add dsh-session-purge

# GitHub 仓库
dsh plugin --profile web add github:verdana/dsh-session-purge

# Release 预构建 tarball（免构建授权）
dsh plugin --profile web add <release-tarball-url>
```

装完**重启 `dsh web`**（Host 侧插件只在启动时装载），然后按 Ctrl+Shift+R 刷新页面。

升级与卸载：

```sh
dsh plugin --profile web update dsh-session-purge
dsh plugin --profile web remove dsh-session-purge
```

## 使用

鼠标悬停任意会话行 → 点 `⋯` → **删除会话**（红色）→ 弹窗里点「删除」确认。
完成后弹窗只留一行结果：`已删除会话「<名称>」。`

删除后侧边栏立即消失该行，不用手动刷新。

## 需要知道的

- **不可恢复。** 删掉的是整个会话目录（`~/.dsh/sessions/<工作区>/<会话 id>/`），
  删除前会二次确认，确认之后没有撤销。
- **运行中的会话删不掉。** 删除按钮会置灰并给出提示；Host 侧还会再校验一次。
  先停止该会话（或等它跑完）再来删。
- **已归档的会话在侧边栏里看不到**，菜单自然也点不到。想删的话先把它取消归档，
  或者直接删磁盘上的会话目录。
- **恰好开着的空闲会话**：插件会先安全释放它再删日志。如果当时无法安全释放
  （运行时正在收尾等），会排进「重启后删除」队列，下次启动 `dsh web` 时执行。
- **只删能证明身份的目录。** 插件只删由会话持久层定位到、并且文件名确实是会话日志
  （`session[.vN].jsonl[.zstd]`）的目录；宁可拒绝，也不会删错目录。

## 排查

- 看不到「删除会话」菜单项，先确认插件装上了、`dsh web` 重启过、页面也刷新过
  （Ctrl+Shift+R）。菜单里只要出现「重命名 / 分叉会话 / 归档会话」，插件就应该
  在「归档会话」下面插入「删除会话」。
- 想确认某个会话**到底删掉没有**，用 `/session-purge/state`：

  ```sh
  curl http://127.0.0.1:<端口>/session-purge/state
  ```

  它列出持久层当前认识的会话（id / 标题 / 大小 / 是否在内存 / 是否已归档），
  以及 `held`（在内存里）和 `pending`（排队重启后删除）。
- 详细日志：启动 `dsh web` 时带上 `DSH_PURGE_DEBUG=1`。

## 环境要求

- DSH，`dsh web` 能正常运行。**0.1.5-rc.3 和 0.1.7-rc.2 都已验证支持。**
- 零依赖、零编译，Windows / Linux / macOS 同一份代码。

## 开发

开发、测试与发布流程见 [DEVELOPING.md](./DEVELOPING.md)。

MIT License.
