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
  root = await mkdtemp(join(tmpdir(), "buddy-memory-"));
  memory = new MemoryStore(new FileStore(), root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const exchange = (text: string, roomId = "room_1") =>
  ({ kind: "exchange" as const, scope: "group" as const, roomId, text });

describe("MemoryStore", () => {
  it("按写入顺序读回", async () => {
    await memory.append("emp_1", exchange("第一条"));
    await memory.append("emp_1", exchange("第二条"));

    const all = await memory.list("emp_1");

    expect(all.map((entry) => entry.text)).toEqual(["第一条", "第二条"]);
    expect(all[0]?.id).toMatch(/^mem_[0-9a-f]{12}$/);
  });

  it("员工之间互不干扰", async () => {
    await memory.append("emp_1", exchange("甲的"));
    await memory.append("emp_2", exchange("乙的"));

    expect((await memory.list("emp_1")).map((entry) => entry.text)).toEqual(["甲的"]);
    expect(await memory.count("emp_2")).toBe(1);
  });

  it("recent 只取最后 N 条", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await memory.append("emp_1", exchange(`第${index}条`));
    }

    expect((await memory.recent("emp_1", 2)).map((entry) => entry.text)).toEqual([
      "第4条",
      "第5条",
    ]);
  });

  it("consolidate 保留最新若干条并把更旧的折叠成一条摘要", async () => {
    for (let index = 1; index <= 6; index += 1) {
      await memory.append("emp_1", exchange(`第${index}条`));
    }

    const absorbed = await memory.consolidate("emp_1", 2, "前四条综述");
    const all = await memory.list("emp_1");

    expect(absorbed).toBe(4);
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ kind: "digest", text: "前四条综述" });
    expect(all.slice(1).map((entry) => entry.text)).toEqual(["第5条", "第6条"]);
  });

  it("条数不足时 consolidate 不做任何事", async () => {
    await memory.append("emp_1", exchange("唯一一条"));

    expect(await memory.consolidate("emp_1", 5, "不该出现")).toBe(0);
    expect(await memory.count("emp_1")).toBe(1);
  });

  it("trim 从最旧处丢弃", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await memory.append("emp_1", exchange(`第${index}条`));
    }

    expect(await memory.trim("emp_1", 2)).toBe(3);
    expect((await memory.list("emp_1")).map((entry) => entry.text)).toEqual([
      "第4条",
      "第5条",
    ]);
  });

  it("clear 清空某位员工的记忆，不影响别人", async () => {
    await memory.append("emp_1", exchange("甲"));
    await memory.append("emp_2", exchange("乙"));

    await memory.clear("emp_1");

    expect(await memory.count("emp_1")).toBe(0);
    expect(await memory.count("emp_2")).toBe(1);
  });

  it("坏行抛 DataParseError 并指出行号", async () => {
    const store = new FileStore();
    await store.write(join(root, "memory", "emp_1.jsonl"), '{"text":"ok"}\n{bad\n');

    await expect(memory.list("emp_1")).rejects.toBeInstanceOf(DataParseError);
  });
});
