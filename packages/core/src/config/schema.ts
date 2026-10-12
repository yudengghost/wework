import { z } from "zod";

import { mentionPolicySchema, permissionModeSchema } from "../domain/schema";

export const launcherSettingsSchema = z.object({
  executablePath: z.string().min(1).nullable().default(null),
  detectWsl: z.boolean().default(false),
});
export type LauncherSettings = z.infer<typeof launcherSettingsSchema>;

export const schedulerSettingsSchema = z.object({
  maxConcurrentRuns: z.number().int().positive().default(3),
  maxRunsPerTurn: z.number().int().positive().default(5),
  maxTotalRunsPerRoom: z.number().int().positive().default(50),
  maxMentionDepth: z.number().int().nonnegative().default(3),
  dedupeWindowMs: z.number().int().nonnegative().default(5000),
  wallClockBudgetMs: z.number().int().positive().default(600000),
  contextWindowMessages: z.number().int().positive().default(50),
});
export type SchedulerSettings = z.infer<typeof schedulerSettingsSchema>;

export const policySettingsSchema = z.object({
  employeeMentionsEmployee: mentionPolicySchema.default("auto"),
  employeeMentionsAll: mentionPolicySchema.default("confirm"),
  humanMentionsEmployee: mentionPolicySchema.default("auto"),
  defaultPermissionMode: permissionModeSchema.default("workspace-write"),
});
export type PolicySettings = z.infer<typeof policySettingsSchema>;

export const builtinAgentSettingsSchema = z.object({
  baseUrl: z.string().min(1).nullable().default(null),
  apiKey: z.string().min(1).nullable().default(null),
  model: z.string().min(1).nullable().default(null),
});
export type BuiltinAgentSettings = z.infer<typeof builtinAgentSettingsSchema>;

export const uiSettingsSchema = z.object({
  language: z.string().min(1).default("zh-CN"),
  showEmployeeThinking: z.boolean().default(false),
});
export type UiSettings = z.infer<typeof uiSettingsSchema>;

export const buddyConfigSchema = z.object({
  version: z.literal(1).default(1),
  launchers: z
    .object({
      codex: launcherSettingsSchema.default({}),
      "claude-code": launcherSettingsSchema.default({}),
    })
    .default({}),
  scheduler: schedulerSettingsSchema.default({}),
  policy: policySettingsSchema.default({}),
  builtinAgent: builtinAgentSettingsSchema.default({}),
  ui: uiSettingsSchema.default({}),
});
export type BuddyConfig = z.infer<typeof buddyConfigSchema>;

export function defaultConfig(): BuddyConfig {
  return buddyConfigSchema.parse({});
}
