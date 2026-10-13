import { describe, expect, it } from "vitest";

import { buddyConfigSchema, defaultConfig } from "./schema";

describe("defaultConfig", () => {
  it("给出完整的默认配置", () => {
    expect(defaultConfig()).toEqual({
      version: 1,
      launchers: {
        codex: { executablePath: null, detectWsl: false },
        "claude-code": { executablePath: null, detectWsl: false },
      },
      scheduler: {
        maxConcurrentRuns: 3,
        maxRunsPerTurn: 5,
        maxTotalRunsPerRoom: 50,
        maxMentionDepth: 3,
        dedupeWindowMs: 5000,
        wallClockBudgetMs: 600000,
        contextWindowMessages: 50,
        maxEmployeeCreationsPerRoom: 3,
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
    first.scheduler.maxConcurrentRuns = 99;

    expect(defaultConfig().scheduler.maxConcurrentRuns).toBe(3);
  });
});

describe("buddyConfigSchema", () => {
  it("部分输入被补全为完整配置", () => {
    const config = buddyConfigSchema.parse({
      policy: { employeeMentionsAll: "auto" },
    });

    expect(config.policy.employeeMentionsAll).toBe("auto");
    expect(config.policy.employeeMentionsEmployee).toBe("auto");
    expect(config.scheduler.maxConcurrentRuns).toBe(3);
  });

  it("拒绝非法的策略枚举值", () => {
    expect(() =>
      buddyConfigSchema.parse({ policy: { employeeMentionsEmployee: "maybe" } }),
    ).toThrow();
  });

  it("丢弃未知字段", () => {
    const config: unknown = buddyConfigSchema.parse({ unknownField: 1 });

    expect((config as Record<string, unknown>).unknownField).toBeUndefined();
  });
});
