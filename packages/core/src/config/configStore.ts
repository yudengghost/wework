import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";
import { deepMerge } from "./merge";
import { weworkConfigSchema, defaultConfig, type WeworkConfig } from "./schema";

export class ConfigNotLoadedError extends Error {
  constructor(message = "配置尚未加载，请先调用 load()") {
    super(message);
    this.name = "ConfigNotLoadedError";
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export class ConfigStore {
  private current: WeworkConfig | null = null;

  constructor(
    private readonly store: TextFileStore,
    private readonly filePath: string,
  ) {}

  async load(): Promise<WeworkConfig> {
    const raw = await this.store.read(this.filePath);
    if (raw === null) {
      this.current = defaultConfig();
      return this.current;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new DataParseError("配置文件不是合法 JSON", this.filePath, error);
    }

    const parsed = weworkConfigSchema.safeParse(deepMerge(defaultConfig(), json));
    if (!parsed.success) {
      throw new DataParseError(`配置校验失败: ${parsed.error.message}`, this.filePath);
    }

    this.current = parsed.data;
    return this.current;
  }

  get(): WeworkConfig {
    if (!this.current) throw new ConfigNotLoadedError();
    return this.current;
  }

  async update(patch: DeepPartial<WeworkConfig>): Promise<WeworkConfig> {
    if (!this.current) throw new ConfigNotLoadedError();
    const merged = weworkConfigSchema.parse(deepMerge(this.current, patch));
    this.current = merged;
    await this.persist();
    return merged;
  }

  async persist(): Promise<void> {
    if (!this.current) throw new ConfigNotLoadedError();
    await this.store.write(this.filePath, `${JSON.stringify(this.current, null, 2)}\n`);
  }
}
