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

/** wallClockBudgetMs 在改成「默认可选」之前的默认值。 */
const legacyRunTimeoutMs = 600000;

/**
 * 把老配置里「从旧默认值抄下来」的字段清掉。
 *
 * 为什么非做不可：默认值一旦被写进用户文件，改默认值就对这些人失效。
 * wallClockBudgetMs 以前默认 600000（10 分钟），现在默认不限制（null）；
 * 用户文件里那个 600000 几乎必然来自旧默认值而不是有意选择，留着它，
 * 「跑得久不再被杀」这个修复就永远落不到他身上——他只会继续收到「运行超时」。
 * 真想要 10 分钟上限，在设置里重新填一次即可。
 */
function normalizeLegacy(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const config = raw as { scheduler?: unknown };
  if (typeof config.scheduler !== "object" || config.scheduler === null) return raw;
  const scheduler = { ...(config.scheduler as Record<string, unknown>) };
  if (scheduler.wallClockBudgetMs === legacyRunTimeoutMs) delete scheduler.wallClockBudgetMs;
  return { ...config, scheduler };
}

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

    const parsed = weworkConfigSchema.safeParse(deepMerge(defaultConfig(), normalizeLegacy(json)));
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
