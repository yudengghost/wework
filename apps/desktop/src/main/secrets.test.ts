// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileStore, defaultConfig } from "@buddy/core";

import { createSecretStore, withoutApiKey, type SecretCodec } from "./secrets";

let root: string;
let file: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-secrets-"));
  file = join(root, "secrets.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// 假加密：足够验证「落盘的确实不是明文」，而不必真的拉起 Electron。
function fakeCodec(available = true): SecretCodec {
  return {
    available: () => available,
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64")}`,
    decrypt: (cipher) => Buffer.from(cipher.replace(/^enc:/, ""), "base64").toString("utf8"),
  };
}

describe("SecretStore", () => {
  it("密钥密文落盘，读回来是原文", async () => {
    const store = createSecretStore(new FileStore(), file, fakeCodec());
    await store.setBuiltinApiKey("sk-live-123");

    expect(await new FileStore().read(file)).not.toContain("sk-live-123");
    expect(await store.getBuiltinApiKey()).toBe("sk-live-123");
  });

  it("换一个实例仍然读得到（说明真的落盘了）", async () => {
    await createSecretStore(new FileStore(), file, fakeCodec()).setBuiltinApiKey("sk-live-123");

    const fresh = createSecretStore(new FileStore(), file, fakeCodec());

    expect(fresh.canStoreSecrets()).toBe(true);
    expect(await fresh.getBuiltinApiKey()).toBe("sk-live-123");
  });

  it("清除后读回 null，文件里也不再留着", async () => {
    const store = createSecretStore(new FileStore(), file, fakeCodec());
    await store.setBuiltinApiKey("sk-live-123");

    await store.setBuiltinApiKey(null);

    expect(await store.getBuiltinApiKey()).toBeNull();
    expect(await new FileStore().read(file)).not.toContain("sk-live-123");
  });

  it("没设过时读回 null", async () => {
    const store = createSecretStore(new FileStore(), file, fakeCodec());

    expect(await store.getBuiltinApiKey()).toBeNull();
  });

  it("系统不支持安全存储时拒绝保存，而不是退化成明文", async () => {
    const store = createSecretStore(new FileStore(), file, fakeCodec(false));

    expect(store.canStoreSecrets()).toBe(false);
    await expect(store.setBuiltinApiKey("sk-live-123")).rejects.toThrow(/安全存储/);
    expect(await new FileStore().read(file)).toBeNull();
  });

  it("密文解不开时当作没设过，不把异常抛给调用方", async () => {
    await new FileStore().write(file, JSON.stringify({ "builtinAgent.apiKey": "坏密文" }));
    const codec: SecretCodec = {
      available: () => true,
      encrypt: () => "enc:x",
      decrypt: () => {
        throw new Error("DPAPI 解不开");
      },
    };

    expect(await createSecretStore(new FileStore(), file, codec).getBuiltinApiKey()).toBeNull();
  });

  it("密钥文件坏掉时当作空文件，不崩", async () => {
    await new FileStore().write(file, "{这不是 JSON）");

    const store = createSecretStore(new FileStore(), file, fakeCodec());

    expect(await store.getBuiltinApiKey()).toBeNull();
  });
});

describe("withoutApiKey", () => {
  it("发给渲染层的配置里没有密钥，且不改动原对象", () => {
    const config = defaultConfig();
    config.builtinAgent.apiKey = "sk-plain";

    const redacted = withoutApiKey(config);

    expect(redacted.builtinAgent.apiKey).toBeNull();
    expect(config.builtinAgent.apiKey).toBe("sk-plain");
    expect(redacted.builtinAgent.baseUrl).toBe(config.builtinAgent.baseUrl);
  });
});
