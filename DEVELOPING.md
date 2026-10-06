# dsh-session-purge — 开发文档

面向维护者。终端用户请读 [README.md](./README.md)。

## 代码结构

- `lib/index.js` — Host 半：`/session-purge/{state,delete,undo}` 路由与删除逻辑
- `client/client.js` — 浏览器半：会话行菜单注入 + 确认弹窗（React，无 JSX）
- `cordis.patch.yml` — bundle 补丁，把插件行插入 profile 合成树
- `scripts/publish-npm.mjs` — npm 发布流水线（默认只核查）
- `tools/` — 回归测试、端到端脚本、冒烟脚本、浏览器探针

## 本地开发

用 `link:` 指向本仓库，改完不用重装：

```sh
dsh plugin --profile web add link:<本仓库绝对路径>
```

浏览器半原样加载，改完**刷新页面**；Host 半只在启动时装载，改完必须**重启
`dsh web`**。

## 测试

```sh
npm test                             # 回归测试
node tools/repro-delete.mjs          # 端到端：真实 JSONL 后端 + 真实日志副本
node tools/smoke-install.mjs ./x.tgz # 隔离 home 里装包冒烟
node tools/dialog-render-probe.mjs   # 真实 React + 真实主题渲染弹窗，核对配色
```

都不碰你的 `~/.dsh`（用临时 `DSH_HOME`）。最后一条需要 DSH 源码树（取 React 与
主题 CSS），不需要起服务；源码树不在默认位置时用 `DSH_REPO` 指定。

两条容易踩的规矩：

- **改菜单识别逻辑，必须同步更新 `tools/helpers.test.mjs` 里的标签 fixture**。
  那些标签是从真实渲染抓下来的，fixture 不跟着改，测试会在上游真变了的时候给假绿。
- **改弹窗配色或变体类名，跑一次 `dialog-render-probe.mjs`**。静态断言看不出
  `var()` 究竟解析成什么颜色。

## 发布

```sh
npm run release:check                     # 六道闸门 + tarball 清单，不发布
npm run release -- --bump patch --smoke   # 真发布并冒烟
```

**版本号归发布脚本管**（`--bump` 会跑 `npm version`、提交、打 tag）。特性提交里
不要手工改 `package.json` 的 version。参数说明：`node scripts/publish-npm.mjs --help`。

## 跨版本兼容

浏览器半靠 DOM 嗅探会话行菜单（上游没有可用扩展点），菜单形状是唯一需要随版本走
的部分：

| | 0.1.5-rc.3 | 0.1.7-rc.2 及以后 |
|---|---|---|
| 菜单项 | 重命名 / 分叉会话 / 归档会话 | 置顶会话 + 上面三项，后面可能还有插件行 |
| 按钮文本 | 纯标签 | 标签 + 快捷键键帽（`aria-hidden` 的 `<span>`） |
| 行组件 props | `onFork` / `onArchive` | 已移除（动作走 slot）；`onOpen` / `onRenameRequest` 仍在 |

插件按「内置三项作为有序子序列」识别菜单（不要求恰好三项），按 `aria-hidden` 过滤
键帽，把「删除会话」插在「归档会话」之后。多出来的置顶行和插件行都不影响它。上游再
改菜单形状时，`tools/helpers.test.mjs` 是最先该失败的地方。

### 依赖的上游内部面（无 API 保证）

下面这些**实测可用但上游不算兼容契约**——出问题先查这里。`tools/helpers.test.mjs`
钉住了调用形状：

| 依赖 | 上游现状 | 失效表现 |
|---|---|---|
| `sessionPersistence.locate()` | `JsonlSessionPersistence` 上的 TS `private`（运行时可达） | `unsupported`，拒绝删除 |
| `agents.store` / `detachEntered`、`sessions.store` / `detachEntered` | TS `private` | 降级 `held` → 排进重启后删除队列 |
| `agent.phase.kind` | TS `private`，**不在公开 `Agent` 接口上** | 无法区分 idle / maintenance |
| `agent.scope.dispose()` | 类字段 public，不在 `Agent` 接口上 | 走不到安全释放 → 降级队列 |
| `ctx.get('dshHomePath')` | 值是**函数**，不是字符串 | 探测永不命中（见下） |

刻意保留的两处取舍：

- **`dshHomePath` 探测不会命中**：它是函数，`typeof === 'string'` 必然不成立，家目录
  于是按 `$DSH_HOME` → `~/.dsh` 解析。**harness home 取默认值或由 `DSH_HOME` 指定时
  结果完全一致**；只有「显式配置路径」把 home 挪走时，重启后删除队列才会写到错位置
  （立即删除不受影响）。
- **`detachEntered` 绕过 `enter()` 的 announce 延迟**：直接调私有 `detachEntered` 会
  跳过「创建派发未结束时延后移除」的保护，agent 侧在 `!entry.announced` 时也不发
  `agent/disposed`。所以这条路**只对严格 idle 的会话**开放（`agent.status` +
  `phase.kind` 双重闸门就是为此）。

### `/session-purge/state` 的语义

- `sessions[].title` 与删除响应的 `name` **恒为 null**：`SessionHeader` 没有 `title`
  字段，标题是 `dsh-session-title` 写的**事件**，不在持久层元数据里。界面上的标题是
  插件从 DOM 行上抓的；直接 curl 这个接口时不要指望有标题。
- `sessions[].archived` 读**注册表级** `workspaceRegistry.archivedSessionIds`。曾误读
  成每个 `Workspace` 条目上的同名成员——那个成员不存在，于是该标志恒为 `false`。
