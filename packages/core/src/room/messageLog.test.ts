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

  it("removeRoom 删除该房间的消息且不影响其它房间", async () => {
    await log.append(message({ id: "msg_1", roomId: "room_1" }));
    await log.append(message({ id: "msg_2", roomId: "room_2" }));

    await log.removeRoom("room_1");

    expect(await log.count("room_1")).toBe(0);
    expect(await log.count("room_2")).toBe(1);
  });
});

describe("MessageLog 修复坏行", () => {
  it("把坏行隔离到备份文件，能解析的消息一条不少", async () => {
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");
    const good = JSON.stringify(message({ id: "msg_1", body: "好好的" }));
    const broken = "{这不是合法 JSON}";
    await store.write(file, `${good}\n${broken}\n`);

    const repair = await log.repair("room_1");

    expect(repair.kept).toBe(1);
    expect(repair.quarantined).toBe(1);
    expect(repair.backupPath).toBeTruthy();
    const all = await log.readAll("room_1");
    expect(all.map((item) => item.id)).toEqual(["msg_1"]);
    // 坏行没有被丢掉：原样躺在备份文件里，随时能人工看一眼
    expect(await store.read(repair.backupPath as string)).toBe(`${broken}\n`);
  });

  it("没有坏行时不写备份、不动原文件", async () => {
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");
    const contents = `${JSON.stringify(message({ id: "msg_1" }))}\n`;
    await store.write(file, contents);

    const repair = await log.repair("room_1");

    expect(repair).toEqual({ roomId: "room_1", kept: 1, quarantined: 0, backupPath: null });
    expect(await store.read(file)).toBe(contents);
  });

  it("房间没有日志时也能安全调用", async () => {
    const repair = await log.repair("room_missing");

    expect(repair).toEqual({ roomId: "room_missing", kept: 0, quarantined: 0, backupPath: null });
  });

  it("校验失败的整行（合法 JSON、非法消息）也算坏行", async () => {
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");
    await store.write(
      file,
      `${JSON.stringify(message({ id: "msg_1" }))}\n${JSON.stringify({ id: "", roomId: "" })}\n`,
    );

    const repair = await log.repair("room_1");

    expect(repair.kept).toBe(1);
    expect(repair.quarantined).toBe(1);
  });
});
