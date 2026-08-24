# dsh-session-delete

一个 DeepSeek Harness (DSH) 插件：给会话行菜单增加「删除会话」项（与
重命名 / 分叉会话 / 归档会话 并列），**永久删除**所选会话的全部磁盘记录
（`~/.dsh/sessions/.../<session-id>/`）。

上游 DSH 对会话只有「重命名 / 分叉 / 归档」——归档只是隐藏，数据永远留在
磁盘上。这个插件补上真正的删除。

## 入口

会话行菜单：鼠标悬停任意会话行 → 点 `⋯` → 「删除会话」（红色危险样式，
与工作区菜单的删除按钮同款）。确认弹窗两步操作。

> v0.3.0 起移除了侧边栏底部的删除面板，只保留菜单入口。已归档的会话不再
> 出现在侧边栏，如需删除归档会话，可从
> `~/.dsh/storages/workspace.json` 的 `archivedSessionIds` 里移出使其重新
> 显示，或直接删 `~/.dsh/sessions/<workspace-dir>/<session-id>/` 目录。

## 技术要点（菜单注入）

上游会话菜单项硬编码在 `dsh-client-ui-workspace` 里、没有扩展插槽；所有共享
UI 原语（primitives）种子模块被 `Object.freeze` 冻结，组件级猴子补丁赋值会
**静默失败**。因此 v0.2.1 改为 DOM 级注入：

- 捕获阶段 `document` click 监听：点会话行的 `⋯` 按钮时，沿 React fiber
  上溯到 `SessionNodeItem` 的 `node` prop 捕获会话 id（失败时退回
  aria-label 标题匹配）；
- `MutationObserver` 监听 body：当挂载的 `div[role=menu]` 恰好是
  「重命名/分叉会话/归档会话」三项时，克隆最后一项的 DOM 结构，替换图标与
  文案为「删除会话」并染成危险红，追加进菜单；
- 点击该项：派发 Escape 关闭上游菜单，再用独立的 `createRoot` 渲染确认
  弹窗（不依赖任何冻结模块）；
- 卸载/热更新时移除监听、观察器与注入的 DOM 节点。

## 安全设计

- 运行中或当前打开的会话禁止删除（前端禁用 + Host 侧二次校验）
- 只删除 `sessionPersistence.locate()` 定位到的会话日志目录，并校验目录名
  必须严格等于会话 ID（杜绝路径逃逸）
- HTTP 路由仅接受同源 POST 请求
- 两步确认（删除 → 红色确认按钮）后才执行
- 删除后自动归档，侧边栏即时隐藏该行

## 安装

```sh
dsh plugin --profile web add file:$HOME/Documents/dsh-session-delete
# 然后把 "dsh-session-delete" 加进 ~/.dsh/profiles/web/package.json
# 的 dsh.profile.bundles 数组，重启 dsh web。
# 注意：pnpm 对 file: 依赖是复制/硬链接部署——改完源码后需要把
# client/client.js 等文件同步到 ~/.dsh/profiles/web/node_modules/dsh-session-delete/
# （或重跑 pnpm install），HMR 会在下一次轮询时热更新浏览器端插件。
```

## 结构

- `lib/index.js` — Host 半：注册 `/session-delete/delete` POST 路由，执行删除
- `client/client.js` — 浏览器半：会话行菜单注入 + 确认弹窗（React，无 JSX）
- `cordis.patch.yml` — bundle 补丁，把插件行插入 profile 合成树

MIT License.
