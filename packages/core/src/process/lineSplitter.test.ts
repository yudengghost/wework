import { describe, expect, it } from "vitest";

import { createLineSplitter } from "./lineSplitter";

function collect(): { lines: string[]; splitter: ReturnType<typeof createLineSplitter> } {
  const lines: string[] = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  return { lines, splitter };
}

describe("createLineSplitter", () => {
  it("按换行切开并逐行回调", () => {
    const { lines, splitter } = collect();

    splitter.push("a\nb\n");

    expect(lines).toEqual(["a", "b"]);
  });

  it("跨 chunk 的断行被拼回", () => {
    const { lines, splitter } = collect();

    splitter.push("hel");
    splitter.push("lo\n");

    expect(lines).toEqual(["hello"]);
  });

  it("兼容 CRLF", () => {
    const { lines, splitter } = collect();

    splitter.push("a\r\nb\r\n");

    expect(lines).toEqual(["a", "b"]);
  });

  it("flush 吐出结尾没有换行的残留", () => {
    const { lines, splitter } = collect();

    splitter.push("tail");
    expect(lines).toEqual([]);

    splitter.flush();

    expect(lines).toEqual(["tail"]);
  });

  it("连续空行不产生空行事件", () => {
    const { lines, splitter } = collect();

    splitter.push("\n\n\na\n\n");

    expect(lines).toEqual(["a"]);
  });

  it("flush 之后没有残留时不产生事件", () => {
    const { lines, splitter } = collect();

    splitter.push("a\n");
    splitter.flush();

    expect(lines).toEqual(["a"]);
  });
});
