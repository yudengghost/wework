import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DataParseError } from "../storage/errors";
import { FileStore } from "../storage/fileStore";
import { MemoryStore } from "./memoryStore";

let root: string;
let memory: MemoryStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-memory-"));
  memory = new MemoryStore(new FileStore(), root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("MemoryStore 长期记忆", () => {
  it("追加并按顺序读回", async () => {
    await memory.appendFact("emp_1", "用户偏好用中文交流", "fact", "room_1");
    await memory.appendFact("emp_1", "约定：提交前必须跑测试", "fact", "room_1");

    const facts = await memory.listFacts("emp_1");

    expect(facts.map((fact) => fact.text)).toEqual([
      "用户偏好用中文交流",
      "约定：提交前必须跑测试",
    ]);
    expect(facts[0]?.id).toMatch(/^mem_[0-9a-f]{12}$/);
    expect(facts[0]?.roomId).toBe("room_1");
  });

  it("recentFacts 只取最后 N 条", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await memory.appendFact("emp_1", `第${index}条`);
    }

    expect((await memory.recentFacts("emp_1", 2)).map((fact) => fact.text)).toEqual([
      "第4条",
      "第5条",
    ]);
  });

  it("writeFacts 整体替换", async () => {
    await memory.appendFact("emp_1", "旧的");

    await memory.writeFacts("emp_1", [
      { id: "mem_x", kind: "digest", text: "折叠摘要", createdAt: "2026-10-12T00:00:00.000Z" },
    ]);

    expect((await memory.listFacts("emp_1")).map((fact) => fact.kind)).toEqual(["digest"]);
  });

  it("员工之间互不干扰", async () => {
    await memory.appendFact("emp_1", "甲的");
    await memory.appendFact("emp_2", "乙的");

    expect(await memory.countFacts("emp_1")).toBe(1);
    expect((await memory.listFacts("emp_2")).map((fact) => fact.text)).toEqual(["乙的"]);
  });
});

describe("MemoryStore 待归纳暂存区", () => {
  it("暂存内容不会被当成长期记忆", async () => {
    await memory.appendPending("emp_1", { roomId: "room_1", scope: "group", text: "一次往来" });

    expect(await memory.countPending("emp_1")).toBe(1);
    expect(await memory.countFacts("emp_1")).toBe(0);
  });

  it("clearPending 只清暂存，不动长期记忆", async () => {
    await memory.appendFact("emp_1", "长期");
    await memory.appendPending("emp_1", { roomId: "room_1", scope: "direct", text: "暂存" });

    await memory.clearPending("emp_1");

    expect(await memory.countPending("emp_1")).toBe(0);
    expect(await memory.countFacts("emp_1")).toBe(1);
  });

  it("clear 同时清空长期记忆与暂存", async () => {
    await memory.appendFact("emp_1", "长期");
    await memory.appendPending("emp_1", { roomId: "room_1", scope: "group", text: "暂存" });

    await memory.clear("emp_1");

    expect(await memory.countFacts("emp_1")).toBe(0);
    expect(await memory.countPending("emp_1")).toBe(0);
  });
});

describe("MemoryStore 健壮性", () => {
  it("坏行抛 DataParseError 并指出行号", async () => {
    const store = new FileStore();
    await store.write(join(root, "memory", "emp_1.jsonl"), '{"text":"ok"}\n{bad\n');

    await expect(memory.listFacts("emp_1")).rejects.toBeInstanceOf(DataParseError);
  });
});
