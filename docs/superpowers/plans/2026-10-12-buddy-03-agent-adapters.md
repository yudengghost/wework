# Buddy AgentAdapter 层 实施记录

> **性质说明：** 本文件是 Plan 3 的实施记录，不是事前计划。Plan 3 在本会话内紧接着 Plan 2 执行，
> 计划内容以设计文档第 6 节（能力映射矩阵）为准，这里只记录**实测得到的事实**与最终接口。

## 交付

| 文件 | 职责 |
| --- | --- |
| `src/adapters/events.ts` | 统一事件 `AgentEvent`、请求/结果类型、`AgentAdapter` 接口、`buildStdinPayload` |
| `src/adapters/buildArgs.ts` | Codex / Claude 的 argv 构造与权限模式映射（纯函数） |
| `src/adapters/parseCodexLine.ts` | `codex exec --json` 单行 → 统一事件（纯函数） |
| `src/adapters/parseClaudeLine.ts` | `claude -p --output-format stream-json` 单行 → 统一事件（纯函数） |
| `src/adapters/cliAgentAdapter.ts` | 把 CLI 后端统一成 `AgentAdapter`；`createCodexAdapter` / `createClaudeCodeAdapter` |

依赖方向：`adapters → launcher/process/domain`，不反向依赖 `room`/`employee`（由 `test/boundaries.test.ts` 强制）。

## 实测捕获的真实事件 schema

Codex（`codex exec --json ... -`）：

```
{"type":"thread.started","thread_id":"<uuid>"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"...","exit_code":0,"status":"completed"}}
{"type":"turn.completed","usage":{"input_tokens":76273,"cached_input_tokens":46592,"output_tokens":174,"reasoning_output_tokens":11}}
```

要点：Codex 在 print 模式下**不产生 token 级增量**，文本以完整 `agent_message` 出现；UI 的「流式」对 Codex 是逐条而非逐字。

Claude Code（`claude -p --output-format stream-json --verbose`）：

```
{"type":"system","subtype":"init","cwd":"...","session_id":"<uuid>","tools":[...],"mcp_servers":[...]}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"",...}]},"session_id":"..."}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}]},"session_id":"..."}
{"type":"result","subtype":"success","is_error":false,"result":"Hi","session_id":"...","total_cost_usd":0.0995,"usage":{...}}
```

要点：`system/init` 给 `session_id`；空 `thinking` 块必须丢弃，否则会产生空 reasoning 事件；`result` 带成本。

## 实测推翻的两个判断

1. **「Codex 在非 git 目录下也能直接跑」是错的。** 第一次误判的原因是我把测试目录建在
   `.scratch/notgit`，而它**嵌套在 Buddy 这个 git 仓库内部**，所以仍属「受信任目录」。
   在真正的非 git 目录（`%TEMP%\buddy-live-*`）下，codex 直接以退出码 1 失败：
   `Not inside a trusted directory and --skip-git-repo-check was not specified.`
   由于员工工作目录默认是 `<userData>/workspaces/<employeeId>`，**该标志是必需项**，不是可选项。
2. **提示词必须走 stdin，不能进 argv。** 这是 Plan 2 的结论在适配器层的落地：两个后端的
   argv 里只有标志位，自由文本（提示词 + 员工职责）全部经 `buildStdinPayload` 从 stdin 投递。

## 设计取舍

- **员工职责走 stdin 而非真 system prompt。** Claude 有 `--append-system-prompt[-file]`，Codex 侧要
  靠工作目录里的 `AGENTS.md`（会污染用户仓库）。为了两条后端共用一条路径、且不受 cmd.exe 改写，
  当前把职责包进 `<employee_role>` 块与用户消息一起投递。升级路径：Claude 换
  `--append-system-prompt-file`（写进员工 stateDir），Codex 换 `-c` 覆盖或显式注入 AGENTS.md。
- **续接会话不重复传 `--sandbox`**：`codex exec resume --help` 中没有该选项，会话沿用原策略。
- **`tool_use` / `tool_result` 的形状属推断**：本机未捕获到 Claude 的工具调用实例，按 Anthropic
  content block 约定实现，未知 block 类型一律忽略，CLI 升级不会打挂适配器。

## 验收标准与结果

1. 全量测试通过：**22 个测试文件 / 131 个测试**。
2. `npm run typecheck` 无错误。
3. 真机联调（`BUDDY_LIVE_TESTS=1`）通过：
   `ok=true exit=0 text="pong" sessionRef=01a12f68-... usage={"inputTokens":16637,"outputTokens":3}`，
   事件序列 `session,text,usage`。默认套件跳过该测试，保持确定性。

## 尚未覆盖

- 内置兜底员工（OpenAI 兼容 API + 工具循环）未实现。
- 审批冒泡（把 CLI 的权限申请转成房间内待确认项）未实现，当前仅由各自的 permission-mode 控制。
- Claude 侧真机联调未跑（需要有效的 Anthropic 凭据）；其解析由真实抓取的 fixture 覆盖。
