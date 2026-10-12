import type { AgentEvent } from "./events";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * 把 `codex exec --json` 的一行 JSONL 映射成统一事件。
 *
 * 依据的是本机实测的真实事件序列：
 *   thread.started → turn.started → item.completed(agent_message)
 *   → item.started/item.completed(command_execution) → turn.completed(usage)
 *
 * 未知类型一律忽略，保证 CLI 升级新增事件时不会把适配器打挂。
 */
export function parseCodexLine(line: string): AgentEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(raw)) return [];

  const type = str(raw.type);
  if (type === undefined) return [];

  if (type === "thread.started") {
    const threadId = str(raw.thread_id);
    return threadId === undefined ? [] : [{ type: "session", sessionRef: threadId }];
  }

  if (type === "item.started" || type === "item.completed") {
    const item = raw.item;
    if (!isRecord(item)) return [];

    const itemType = str(item.type);
    if (itemType === "agent_message") {
      const text = str(item.text);
      return text === undefined ? [] : [{ type: "text", text }];
    }
    if (itemType === "reasoning") {
      const text = str(item.text);
      return text === undefined ? [] : [{ type: "reasoning", text }];
    }
    if (itemType === "command_execution") {
      return type === "item.started"
        ? [{ type: "tool-call", name: "command_execution", detail: str(item.command) }]
        : [
            {
              type: "tool-result",
              name: "command_execution",
              ok: item.exit_code === 0,
              output: str(item.aggregated_output),
            },
          ];
    }
    return [];
  }

  if (type === "turn.completed") {
    const usage = raw.usage;
    if (!isRecord(usage)) return [];
    return [
      {
        type: "usage",
        inputTokens: num(usage.input_tokens),
        outputTokens: num(usage.output_tokens),
      },
    ];
  }

  if (type === "error") {
    return [{ type: "error", message: str(raw.message) ?? "codex 运行失败" }];
  }

  return [];
}
