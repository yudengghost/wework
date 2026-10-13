import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCodexLine } from "./parseCodexLine";

const fixturePath = resolve(
  import.meta.dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "codex-stream.jsonl",
);

async function parseFixture(): Promise<ReturnType<typeof parseCodexLine>> {
  const raw = await readFile(fixturePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => parseCodexLine(line));
}

describe("parseCodexLine 对真实事件流", () => {
  it("把 thread.started 映射为 session", async () => {
    const events = await parseFixture();
    const session = events.find((event) => event.type === "session");

    expect(session).toEqual({
      type: "session",
      sessionRef: "01a12f64-0406-7050-ada9-2a2e3ff67f87",
    });
  });

  it("两条 agent_message 都变成 text 事件，且顺序保持", async () => {
    const events = await parseFixture();
    const texts = events.filter((event) => event.type === "text");

    expect(texts).toEqual([
      { type: "text", text: "I'll list the files in the current directory." },
      { type: "text", text: "Files: readme.md and src." },
    ]);
  });

  it("命令执行拆成 tool-call 与 tool-result", async () => {
    const events = await parseFixture();

    expect(events.find((event) => event.type === "tool-call")).toMatchObject({
      name: "command_execution",
    });
    expect(events.find((event) => event.type === "tool-result")).toMatchObject({
      name: "command_execution",
      ok: true,
    });
  });

  it("turn.completed 带出用量", async () => {
    const events = await parseFixture();

    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      inputTokens: 76273,
      outputTokens: 174,
    });
  });

  it("turn.started 不产生事件", async () => {
    expect(
      parseCodexLine('{"type":"turn.started"}'),
    ).toEqual([]);
  });

  it("非 JSON 行与未知类型都被安全忽略", () => {
    expect(parseCodexLine("Reading additional input from stdin...")).toEqual([]);
    expect(parseCodexLine('{"type":"brand.new.event","x":1}')).toEqual([]);
    expect(parseCodexLine("null")).toEqual([]);
  });

  it("缺少关键字段时不硬造事件", () => {
    expect(parseCodexLine('{"type":"thread.started"}')).toEqual([]);
    expect(parseCodexLine('{"type":"item.completed","item":{"type":"agent_message"}}')).toEqual([]);
  });

  it("error 事件被如实带出", () => {
    expect(parseCodexLine('{"type":"error","message":"模型不可用"}')).toEqual([
      { type: "error", message: "模型不可用" },
    ]);
  });

  it("file_change 带出改动的路径与类型", () => {
    const line =
      '{"type":"item.completed","item":{"type":"file_change","status":"completed",' +
      '"changes":[{"path":"src/a.ts","kind":"update"},{"path":"src/b.ts","kind":"add"}]}}';
    expect(parseCodexLine(line)).toEqual([
      {
        type: "tool-result",
        name: "file_change",
        ok: true,
        output: "src/a.ts (update)、src/b.ts (add)",
      },
    ]);
  });

  it("web_search 带出搜索词", () => {
    const line = '{"type":"item.started","item":{"type":"web_search","query":"wework 图标"}}';
    expect(parseCodexLine(line)).toEqual([
      { type: "tool-call", name: "web_search", detail: "wework 图标" },
    ]);
  });

  it("mcp_tool_call 带出服务与工具名，出错时 ok 为假", () => {
    expect(
      parseCodexLine(
        '{"type":"item.completed","item":{"type":"mcp_tool_call","server":"fs","tool":"read"}}',
      ),
    ).toEqual([{ type: "tool-result", name: "mcp_tool_call", ok: true, output: "fs/read" }]);
    expect(
      parseCodexLine(
        '{"type":"item.completed","item":{"type":"mcp_tool_call","server":"fs","tool":"read","error":"denied"}}',
      ),
    ).toEqual([{ type: "tool-result", name: "mcp_tool_call", ok: false, output: "fs/read" }]);
  });

  it("todo_list 带出清单条目", () => {
    const line =
      '{"type":"item.completed","item":{"type":"todo_list","items":[{"text":"读需求"},{"text":"写代码"}]}}';
    expect(parseCodexLine(line)).toEqual([
      { type: "tool-call", name: "todo_list", detail: "读需求；写代码" },
    ]);
  });

  it("已知类型里字段缺失时只丢 detail，不抛错", () => {
    expect(parseCodexLine('{"type":"item.started","item":{"type":"file_change"}}')).toEqual([
      { type: "tool-call", name: "file_change", detail: undefined },
    ]);
    expect(parseCodexLine('{"type":"item.completed","item":{"type":"web_search"}}')).toEqual([
      { type: "tool-result", name: "web_search", ok: true, output: undefined },
    ]);
  });
});
