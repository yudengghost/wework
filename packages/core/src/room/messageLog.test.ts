import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Message } from "../domain/schema";
import { DataParseError } from "../storage/errors";
import { FileStore } from "../storage/fileStore";
import { MessageLog } from "./messageLog";

let root: string;
let log: MessageLog;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-messages-"));
  log = new MessageLog(new FileStore(), root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    roomId: "room_1",
    sender: { kind: "human" },
    mentions: [],
    body: "你好",
    attachments: [],
    kind: "chat",
    createdAt: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("MessageLog", () => {
  it("没有日志时读出空数组", async () => {
    expect(await log.readAll("room_1")).toEqual([]);
  });

  it("追加后按写入顺序读回", async () => {
    await log.append(message({ id: "msg_1", body: "第一条" }));
    await log.append(message({ id: "msg_2", body: "第二条" }));

    const all = await log.readAll("room_1");

    expect(all.map((item) => item.id)).toEqual(["msg_1", "msg_2"]);
    expect(await log.count("room_1")).toBe(2);
  });

  it("readRecent 只取最后 N 条", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await log.append(message({ id: `msg_${index}` }));
    }

    expect((await log.readRecent("room_1", 2)).map((item) => item.id)).toEqual([
      "msg_4",
      "msg_5",
    ]);
  });

  it("房间之间互不干扰", async () => {
    await log.append(message({ id: "msg_1", roomId: "room_1" }));
    await log.append(message({ id: "msg_2", roomId: "room_2" }));

    expect(await log.count("room_1")).toBe(1);
    expect((await log.readAll("room_2")).map((item) => item.id)).toEqual(["msg_2"]);
  });

  it("写入前校验消息，非法消息不落盘", async () => {
    const invalid = message({
      mentions: [{ kind: "employee", employeeId: "" }] as Message["mentions"],
    });

    await expect(log.append(invalid)).rejects.toBeTruthy();
    expect(await log.count("room_1")).toBe(0);
  });

  it("日志中混入坏行时抛 DataParseError 并指出行号", async () => {
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");
    await store.write(file, `${JSON.stringify(message({ id: "msg_1" }))}\n{bad json\n`);

    await expect(log.readAll("room_1")).rejects.toBeInstanceOf(DataParseError);
    await expect(log.readAll("room_1")).rejects.toThrow(/第 2 行/);
  });

  it("忽略文件末尾的空行", async () => {
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");
    await store.write(file, `${JSON.stringify(message({ id: "msg_1" }))}\n\n\n`);

    expect(await log.count("room_1")).toBe(1);
  });
});
