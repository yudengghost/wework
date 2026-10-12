# Buddy — 本地多 Agent 协作桌面应用 设计文档

日期：2026-10-12
状态：待用户评审

## 1. 目标

做一个 Windows 桌面应用，让用户创建多个「Agent 员工」，在应用内自建的房间里与员工单聊或群聊，用 `@` 指派任务。员工真实具备 agent 能力（读写文件、执行命令、跑工具），而不只是对话。

员工后端优先级：

1. 本地已安装的 Agent CLI（Codex CLI、Claude Code），复用用户自己的登录与额度；
2. 若都不可用，使用应用内置的兜底员工（OpenAI 兼容 API + 最小 agent loop）。

## 2. 非目标（本期不做）

- 不做服务端、不做账号体系、不做云端同步。所有数据留在本机。
- 不接入第三方通讯软件（Slack/Discord/微信等）。
- 不做终端仿真界面（PTY 交互式终端视图）。
- 不做跨平台（macOS/Linux）打包，但代码不写死 Windows 特性，为后续留口子。

## 3. 关键决策与理由

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 应用形态 | Electron + React + TypeScript | Windows 上子进程管理、打包生态最成熟；避免 Tauri/.NET 在 agent 生态上的重复造轮子 |
| 仓库组织 | npm workspaces 单仓多包 | npm 已就位，零额外工具依赖 |
| 核心位置 | `packages/core` 纯 Node 包，被 Electron 主进程进程内加载 | 核心不依赖 Electron/UI → 可用 vitest 无头测试；不引入 IPC 复杂度 |
| 与 CLI 的通话方式 | 非交互模式 + 管道 stdio + 结构化事件流 | `codex exec --json`、`claude -p --output-format stream-json` 足够；**不需要 PTY** |
| 原生模块 | MVP 零原生模块（不用 better-sqlite3 / node-pty） | 免去 Electron ABI 重建与 VS Build Tools 依赖，显著降低 Windows 上的构建失败率 |
| 存储 | 接口 + 文件实现（JSONL 消息日志 + JSON 配置） | 数据量级远未到需要 SQL；接口隔离使后续可换 SQLite 而不动上层 |
| 校验 | zod | 纯 JS、TS 类型推导好，配置/事件/协议统一用它 |

## 4. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│ apps/desktop                                            │
│  ├─ main      Electron 主进程（窗口/托盘/生命周期）      │
│  ├─ preload   contextBridge 暴露的类型化 IPC             │
│  └─ renderer  React UI：房间列表 / 对话 / 员工管理 / 设置 │
└───────────────────────┬─────────────────────────────────┘
                        │ 类型化 IPC（main ⇄ renderer）
┌───────────────────────┴─────────────────────────────────┐
│ packages/core（纯 Node，不 import electron）             │
│                                                          │
│  room/        房间、消息总线、@ 解析                     │
│  scheduler/   投递队列、并发闸、预算、@链深度、去重      │
│  employee/    员工档案（Profile）与生命周期              │
│  launcher/    启动器解析（探测 codex/claude/内置）       │
│  adapters/    AgentAdapter 接口 + codex/claude/builtin   │
│  storage/     接口 + 文件实现                            │
│  config/      全局配置 schema、默认值、合并、持久化      │
│  events/      进程内事件总线                             │
└─────────────────────────────────────────────────────────┘
```

## 5. 域模型

```ts
type EmployeeId = string;   // 稳定 id，如 "emp_7f3a"
type RoomId = string;
type MessageId = string;
type RunId = string;

interface Employee {
  id: EmployeeId;
  displayName: string;          // 房间内 @ 用这个名字，唯一
  framework: "codex" | "claude-code" | "builtin";
  workspaceDir: string;         // 该员工的工作目录（cwd）
  stateDir: string;             // 该框架的独立状态目录（会话/配置隔离）
  model?: string;               // 不填则用框架默认
  systemPrompt?: string;        // 员工人设 / 职责
  skills: string[];             // 技能白名单（映射到各框架原生机制）
  permissions: PermissionPolicy;
  sessionRef?: string;          // 该员工在当前工作目录下的会话 id（用于 resume）
  createdAt: string;
}

interface PermissionPolicy {
  mode: "read-only" | "workspace-write" | "full";
  allowedTools?: string[];      // 传给框架的白名单
  disallowedTools?: string[];
  requireApprovalFor: string[]; // 触发审批的动作类别，如 ["shell", "write-outside-workspace"]
}

interface Room {
  id: RoomId;
  name: string;
  memberIds: EmployeeId[];
  createdAt: string;
  policy?: Partial<RoomPolicy>; // 覆盖全局策略
}

