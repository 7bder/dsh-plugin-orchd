# dsh-plugin-orchd

Read-only **orchd** panel for the DeepSeek Harness (DSH) **right sidebar**: open a project session and see that
project's task board, dependency graph, ideas and review timeline next to the conversation.
No project configuration — the plugin derives the project from the session.

把 [orchd](https://github.com/7bder/orchd-core) 的项目状态带进 DSH 右侧栏的**只读面板**：

> 点开一个项目会话，面板自动检测这个项目有没有用 orchd。
> 装了 → 同屏显示任务看板、依赖图、想法与审查时间线；没装 → 给一个接入入口。

**面板没有任何写操作**：`claim` / `done` / `review` / `merge` / `amend` 一律不出现在 UI 里。

---

## 面板内容

| 视图 | 内容 |
|---|---|
| **四态检测** | `未安装` / `未初始化` / `就绪` / `异常`，每种状态各自点名原因，不是一句「出错了」 |
| **看板** | 状态分布、待办 / 在途 / 终态，状态条即筛选器；关键词、筛选、排序；800+ 任务虚拟滚动 |
| **任务详情** | 目标、验收标准、验证命令、写范围、上游依赖与下游引用（可点跳转）、审查事件时间线 |
| **依赖图** | DAG：聚焦闭包 / 活跃子图 / 含终态全图；环、自依赖与悬空上游**显式标注**，不静默少画 |
| **想法（IDEAS）** | 只读想法看板：状态分组、归档任务对照、可复制的推进命令 |
| **接入入口** | 未安装的项目给两条路：复制命令自己跑，或让当前会话的 agent 去装（注入前先给你看文本） |

## 安装

```sh
# DSH 网页版（dsh web）
dsh plugin --profile web add github:7bder/dsh-plugin-orchd

# DSH Desktop：用应用自带的终端（欢迎页里那个），**不要**加 --profile
dsh plugin add github:7bder/dsh-plugin-orchd
```

Desktop 的 `desktop` profile 由应用托管：普通 `dsh plugin --profile desktop ...` 会被 CLI 直接拒（
`profile "desktop" is managed exclusively by the Electron application`），应用自带终端里不带 `--profile`
的命令才改得到它。装好后**重启 DSH**——宿主侧模块不热替换：会话 header 角落出现开关，右侧栏出现「orchd 任务」页。

> 被插件市场收录后可以直接在设置里搜索安装。npm 包（`dsh-plugin-orchd`）稍后发布。
> Release 页也挂了 tarball 资产，但那条路依赖 `github.com/release-assets`（在部分网络不稳），
> 且 pnpm 11 对「URL tarball」的 lockfile 完整性要求更严（可能报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`），
> 所以先用上面的源码装法；tarball 只作归档与手动备用。

## 前置条件

- **DSH** 提供右侧栏面板席位（`sidebarRightTabs` + `sidebar.right.pane.tab`，session 作用域）。
- **项目侧装了 orchd**（项目根或容器主工作树下有 `.orchd/`）。没装的话面板会给出接入入口，不会静默失败。
- **Python 3** 在 PATH 上（`python` / `py -3` / `python3` 依次探测，也可在配置里写死 `pythonPath`）——
  面板跑的是**项目自带的**引擎入口 `python <项目>/.orchd/__main__.py`，插件不自带、不安装引擎。

## 只读保证

这是硬约束，不是口号：

- 命令白名单 **fail-closed**：不在白名单里的子进程调用根本不 spawn，被拒时记一行结构化日志。
- 子进程环境**剥掉会话身份**，读命令不会带出任何会被引擎当成「有人在动这个任务」的变量。
- 不直读账本、不碰锁、不写项目文件；面板不做文件导出（诊断信息只复制到剪贴板）。
- 开发期在**真引擎、真账本、真 git 仓库**上跑只读冒烟：比对工作区文件哈希、账本事件数、`git status`，要求零变更。

## 配置

配置写进 profile 的 `cordis.patch.yml`（`- id: orchd-tasks` 那一行的 `config:` 下），全部有默认值：

| 键 | 默认 | 说明 |
|---|---|---|
| `pythonPath` | `null` | `null` = 自动探测 |
| `requestTimeoutMs` | `20000` | 单次引擎调用超时（超时与「引擎报错」在 UI 上是两种状态） |
| `cacheTtlMs` / `pollTtlMs` / `detectTtlMs` | `5000` / `30000` / `10000` | 看板 / 轮询 / 四态检测的缓存 TTL |
| `maxProjectContexts` | `8` | 每会话项目上下文的 LRU 上限 |
| `orchdCoreRepo` | `null` | 接入入口里展示的引擎仓库地址 |
| `allowRoots` | `[]` | 调试用白名单；空 = 不额外收敛 |

## HTTP API

面板的数据全部来自插件自己注册的 8 条同源路由（会话绑定，前端只传 `sessionId`，不传路径）：

```
GET  /orchd/api/context         四态 + 项目身份 + 诊断
GET  /orchd/api/board           状态条 + 任务列表
GET  /orchd/api/task            单任务详情（+ 审查时间线，按需）
GET  /orchd/api/graph           依赖图（节点 / 边 / 环 / 悬空）
GET  /orchd/api/history         审查事件时间线
GET  /orchd/api/ideas           想法看板
POST /orchd/api/install-entry   返回将要注入的文本（本身不注入）
POST /orchd/api/install-inject  执行注入（需显式确认）
```

前缀外的路径一律 404（fail-closed）。

## 卸载

```sh
dsh plugin --profile web remove dsh-plugin-orchd
```

已知残留：`remove` 之后 profile 的 `node_modules/` 里可能留一个空目录（包管理器行为），手工删掉即可，
不影响启动。

## 边界

面板**只跟当前会话的项目**，不做跨项目聚合、不做项目切换器（DSH 的 Workspace 分组已经是项目导航）；
不做实时推送（引擎没有常驻进程，用缓存 + 手动刷新）；不注册面向模型的工具。

## 许可

MIT。引擎本体见 [7bder/orchd-core](https://github.com/7bder/orchd-core)。
