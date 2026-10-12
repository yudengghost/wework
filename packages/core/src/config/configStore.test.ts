import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DataParseError } from "../storage/errors";
import { FileStore } from "../storage/fileStore";
import { ConfigNotLoadedError, ConfigStore } from "./configStore";
import { defaultConfig } from "./schema";

let root: string;
let filePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-config-"));
  filePath = join(root, "config.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeStore(): ConfigStore {
  return new ConfigStore(new FileStore(), filePath);
}

describe("ConfigStore.load", () => {
  it("文件不存在时返回默认配置", async () => {
    const store = makeStore();

    expect(await store.load()).toEqual(defaultConfig());
  });

  it("文件缺字段时与默认值合并", async () => {
    await writeFile(
      filePath,
      JSON.stringify({ policy: { employeeMentionsAll: "auto" } }),
      "utf8",
    );
    const store = makeStore();

    const config = await store.load();

    expect(config.policy.employeeMentionsAll).toBe("auto");
    expect(config.scheduler.maxConcurrentRuns).toBe(3);
  });

  it("非法 JSON 抛出 DataParseError 而不是静默重置", async () => {
    await writeFile(filePath, "{ not json", "utf8");

    await expect(makeStore().load()).rejects.toBeInstanceOf(DataParseError);
  });

  it("字段校验失败抛出 DataParseError", async () => {
    await writeFile(filePath, JSON.stringify({ scheduler: { maxConcurrentRuns: -1 } }), "utf8");

    await expect(makeStore().load()).rejects.toBeInstanceOf(DataParseError);
  });
});

describe("ConfigStore.get / update", () => {
  it("未加载就 get 会抛 ConfigNotLoadedError", () => {
    expect(() => makeStore().get()).toThrow(ConfigNotLoadedError);
  });

  it("update 合并、校验并落盘", async () => {
    const store = makeStore();
    await store.load();

    await store.update({ policy: { employeeMentionsEmployee: "confirm" } });

    const reloaded = await makeStore().load();
    expect(reloaded.policy.employeeMentionsEmployee).toBe("confirm");
    expect(reloaded.policy.employeeMentionsAll).toBe("confirm");
  });

  it("update 传入的 undefined 不覆盖既有值", async () => {
    const store = makeStore();
    await store.load();
    await store.update({ ui: { language: "en-US" } });

    await store.update({ ui: { language: undefined } });

    expect(store.get().ui.language).toBe("en-US");
  });

  it("update 非法值被拒绝且不落盘", async () => {
    const store = makeStore();
    await store.load();

    await expect(
      store.update({ scheduler: { maxConcurrentRuns: 0 as unknown as number } }),
    ).rejects.toBeTruthy();

    expect(store.get().scheduler.maxConcurrentRuns).toBe(3);
  });

  it("落盘后目录里没有残留临时文件", async () => {
    const store = makeStore();
    await store.load();
    await store.update({ ui: { language: "en-US" } });

    expect(await readdir(root)).toEqual(["config.json"]);
  });
});
