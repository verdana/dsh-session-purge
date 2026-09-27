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

浏览器半是原样加载的，改完刷新页面即可；Host 半只在启动时装载，改完要重启 `dsh web`。

## 测试

```sh
npm test                       # 回归测试（快照取值 / 路径推导 / 菜单识别 / 字典一致性）
node tools/repro-delete.mjs    # 端到端：真实 JSONL 后端 + 真实日志副本跑完整删除链路
node tools/smoke-install.mjs ./dsh-session-purge.tgz   # 隔离 home 里装包冒烟
```

上面几条都不会碰你的 `~/.dsh`（都用临时 `DSH_HOME`）。

`tools/helpers.test.mjs` 里的菜单识别用例钉住的是从真实渲染里抓下来的标签集合，
两代各一份；**改 `client/client.js` 的菜单识别逻辑时，这两组 fixture 必须一起更新**，
否则测试会在真实上游变化时给出假绿。

## 发布

```sh
npm run release:check          # 发布前六道闸门 + tarball 清单，不发布
npm run release -- --bump patch --smoke   # 真发布，并把发布的版本装进隔离 home 冒烟
```

**版本号由发布脚本负责**：`publish-npm.mjs --bump <patch|minor|major|prepatch|x.y.z>`
会跑 `npm version`、提交、打 `v<版本>` tag，再由 `.github/workflows/release.yml`
把 tarball 挂到 GitHub Release。所以特性提交里不要手工改 `package.json` 的 version。

发布闸门与参数说明：`node scripts/publish-npm.mjs --help`。

## 跨版本兼容

Host 半只用两代都有的稳定面：`sessionPersistence.list()` + 后端的 `locate()`、
`workspaceRegistry`、`agents`/`sessions`/`jobs` 注册表。

浏览器半靠 DOM 嗅探会话行菜单（上游没有可用扩展点），所以菜单形状的假设是唯一
需要随版本走的部分：

| | 0.1.5-rc.3 | 0.1.7-rc.2 |
|---|---|---|
| 菜单项 | 重命名 / 分叉会话 / 归档会话 | 置顶会话 + 上面三项，后面可能还有插件行 |
| 按钮文本 | 纯标签 | 标签 + 快捷键键帽（`aria-hidden` 的 `<span>`） |
| 行组件 props | `onFork` / `onArchive` | 已移除，动作改走 slot 注册表 |

插件按「内置三项作为有序子序列」识别菜单（不要求恰好三项），按 `aria-hidden`
过滤掉键帽，并把「删除会话」插在「归档会话」之后，因此多出来的置顶行和插件行都
不会影响它。上游若再改菜单形状，`tools/helpers.test.mjs` 是最先应该失败的地方。
