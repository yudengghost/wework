import { z } from "zod";

import { mentionPolicySchema, permissionModeSchema } from "../domain/schema";

export const launcherSettingsSchema = z.object({
  executablePath: z.string().min(1).nullable().default(null),
  detectWsl: z.boolean().default(false),
});
export type LauncherSettings = z.infer<typeof launcherSettingsSchema>;

export const schedulerSettingsSchema = z.object({
  /**
   * 单次运行的时间上限（毫秒）。null = 不限制，默认不限制。
   *
   * 默认不设限：员工正常干活时就可能轮次很多、跑很久，拿一个固定时长去杀它，
   * 等于把「慢」当成「坏」。真要中断就点停止。
   */
  wallClockBudgetMs: z.number().int().positive().nullable().default(null),
  /**
   * 每轮「员工接续触发」的运行上限。
   *
   * 人类点名的运行不受它约束——用户 @ 了几个人就该有几个人干活。
   * 它管的是员工之间互相 @ 那条链子：那是乘法增长（10 人各 @ 9 人，
   * 两层就上百次），不设阀会真的烧穿额度。
   */
  maxCascadeRuns: z.number().int().positive().default(12),
  maxMentionDepth: z.number().int().nonnegative().default(3),
  dedupeWindowMs: z.number().int().nonnegative().default(5000),
  /** 上下文条数上限：冷启动时作为起步窗口，之后作为增量的封顶。 */
  contextWindowMessages: z.number().int().positive().default(50),
});
export type SchedulerSettings = z.infer<typeof schedulerSettingsSchema>;

export const policySettingsSchema = z.object({
  employeeMentionsEmployee: mentionPolicySchema.default("auto"),
  employeeMentionsAll: mentionPolicySchema.default("confirm"),
  humanMentionsEmployee: mentionPolicySchema.default("auto"),
  defaultPermissionMode: permissionModeSchema.default("workspace-write"),
  /** 员工能否申请招人（模拟 HR）；confirm = 必须用户点允许才会真正创建。 */
  employeeMayHire: z.enum(["off", "confirm"]).default("confirm"),
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
  /** dark = 石墨深色；light = iOS 亮色液态玻璃；system = 跟随系统。 */
  theme: z.enum(["dark", "light", "system"]).default("dark"),
});
export type UiSettings = z.infer<typeof uiSettingsSchema>;

export const storageSettingsSchema = z.object({
  /** 自定义数据根目录；null 表示用应用默认目录。 */
  dataDir: z.string().min(1).nullable().default(null),
});
export type StorageSettings = z.infer<typeof storageSettingsSchema>;

export const memorySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** 在别的房间里学到的东西，是否也带进当前房间。 */
  crossRoomRecall: z.boolean().default(true),
  /** 累计多少次往来后归纳一次长期记忆。 */
  distillAfterPending: z.number().int().positive().default(6),
  /** 长期记忆条数上限，超出后最旧的会被折叠成摘要。 */
  maxFacts: z.number().int().positive().default(60),
  /** 每次运行注入多少条长期记忆。 */
  maxInjectedFacts: z.number().int().positive().default(6),
});
export type MemorySettings = z.infer<typeof memorySettingsSchema>;

export const skillsSettingsSchema = z.object({
  /** 额外的技能根目录，每个子目录放一个 SKILL.md。 */
  extraRoots: z.array(z.string()).default([]),
  /** 是否扫描 Codex / Claude Code 等框架自带的技能目录。 */
  includeFrameworkSkills: z.boolean().default(true),
});
export type SkillsSettings = z.infer<typeof skillsSettingsSchema>;

export const weworkConfigSchema = z.object({
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
  storage: storageSettingsSchema.default({}),
  memory: memorySettingsSchema.default({}),
  skills: skillsSettingsSchema.default({}),
});
export type WeworkConfig = z.infer<typeof weworkConfigSchema>;

export function defaultConfig(): WeworkConfig {
  return weworkConfigSchema.parse({});
}
