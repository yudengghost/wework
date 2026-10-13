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

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 文件变更的路径清单：只给路径，中文措辞交给界面层。 */
function describeChanges(item: Record<string, unknown>): string | undefined {
  const parts = arr(item.changes)
    .filter(isRecord)
    .map((change) => {
      const path = str(change.path);
      if (path === undefined) return undefined;
      const kind = str(change.kind);
      return kind === undefined ? path : `${path} (${kind})`;
    })
    .filter((entry): entry is string => entry !== undefined);
  return parts.length === 0 ? undefined : parts.slice(0, 4).join("、");
}

/**
 * 把 `codex exec --json` 的一行 JSONL 映射成统一事件。
 *
 * 依据的是本机实测的真实事件序列：
 *   thread.started → turn.started → item.completed(agent_message)
 *   → item.started/item.completed(command_execution) → turn.completed(usage)
 *
 * 此外还覆盖了 codex 会发出的其它 item 类型：file_change / web_search /
 * mcp_tool_call / todo_list / error。它们唯一的去向就是运行轨迹——
 * 「员工正在干什么」只能从这些事件里看出来。
 *
 * 未知类型一律忽略，保证 CLI 升级新增事件时不会把适配器打挂；已知类型里
 * 认不出的字段也只会让 detail 为空，不会抛错。
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
    if (itemType === "file_change") {
      const detail = describeChanges(item);
      return type === "item.started"
        ? [{ type: "tool-call", name: "file_change", detail }]
        : [
            {
              type: "tool-result",
              name: "file_change",
              ok: str(item.status) !== "failed",
              output: detail,
            },
          ];
    }
    if (itemType === "web_search") {
      const detail = str(item.query);
      return type === "item.started"
        ? [{ type: "tool-call", name: "web_search", detail }]
        : [{ type: "tool-result", name: "web_search", ok: true, output: detail }];
    }
    if (itemType === "mcp_tool_call") {
      const server = str(item.server);
      const tool = str(item.tool);
      const detail = [server, tool].filter((part): part is string => part !== undefined).join("/");
      return type === "item.started"
        ? [{ type: "tool-call", name: "mcp_tool_call", detail: detail || undefined }]
        : [
            {
              type: "tool-result",
              name: "mcp_tool_call",
              ok: item.error === undefined || item.error === null,
              output: detail || undefined,
            },
          ];
    }
    if (itemType === "todo_list") {
      const items = arr(item.items)
        .filter(isRecord)
        .map((entry) => str(entry.text))
        .filter((entry): entry is string => entry !== undefined);
      return [{ type: "tool-call", name: "todo_list", detail: items.slice(0, 6).join("；") || undefined }];
    }
    if (itemType === "error") {
      return [{ type: "error", message: str(item.message) ?? "codex 运行出错" }];
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
