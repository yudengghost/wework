# Buddy

本地多 Agent 协作桌面应用。创建多个「Agent 员工」，在应用内自建的房间里跟它们单聊或群聊，用 `@` 指派任务；员工是真实具备执行能力的 agent（读写文件、跑命令），不只是对话。

员工后端优先复用你本机已装的 CLI：

- **Codex CLI**（`codex exec --json`）
- **Claude Code**（`claude -p --output-format stream-json`）

两者都不需要你配置密钥：直接用你本机 CLI 已有的登录。

## 运行

```powershell
npm install          # 首次
npm run app          # 构建并启动
```

或者直接双击仓库根目录的 `Buddy.cmd`。

> **关于 Electron 运行时**：npm 11 默认会拦截依赖的安装脚本，导致 Electron 的二进制没被解开，
> 表现为启动时报找不到 Electron。`Buddy.cmd` 会自动检测并从本地缓存补上这一步；
> 如果你用 `npm run app` 直接启动，遇到该问题时手动执行一次：
> `node node_modules/electron/install.js`

其它命令：

```powershell
npm test                        # 全部单测（默认跳过真机联调）
npm run typecheck               # 全仓类型检查
npm run build                   # 构建桌面应用产物
$env:BUDDY_LIVE_TESTS="1"; npm run test -w @buddy/core   # 真机联调（会真的调用 codex，消耗少量额度）
```

## 上手三步

1. **员工管理** → 新建员工：填名字（例如「小码」）、选框架（下拉里会显示「已就绪/未找到」）、选权限。
   同一个框架可以创建多名员工，彼此完全独立：各自的工作目录、会话、权限、人设。
2. **新建房间** → 输入房间名。新房间默认把当前所有员工拉进来。
3. 在房间里发消息，用 `@` 指派：

   ```
   @小码 把 README 里的错别字改一下
   @all 各自检查一下自己的模块
   ```

   被 @ 的员工会在自己的工作目录里干活，输出实时回流到房间。员工之间也可以互相 `@` 接力。

## 行为与安全

所有「拿不准」的策略都在**设置**里可改，默认值写在 `packages/core/src/config/schema.ts`：

| 设置 | 默认 | 含义 |
| --- | --- | --- |
| 员工 @ 员工 | 自动执行 | 员工在回复里 @ 同事时立刻接续干活 |
| 员工 @全体 | 需要我确认 | 员工想广播时先问你 |
| 你 @员工 | 自动执行 | 你 @ 谁谁立刻开始 |
| 同时运行上限 | 3 | 最多几个员工并行 |
| 每轮运行上限 | 5 | 你发一条消息最多触发几次运行 |
| @ 接续层数上限 | 3 | 防两个员工互相无限接力 |
| 重复消息去重窗口 | 5s | 同一条消息不会重复投递给同一员工 |
| 单次运行超时 | 10 分钟 | 超时自动终止（含子进程树） |

另外：

- 「停止全部」立刻中止所有排队与运行中的员工。每次运行都用 `AbortSignal` + 杀进程树，不会留下野进程。
- 权限按员工配置，映射到各框架原生机制：Codex 用 `--sandbox read-only|workspace-write|danger-full-access`，Claude 用 `--permission-mode manual|acceptEdits|bypassPermissions`。
- 员工默认在**自己的工作目录**里干活（`%APPDATA%\Buddy\data\workspaces\<员工名>`），不会动你的代码仓库，除非你把工作目录指过去。
- 应用不读取、不打包、不代持任何 CLI 凭证。

## 数据位置

```
%APPDATA%\Buddy\data\
  config.json          全局配置
  employees.json       员工档案
  rooms.json           房间
  rooms\<roomId>\messages.jsonl   房间消息
  workspaces\<员工名>\            员工工作目录
```

## 结构

```
packages/core/         纯 Node 核心，不依赖 Electron，可无头测试
  domain/              域模型与 id
  storage/             原子文件存储
  config/              全局配置：schema、默认值、合并、持久化
  employee/ room/      员工与房间存储、消息日志、@ 解析
  room/roomService.ts  房间调度器：投递、并发、预算、@链深度、去重、审批、停止
  launcher/            跨来源探测 codex/claude 可执行文件
  process/             流式子进程执行（逐行事件、超时、取消、杀进程树）
  adapters/            统一 AgentAdapter + Codex / Claude Code 实现
apps/desktop/          Electron 壳：主进程 + preload 桥 + React 界面
docs/superpowers/      设计文档与实施计划
```

依赖方向单向向下，`packages/core` 不允许 `import "electron"`，`adapters/`、`launcher/`、`process/` 不允许反向依赖 `room/`、`employee/`——这些由 `packages/core/test/boundaries.test.ts` 自动检查。

## 已知限制

- 内置兜底员工（无 CLI 时用 OpenAI 兼容接口）尚未实现；没有可用 CLI 时应用可运行但无法派活。
- Codex 在 print 模式下不产出 token 级增量，房间里是**逐条**刷新而不是逐字。
- Claude 的工具调用事件形状按 Anthropic content block 约定实现，本机未捕获到实例。
- 员工职责（人设）当前与提示词一起从 stdin 投递，而不是框架原生的 system prompt 通道。
- 尚未打包成安装程序。目前通过 `npm run app` / `Buddy.cmd` 启动。
