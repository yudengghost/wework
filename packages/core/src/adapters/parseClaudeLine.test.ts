import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseClaudeLine } from "./parseClaudeLine";

const fixturePath = resolve(
  import.meta.dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "claude-stream.jsonl",
);

async function parseFixture(): Promise<ReturnType<typeof parseClaudeLine>> {
  const raw = await readFile(fixturePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => parseClaudeLine(line));
}

describe("parseClaudeLine 对真实事件流", () => {
  it("system/init 给出 session_id", async () => {
    const events = await parseFixture();

    expect(events.find((event) => event.type === "session")).toEqual({
      type: "session",
      sessionRef: "1fd3cf9a-ede3-4b27-b21e-41f3ec79a648",
    });
  });

  it("空的 thinking 块不产生 reasoning 事件", async () => {
    const events = await parseFixture();

    expect(events.some((event) => event.type === "reasoning")).toBe(false);
  });

  it("text 块变成 text 事件", async () => {
    const events = await parseFixture();

    expect(events.filter((event) => event.type === "text")).toEqual([
      { type: "text", text: "Hi" },
    ]);
  });

  it("result 带出用量与成本", async () => {
    const events = await parseFixture();

    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      inputTokens: 19887,
      outputTokens: 2,
      costUsd: 0.09948499999999999,
    });
  });

  it("tool_use 块变成 tool-call（按 Anthropic content block 约定）", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }],
      },
    });

    expect(parseClaudeLine(line)).toEqual([
      { type: "tool-call", name: "Bash", detail: '{"command":"ls"}' },
    ]);
  });

  it("tool_result 块变成 tool-result，is_error 决定成败", () => {
    const ok = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", content: "done" }] },
    });
    const bad = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", is_error: true }] },
    });

    expect(parseClaudeLine(ok)).toEqual([{ type: "tool-result", ok: true, output: "done" }]);
    expect(parseClaudeLine(bad)).toEqual([{ type: "tool-result", ok: false, output: undefined }]);
  });

  it("result 里 is_error 为真时带出 error 事件", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "额度不足",
    });

    expect(parseClaudeLine(line)).toContainEqual({ type: "error", message: "额度不足" });
  });

  it("非 JSON 行与未知类型被安全忽略", () => {
    expect(parseClaudeLine("not json")).toEqual([]);
    expect(parseClaudeLine('{"type":"future.thing"}')).toEqual([]);
    expect(parseClaudeLine('{"type":"system","subtype":"other"}')).toEqual([]);
  });
});