interface Message {
  id: MessageId;
  roomId: RoomId;
  sender: { kind: "human" } | { kind: "employee"; employeeId: EmployeeId };
  mentions: Mention[];
  replyTo?: MessageId;
  body: string;
  attachments: Attachment[];
  kind: "chat" | "system" | "run-event";
  createdAt: string;
}

type Mention =
  | { kind: "employee"; employeeId: EmployeeId }
  | { kind: "all" };

type RunState =
  | { status: "queued" }
  | { status: "running"; startedAt: string }
  | { status: "awaiting-approval"; request: ApprovalRequest }
  | { status: "done"; endedAt: string }
  | { status: "failed"; error: string; endedAt: string }
  | { status: "cancelled"; endedAt: string };
```

## 6. 员工档案与能力映射

同一套员工配置要能落到不同框架的原生机制的**唯一翻译层就是适配器**。映射矩阵：

| 能力 | Codex | Claude Code | 内置兜底 |
| --- | --- | --- | --- |
| 非交互执行 | `codex exec --json` | `claude -p --output-format stream-json` | 直接调 API |
| 工作目录 | `-C <dir>` | 子进程 cwd | 子进程 cwd |
| 权限 | `--sandbox read-only\|workspace-write\|danger-full-access`，细节 `-c k=v` | `--permission-mode`、`--allowedTools`、`--disallowedTools` | 自研白名单 + 审批 |
| 提示词 | 工作目录内 `AGENTS.md`，或 `-c` 覆盖 | `--append-system-prompt[-file]` | 拼进 system message |
| 技能 | 技能目录 + `--enable/--disable <feature>` | `--plugin-dir`、`--mcp-config`、`--disable-slash-commands` | 工具注册表 |
| 会话续接 | `codex exec resume <sessionId>` | `--resume <id>` / `--session-id <uuid>` | 自存消息历史 |
| 状态隔离 | 每员工独立 `CODEX_HOME` | 每员工独立 `--settings` 文件 + 独立工作目录 | 无 |

**同框架多员工的实现方式**：同一份框架适配器被实例化多次，每个实例有独立 `stateDir` / `workspaceDir` / `sessionRef`。绝不依赖「不同的可执行文件」来区分员工。

## 7. 启动器解析（不写死路径）

`resolveLauncher(framework)` 按优先级链探测：

1. 全局配置中用户显式指定的可执行路径；
2. PATH：`where.exe codex` / `where.exe claude`；
3. 常见安装位置：`%APPDATA%\npm`、pnpm 目录、`%LOCALAPPDATA%\Programs`、scoop / chocolatey / winget links、`~/.local/bin`；
4. 可选：WSL（`wsl.exe -e bash -lc "command -v claude"`），默认关闭，可在设置里开启；
5. 全部失败 → 返回 `not-found`，由 UI 引导手动指定。

Windows 约束：

- npm 全局安装产出的是 `.cmd` / `.ps1` 包装脚本，**不能**作为可执行文件拼字符串拉起。解析到包装脚本时，进一步解析到真实入口（`.exe` 或交给 `node` 执行），或使用 `cmd.exe /c` 且参数以数组形式传递。
- **禁止** `shell: true` 拼接命令字符串（注入风险）。
- 探测结果缓存，UI 提供「重新探测」。

设计原则：配置文件里存的是**用户的选择**，不是开发机的事实；所有默认值来自探测，不来自硬编码常量。

## 8. 房间与调度器

房间 = 消息总线 + 共享 transcript + 成员表。调度器职责：

- **投递**：消息解析出 mentions 后生成投递任务。`@员工` → 单投；`@all` → 广播给除发送者外的所有成员。
- **串行化**：每个员工一条 FIFO 队列，同一员工同时最多一个 run，避免会话状态互相踩。
- **并发闸**：全局 `maxConcurrentRuns`（默认 3）。
- **预算**：房间级 `maxRunsPerTurn`、`maxTotalRuns`、`tokenBudget`（能拿到用量时）、`wallClockBudgetMs`。超限暂停并转为待确认。
- **@ 链深度**：`maxMentionDepth`（默认 3）。A→B→C→D 到达上限即停止自动投递，转为待人工确认。
- **去重**：同一条消息对同一员工的重复投递丢弃；相同 (sender, body, target) 在短窗口内视为重复。
- **人闸**：`mentionPolicy` 决定「员工 @ 员工」是自动执行还是需人工确认——**默认值来自全局配置**。
- **停止**：一键停止全部（取消所有排队与运行中的 run）。
- **审批**：适配器冒泡的审批请求进入房间，阻塞该员工队列直到人类响应。

## 9. 全局配置（所有拿不准的策略都可配）

配置文件位置：`<appDataDir>/config.json`（`appDataDir` 由宿主注入，core 不自己算路径）。

```jsonc
{
  "version": 1,
  "launchers": {
    "codex": { "executablePath": null, "detectWsl": false },
    "claude-code": { "executablePath": null, "detectWsl": false }
  },
  "scheduler": {
    "maxConcurrentRuns": 3,
    "maxRunsPerTurn": 5,
    "maxTotalRunsPerRoom": 50,
    "maxMentionDepth": 3,
    "dedupeWindowMs": 5000,
    "wallClockBudgetMs": 600000
  },
  "policy": {
    "employeeMentionsEmployee": "auto",   // "auto" | "confirm"
    "employeeMentionsAll": "confirm",     // "auto" | "confirm"
    "humanMentionsEmployee": "auto",
    "defaultPermissionMode": "workspace-write"
  },
  "builtinAgent": { "baseUrl": null, "apiKey": null, "model": null },
  "ui": { "language": "zh-CN", "showEmployeeThinking": false }
}
```

每一项都能在设置页改；`policy.employeeMentionsEmployee` 就是用户要求「员工 @ 员工是自动还是需确认」的开关。

## 10. 上下文投影

每个员工有自己框架内的会话，但房间有一份共享 transcript。运行时：

1. 取房间最近 N 条可见消息（`contextWindowMessages`，超出按 token 预算截断）；
2. 渲染成一段带发送者标注的文本块，标注为「房间记录」；
3. 与员工自己的 `systemPrompt`、`AGENTS.md` / `--append-system-prompt` 一起构成该次 run 的输入；
4. 员工的思考过程与工具调用细节默认**不进房间**，只进该员工自己的会话记录（受 `ui.showEmployeeThinking` 影响显示）。

## 11. 安全模型

- 每个员工的工作目录默认独立（`<appDataDir>/workspaces/<employeeId>`），可指向用户已有仓库。
- 员工默认 `workspace-write`；`full` 需要显式开启并在 UI 上标注风险。
- 需要审批的动作冒泡到房间，等待人类允许/拒绝；拒绝后把理由回灌给员工。
- 应用不读取、不打包、不代持 Codex / Claude Code 的凭证；一切走用户自己的登录。

## 12. 测试策略

- `packages/core` 全部用 vitest 单测，无头运行，不依赖 Electron。
- 进程层与适配器层用**假 CLI**（仓库内的 Node 脚本，输出与真实 CLI 同构的 JSONL）做集成测试，保证测试确定性；另设可选的真实 CLI 冒烟测试（环境变量开关）。
- 调度器用 `FakeAdapter` 覆盖：串行化、并发闸、预算、@链深度、去重、停止、审批阻塞。
- 包边界用 lint 规则强制：`packages/core` 不得 import `electron`；`adapters/` 不得 import `room/`。

## 13. 包边界约定（高内聚低耦合）

| 层 | 允许依赖 | 禁止依赖 |
| --- | --- | --- |
| `domain` | 无（叶子层：域模型与 id） | 其它所有层 |
| `storage` | 无 | 其它所有业务层 |
| `config` | `domain`/`storage` | `room`/`adapters` |
| `launcher` | `config` | `room`/`adapters` |
| `adapters` | `launcher`（仅执行用） | `room`/`scheduler`/UI |
| `room` | `storage` | `adapters`（通过接口） |
| `scheduler` | `room`/`config`/`adapters`（接口） | UI |
| `apps/desktop` | `core` | — |

依赖方向单向向下；跨层通信一律通过接口或事件，不允许反向 import。

## 14. 实现路线图

每个 plan 独立交付可运行、可测试的软件。

| # | Plan | 交付物 |
| --- | --- | --- |
| 1 | 基础骨架与核心契约 | monorepo 可构建；域类型、配置 schema/默认值/合并/持久化；事件总线；存储接口 + 文件实现；全量单测 |
| 2 | 启动器解析与进程执行层 | `resolveLauncher` 多来源探测；`ProcessRunner` 管道式流式事件、超时、杀进程树；用假 CLI 做集成测试 |
| 3 | AgentAdapter 三实现 | `AgentAdapter` 接口 + Codex / Claude Code / 内置兜底；统一流式事件；会话续接；审批冒泡 |
| 4 | 房间、消息总线与调度器 | @ 解析、投递队列、并发/预算/@链深度/去重/停止/审批；`FakeAdapter` 全量覆盖 |
| 5 | Electron 桌面壳与 UI | 窗口与 IPC 桥；房间列表与对话（@ 自动补全、流式）；员工创建向导；设置页；审批交互；Windows 打包 |

## 15. 后续可演进项（本期只留接口，不实现）

- 存储换 SQLite（仅替换 `storage/` 实现）。
- 员工工作目录改为每人独立 git worktree。
- PTY 交互式终端视图（需 node-pty，届时处理 Electron 重建）。
- macOS / Linux 打包。
- 房间记忆与检索。
