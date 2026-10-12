import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileStore } from "./fileStore";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FileStore", () => {
  it("写入后能读回", async () => {
    const store = new FileStore();
    const file = join(root, "nested", "config.json");

    await store.write(file, "hello");

    expect(await store.read(file)).toBe("hello");
  });

  it("读取不存在的文件返回 null", async () => {
    const store = new FileStore();

    expect(await store.read(join(root, "missing.json"))).toBeNull();
  });

  it("重复写入覆盖旧内容且不留下临时文件", async () => {
    const store = new FileStore();
    const file = join(root, "a.json");

    await store.write(file, "v1");
    await store.write(file, "v2");

    expect(await store.read(file)).toBe("v2");
    expect(await readdir(root)).toEqual(["a.json"]);
  });

  it("appendLine 自动补换行并追加", async () => {
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");

    await store.appendLine(file, "one");
    await store.appendLine(file, "two\n");

    expect(await store.read(file)).toBe("one\ntwo\n");
  });

  it("listFiles 返回文件名并排序，目录不存在返回空数组", async () => {
    const store = new FileStore();
    await store.write(join(root, "dir", "b.txt"), "b");
    await store.write(join(root, "dir", "a.txt"), "a");

    expect(await store.listFiles(join(root, "dir"))).toEqual(["a.txt", "b.txt"]);
    expect(await store.listFiles(join(root, "nope"))).toEqual([]);
  });

  it("exists 与 remove 行为正确", async () => {
    const store = new FileStore();
    const file = join(root, "x.txt");

    expect(await store.exists(file)).toBe(false);
    await store.write(file, "x");
    expect(await store.exists(file)).toBe(true);
    await store.remove(file);
    expect(await store.exists(file)).toBe(false);
    await expect(store.remove(file)).resolves.toBeUndefined();
  });

  it("并发写同一路径时按调用顺序落盘，最终是最新内容且不留临时文件", async () => {
    const store = new FileStore();
    const file = join(root, "race.json");

    await Promise.all(
      Array.from({ length: 20 }, (_item, index) => store.write(file, `v${index + 1}`)),
    );

    expect(await store.read(file)).toBe("v20");
    expect(await readdir(root)).toEqual(["race.json"]);
  });
});
