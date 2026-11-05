# dsh-session-purge × DSH 0.2.2-rc.1 兼容性核查

日期：2026-11-06（同日增补：alpha.3 遗留的两处视觉回归已落码修复）
插件：`dsh-session-purge@0.5.7`（npm `latest` 同版本）
目标 DSH：`0.2.2-rc.1`（标签 `dsh-v0.2.2-rc.1`；npm `latest` / `next` 双通道）
基线：`0.2.2-alpha.3`（0.2.2 系列的首份核查；其报告已并入本文，不再单独保留）

## 结论

**rc.1 相对 alpha.3 源码零改动，alpha.3 的全部结论原样继承；无新 BREAKING、无新回归。**

`alpha.3 → rc.1` 仅 4 个提交、387 个文件，且**全部是 `package.json` 版本号**（±387 行，一行不多）：

- `release(dsh): 0.2.2-rc.1`：根包与所有 workspace 包 `0.2.2-alpha.3 → 0.2.2-rc.1`
- `release(vendor)`：vendor 九包从 alpha 预发布号转正——cordis `4.0.6-alpha.2 → 4.1.0`、
  cosmokit `1.8.7-alpha.2 → 1.9.0`、schemastery `3.18.6-alpha.2 → 3.19.0`、
  loader / hmr / include / logger-console / group / timer `→ 1.1.0 / 1.2.0` 等。
  **vendor 目录内除版本号外无任何源码 diff**——所谓"升级"只是把 alpha.3 时已包含的
  同一份代码换成稳定版本号。

因此 alpha.3 实机验证的结论（26 项宿主断言、138/138 回归测试、复原 sha256 逐字节一致、
两种入口模式）对 rc.1 **逐字有效**，无需重跑隔离实例。

## 三项核查结果

### 1. 版本号引用

| 检查点 | 结果 |
|---|---|
| 根包 / `apps/web` / 各 workspace 包 `version` | 均已更新为 `0.2.2-rc.1`，一致 |
| 源码内残留 `alpha.3` 引用 | 无（grep 命中的三处均为历史测试 fixture 与历史发布清单，与 0.2.2 无关） |
| 根 `engines.node` | `>=24.9.0`，与 alpha.3 相同 |
| npm 发布 | `0.2.2-rc.1` 已发布；**dist-tags：`latest` = `next` = `0.2.2-rc.1`**（`alpha` 仍指 alpha.3） |

### 2. 模块接口 / 依赖兼容

与 alpha.3 逐项相同（diff 为空即证）：

- 会话菜单 DOM（`itemWrap > button[role=menuitem]`、序列匹配锚点）：不变
- `core/session` 的 `sessions.list/get/store.get/detachEntered/flush`：不变
- `agents.*`、`sessionPersistence.locate()`、`dshHomePath` 等插件依赖的"无 API 保证"内部面：不变
- `ui-context-menu` / `settings.section.icon` 新扩展点：仍在，仍未使用（迁移机会保留）

### 3. 配置文件 / 数据格式

无变化。持久层条目结构、`.jsonl` / `.jsonl.zstd` 文件名约定均与 alpha.3 相同，
`LOG_FILENAME_RE` 匹配不受影响。

## 问题清单（按严重程度排序）

alpha.3 → rc.1 **没有产生任何新代码问题**；下面全部是 alpha.3 遗留项：

| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| 1 | **中** | npm `latest` 已指向 `0.2.2-rc.1`：走 `latest` 更新的用户会拿到 0.2.2，**必须先升 Node ≥ 24.9**（engines 约束不变，但触发面从 alpha 通道扩大到所有 `latest` 用户） | alpha.3 已记录，本轮升级为分发面事实 |
| 2 | **中** | 会话行菜单「移入回收站」图标消失、标签左移 20px——`client.js` 删除克隆内全部 `[aria-hidden="true"]` 元素，0.2.2 的 `span.itemIcon` 图标容器被一并删除 | **已修复**（见下节） |
| 3 | **中** | 设置导航「回收站」齿轮+垃圾桶双图标——CSS 隐藏规则只匹配 `> svg`，不匹配 0.2.2 的 `span.navIcon` 包裹结构 | **已修复**（见下节） |
| 4 | **低** | 插件 `engines: ^22.19.0 \|\| >=24.0.0` 与 DSH 的 `>=24.9.0` 兼容，无需改；仅文档口径需把 0.2.2 的 Node 门槛写清楚 | 文档未更新（DEVELOPING.md 兼容表尚未加 0.2.2 列） |
| 5 | **低** | 迁移机会：改用 `ctx.contextMenus.register({target:'session'})` 与 `settings.section.icon` 槽位，可根治 #2/#3 这类 DOM 嗅探回归 | 排期待定 |

**已解决的原有遗留项：#2 与 #3（2026-11-06 落码）。**

## 本轮落码修复

两处都在 `client/client.js`，均**不按版本分支**——旧版 DSH 的 DOM 结构仍被原有规则覆盖：

1. **菜单图标**（克隆键帽清理）：只删不含 svg 的 `aria-hidden` 元素。0.1.x 的快捷键键帽
   （纯 `<kbd>` 文本）照删，0.2.2 的 `span.itemIcon`（内含 svg）保留，图标不再丢失、对齐恢复。

   ```js
   var keycaps = clone.querySelectorAll('[aria-hidden="true"]');
   for (var c = 0; c < keycaps.length; c++) {
       if (keycaps[c].querySelector && keycaps[c].querySelector("svg") !== null) continue;
       keycaps[c].remove();
   }
   ```

2. **设置导航双图标**：隐藏规则从"直挂 svg"放宽到同时匹配 `span[aria-hidden="true"]` 图标容器。

   ```css
   [data-sd-settings-nav="trash"] > svg,
   [data-sd-settings-nav="trash"] > span[aria-hidden="true"] { display:none }
   ```

落码后 `npm test` **138/138 通过**。alpha.3 报告中的实机视觉验证（菜单图标与对齐、设置导航
单图标）依赖这两处修复，下个版本的实机核查应复核这两处。

## 本轮验证

- `git diff dsh-v0.2.2-alpha.3..dsh-v0.2.2-rc.1` 全量核对：387 个文件全部为 manifest 版本行
- 插件回归测试 `npm test`：**138/138 通过**
- 未重跑隔离实例——源码与 alpha.3 逐字节相同（仅版本号差异），alpha.3 的 26 项宿主断言
  与浏览器侧验证结论直接继承

## 后续建议

1. ~~落码修 #2/#3~~ **已完成**（见上节，待实机复核视觉效果）
2. 更新文档口径：DEVELOPING.md 兼容表加 0.2.2 列（含 Node ≥ 24.9 门槛）、README「已验证版本」段
   补 0.2.2-rc.1、CHANGELOG 记一条
3. `contextMenus` / `settings.section.icon` 迁移单独立项评估，不与本次修复混做

## 复现命令

```powershell
# 差异核对
git -C D:\deepseek-harness diff --stat dsh-v0.2.2-alpha.3..dsh-v0.2.2-rc.1

# 插件回归测试
npm test

# 如需实机复验（与 alpha.3 完全同一套流程，仅换包版本）
$env:DSH_HOME = 'D:\dsh-session-purge\.compat-run\home-alpha3'
$env:HTTP_PROXY = ''; $env:HTTPS_PROXY = ''; $env:NO_PROXY = '127.0.0.1,localhost,::1'
$n26  = 'C:\Users\Verdana\scoop\apps\nodejs\26.13.0\node.exe'
$bin  = 'D:\dsh-session-purge\.compat-run\dsh-0.2.2-alpha.3\node_modules\@deepseek-ai\dsh\lib\bin.js'
& $n26 $bin web --no-open --port 3182 --host 127.0.0.1
```

> 验证脚本在 `.compat-run/`（已 gitignore），不随包发布。
