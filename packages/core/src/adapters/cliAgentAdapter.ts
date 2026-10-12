import type { Framework } from "../domain/schema";
import type { LaunchSpec } from "../launcher/resolveLauncher";
import { ProcessRunner } from "../process/processRunner";
import { buildClaudeArgs, buildCodexArgs } from "./buildArgs";
import { defaultPromptPack, type PromptPack } from "../prompts/promptPack";
import {
  buildStdinPayload,
  type AgentAdapter,
  type AgentEvent,
  type AgentRunRequest,
  type AgentRunResult,
} from "./events";
import { parseClaudeLine } from "./parseClaudeLine";
import { parseCodexLine } from "./parseCodexLine";

export type LineParser = (line: string) => AgentEvent[];
export type ArgsPlanner = (request: AgentRunRequest) => string[];

/**
 * 把「一个 CLI 后端」统一成 AgentAdapter：
 * 组装 argv → 经 stdin 投递提示词 → 逐行解析事件 → 汇总结果。
 * 不懂任何框架私有的参数细节，那些由 ArgsPlanner 与 LineParser 注入。
 */
export class CliAgentAdapter implements AgentAdapter {
  constructor(
    readonly framework: Framework,
    private readonly spec: LaunchSpec,
    private readonly runner: ProcessRunner,
    private readonly planArgs: ArgsPlanner,
    private readonly parseLine: LineParser,
    private readonly prompts: PromptPack = defaultPromptPack(),
  ) {}

  async run(
    request: AgentRunRequest,
    onEvent?: (event: AgentEvent) => void,
  ): Promise<AgentRunResult> {
    const textParts: string[] = [];
    let sessionRef = request.sessionRef;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let costUsd: number | undefined;
    let failure: string | undefined;

    const emit = (events: AgentEvent[]): void => {
      for (const event of events) {
        if (event.type === "text") {
          textParts.push(event.text);
        } else if (event.type === "session") {
          sessionRef = event.sessionRef;
        } else if (event.type === "usage") {
          if (event.inputTokens !== undefined) inputTokens = event.inputTokens;
          if (event.outputTokens !== undefined) outputTokens = event.outputTokens;
          if (event.costUsd !== undefined) costUsd = event.costUsd;
        } else if (event.type === "error") {
          failure = event.message;
        }
        onEvent?.(event);
      }
    };

    const result = await this.runner.run({
      command: this.spec.command,
      args: [...this.spec.baseArgs, ...this.planArgs(request)],
      cwd: request.cwd,
      stdin: buildStdinPayload(request, this.prompts),
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      onStdoutLine: (line) => emit(this.parseLine(line)),
    });

    const ok =
      result.exitCode === 0 && !result.timedOut && !result.cancelled && failure === undefined;
    const usage =
      inputTokens !== undefined || outputTokens !== undefined || costUsd !== undefined
        ? { inputTokens, outputTokens, costUsd }
        : undefined;

    return {
      framework: this.framework,
      ok,
      exitCode: result.exitCode,
      text: textParts.join(""),
      sessionRef,
      usage,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      stderr: result.stderr,
    };
  }
}

export function createCodexAdapter(
  spec: LaunchSpec,
  runner: ProcessRunner = new ProcessRunner(),
): AgentAdapter {
  return new CliAgentAdapter("codex", spec, runner, buildCodexArgs, parseCodexLine);
}

export function createClaudeCodeAdapter(
  spec: LaunchSpec,
  runner: ProcessRunner = new ProcessRunner(),
): AgentAdapter {
  return new CliAgentAdapter("claude-code", spec, runner, buildClaudeArgs, parseClaudeLine);
}
