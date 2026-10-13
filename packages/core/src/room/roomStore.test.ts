import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileStore } from "../storage/fileStore";
import { RoomNotFoundError, RoomStore } from "./roomStore";

let root: string;
let filePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-room-"));
  filePath = join(root, "rooms.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeLoadedStore(): Promise<RoomStore> {
  const store = new RoomStore(new FileStore(), filePath);
  await store.load();
  return store;
}

describe("RoomStore", () => {
  it("创建房间并落盘", async () => {
    const store = await makeLoadedStore();

    const room = await store.create({ name: "产品讨论" });

    expect(room.id).toMatch(/^room_[0-9a-f]{12}$/);
    expect(room.memberIds).toEqual([]);
    expect((await makeLoadedStore()).list()).toHaveLength(1);
  });

  it("创建时可指定成员与房间级策略覆盖", async () => {
    const store = await makeLoadedStore();

    const room = await store.create({
      name: "攻坚",
      memberIds: ["emp_1", "emp_2"],
      policy: { maxMentionDepth: 1 },
    });

    expect(room.memberIds).toEqual(["emp_1", "emp_2"]);
    expect(room.policy?.maxMentionDepth).toBe(1);
  });

  it("update 可改成员与策略", async () => {
    const store = await makeLoadedStore();
    const room = await store.create({ name: "攻坚" });

    const updated = await store.update(room.id, {
      name: "攻坚二期",
      memberIds: ["emp_1"],
      policy: { employeeMentionsAll: "auto" },
    });

    expect(updated.name).toBe("攻坚二期");
    expect(updated.memberIds).toEqual(["emp_1"]);
    expect(updated.policy?.employeeMentionsAll).toBe("auto");
  });

  it("update 不存在的房间抛 RoomNotFoundError", async () => {
    const store = await makeLoadedStore();

    await expect(store.update("room_missing", { name: "x" })).rejects.toBeInstanceOf(
      RoomNotFoundError,
    );
  });

  it("remove 后消失", async () => {
    const store = await makeLoadedStore();
    const room = await store.create({ name: "临时" });

    await store.remove(room.id);

    expect(store.get(room.id)).toBeUndefined();
    await expect(store.remove(room.id)).rejects.toBeInstanceOf(RoomNotFoundError);
  });
});
