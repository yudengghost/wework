import { describe, expect, it } from "vitest";

import { weworkConfigSchema, defaultConfig } from "./schema";

describe("defaultConfig", () => {
  it("给出完整的默认配置", () => {
    expect(defaultConfig()).toEqual({
      version: 1,
      launchers: {
        codex: { executablePath: null, detectWsl: false },
        "claude-code": { executablePath: null, detectWsl: false },
      },
      scheduler: {
        wallClockBudgetMs: null,
        maxCascadeRuns: 12,
        dedupeWindowMs: 5000,
        contextWindowMessages: 50,
      },
      policy: {
        employeeMentionsEmployee: "auto",
        employeeMentionsAll: "confirm",
        humanMentionsEmployee: "auto",
        defaultPermissionMode: "workspace-write",
        employeeMayHire: "confirm",
      },
      builtinAgent: { baseUrl: null, apiKey: null, model: null },
      ui: { language: "zh-CN", showEmployeeThinking: false, theme: "dark" },
      storage: { dataDir: null },
      memory: {
        enabled: true,
        crossRoomRecall: true,
        distillAfterPending: 6,
        maxFacts: 60,
        maxInjectedFacts: 6,
      },
      skills: { extraRoots: [], includeFrameworkSkills: true },
    });
  });

  it("每次调用返回互不共享的对象", () => {
    const first = defaultConfig();
    first.scheduler.dedupeWindowMs = 99;

    expect(defaultConfig().scheduler.dedupeWindowMs).toBe(5000);
  });
});

describe("weworkConfigSchema", () => {
  it("部分输入被补全为完整配置", () => {
    const config = weworkConfigSchema.parse({
      policy: { employeeMentionsAll: "auto" },
    });

    expect(config.policy.employeeMentionsAll).toBe("auto");
    expect(config.policy.employeeMentionsEmployee).toBe("auto");
    expect(config.scheduler.dedupeWindowMs).toBe(5000);
  });

  it("拒绝非法的策略枚举值", () => {
    expect(() =>
      weworkConfigSchema.parse({ policy: { employeeMentionsEmployee: "maybe" } }),
    ).toThrow();
  });

  it("丢弃未知字段", () => {
    const config: unknown = weworkConfigSchema.parse({ unknownField: 1 });

    expect((config as Record<string, unknown>).unknownField).toBeUndefined();
  });
});
