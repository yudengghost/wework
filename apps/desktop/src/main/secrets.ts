import type { WeworkConfig, TextFileStore } from "@wework/core";

// 加密能力由主进程注入（Electron 的 safeStorage：Windows 上就是 DPAPI）。
// 这里刻意不 import electron，纯逻辑单元测试才跑得起来。
export interface SecretCodec {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

export interface SecretStore {
  /** 本机是否具备安全存储能力；不支持时不允许保存密钥。 */
  canStoreSecrets(): boolean;
  /** 存或清内置兜底员工的 API Key（null = 清除）。 */
  setBuiltinApiKey(value: string | null): Promise<void>;
  /** 取回明文密钥；没设过、解不开、系统不支持都返回 null。 */
  getBuiltinApiKey(): Promise<string | null>;
}

const builtinApiKeyField = "builtinAgent.apiKey";

// 单独的密钥文件：config.json 是用户手改/可携带的，明文密钥不该混在里面。
export function createSecretStore(
  store: TextFileStore,
  filePath: string,
  codec: SecretCodec,
): SecretStore {
  const readAll = async (): Promise<Record<string, string>> => {
    const raw = await store.read(filePath);
    if (raw === null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return {};
      const entries: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string") entries[key] = value;
      }
      return entries;
    } catch {
      // 密钥文件坏掉时当作空文件：宁可让用户重填一次，也不要让应用起不来。
      return {};
    }
  };

  const persist = async (entries: Record<string, string>): Promise<void> => {
    await store.write(filePath, `${JSON.stringify(entries, null, 2)}\n`);
  };

  return {
    canStoreSecrets: () => codec.available(),

    async setBuiltinApiKey(value: string | null): Promise<void> {
      const entries = await readAll();
      if (value === null || value.trim() === "") {
        delete entries[builtinApiKeyField];
        await persist(entries);
        return;
      }
      if (!codec.available()) {
        throw new Error("当前系统不支持安全存储，密钥没有保存");
      }
      entries[builtinApiKeyField] = codec.encrypt(value);
      await persist(entries);
    },

    async getBuiltinApiKey(): Promise<string | null> {
      const entry = (await readAll())[builtinApiKeyField];
      if (entry === undefined || !codec.available()) return null;
      try {
        const plain = codec.decrypt(entry);
        return plain === "" ? null : plain;
      } catch {
        // 换了机器、系统凭据变了、文件被改坏：都当作「没设过」，不要炸在调用方。
        return null;
      }
    },
  };
}

/** 发给渲染层的配置：API Key 永不外发，界面只需要知道「设没设」。 */
export function withoutApiKey(config: WeworkConfig): WeworkConfig {
  return {
    ...config,
    builtinAgent: { ...config.builtinAgent, apiKey: null },
  };
}
