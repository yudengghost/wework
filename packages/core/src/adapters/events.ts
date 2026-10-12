import type { PermissionPolicy } from "../domain/schema";
import type { Framework } from "../domain/schema";
import { defaultPromptPack, render, type PromptPack } from "../prompts/promptPack";

/** 适配器层对外暴露的统一事件。上层的房间/调度器只认这些事件，不认任何框架的私有格式。 */
export type AgentEvent =
  | { type: "session"; sessionRef: string }
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; name: string; detail?: string }
  | { type: "tool-result"; name?: string; ok: boolean; output?: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: "error"; message: string };

export interface AgentRunRequest {
  /** 提示词等自由文本。一律经 stdin 投递，绝不进 argv。 */
  prompt: string;
  /** 员工职责/人设。当前与 prompt 一起走 stdin，见 buildStdinPayload 的说明。 */
  systemPrompt?: string;
  cwd: string;
  model?: string;
  permissions: PermissionPolicy;
  /** 续接已有会话。 */
  sessionRef?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface AgentRunResult {
  framework: Framework;
  ok: boolean;
  exitCode: number | null;
  /** 本次运行产生的可见文本（按事件顺序拼接）。 */
  text: string;
  sessionRef?: string;
  usage?: AgentUsage;
  timedOut: boolean;
  cancelled: boolean;
  stderr: string;
}

export interface AgentAdapter {
  readonly framework: Framework;
  run(
    request: AgentRunRequest,
    onEvent?: (event: AgentEvent) => void,
  ): Promise<AgentRunResult>;
}

/**
 * 组装 stdin 内容。
 *
 * 员工职责被包进 `<employee_role>` 块一并从 stdin 投递，而不是走 `--append-system-prompt`
 * 之类的 argv 通道。原因是：当启动器是 npm 的 .cmd 包装脚本时，cmd.exe 会改写 argv 里的
 * `%VAR%` 与 `^`，走 argv 会静默损坏文本。代价是职责块属于用户消息的一部分而非真正的
 * system prompt；升级路径见设计文档（Claude 的 `--append-system-prompt-file`、Codex 的 AGENTS.md）。
 */
export function buildStdinPayload(
  request: AgentRunRequest,
  prompts: PromptPack = defaultPromptPack(),
): string {
  const role = request.systemPrompt?.trim();
  if (!role) return `${request.prompt}\n`;
  return `${render(prompts.roleWrapper, { role })}\n\n${request.prompt}\n`;
}
