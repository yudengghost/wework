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
 * 把 `claude -p --output-format stream-json` 的一行映射成统一事件。
 *
 * 依据本机实测：system/init 带 session_id；assistant 消息带 Anthropic 风格的
 * content blocks（thinking / text / tool_use）；result 带最终文本、成本与 usage。
 * tool_use 与 tool_result 的形状按 Anthropic content block 约定实现（本机未捕获到实例），
 * 未知 block 类型一律忽略。
 */
export function parseClaudeLine(line: string): AgentEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(raw)) return [];

  const type = str(raw.type);
  if (type === undefined) return [];

  if (type === "system") {
    if (raw.subtype !== "init") return [];
    const sessionId = str(raw.session_id);
    return sessionId === undefined ? [] : [{ type: "session", sessionRef: sessionId }];
  }

  if (type === "assistant") {
    const message = raw.message;
    const content = isRecord(message) ? message.content : undefined;
    if (!Array.isArray(content)) return [];

    const events: AgentEvent[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      const blockType = str(block.type);
      if (blockType === "text") {
        const text = str(block.text);
        if (text !== undefined && text !== "") events.push({ type: "text", text });
      } else if (blockType === "thinking") {
        const thinking = str(block.thinking);
        if (thinking !== undefined && thinking !== "") {
          events.push({ type: "reasoning", text: thinking });
        }
      } else if (blockType === "tool_use") {
        const name = str(block.name);
        if (name !== undefined) {
          events.push({
            type: "tool-call",
            name,
            detail: block.input === undefined ? undefined : JSON.stringify(block.input),
          });
        }
      }
    }
    return events;
  }

  if (type === "user") {
    const message = raw.message;
    const content = isRecord(message) ? message.content : undefined;
    if (!Array.isArray(content)) return [];

    const events: AgentEvent[] = [];
    for (const block of content) {
      if (!isRecord(block) || str(block.type) !== "tool_result") continue;
      events.push({
        type: "tool-result",
        ok: block.is_error !== true,
        output: typeof block.content === "string" ? block.content : undefined,
      });
    }
    return events;
  }

  if (type === "result") {
    const usage = raw.usage;
    const events: AgentEvent[] = [
      {
        type: "usage",
        inputTokens: isRecord(usage) ? num(usage.input_tokens) : undefined,
        outputTokens: isRecord(usage) ? num(usage.output_tokens) : undefined,
        costUsd: num(raw.total_cost_usd),
      },
    ];
    if (raw.is_error === true) {
      events.push({ type: "error", message: str(raw.result) ?? "claude 运行失败" });
    }
    return events;
  }

  return [];
}
