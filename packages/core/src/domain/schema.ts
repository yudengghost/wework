import { z } from "zod";

export const frameworkSchema = z.enum(["codex", "claude-code", "builtin"]);
export type Framework = z.infer<typeof frameworkSchema>;

export const permissionModeSchema = z.enum(["read-only", "workspace-write", "full"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const mentionPolicySchema = z.enum(["auto", "confirm"]);
export type MentionPolicy = z.infer<typeof mentionPolicySchema>;

export const isoDateTimeSchema = z.string().min(1);

export const permissionPolicySchema = z.object({
  mode: permissionModeSchema,
  allowedTools: z.array(z.string()).default([]),
  disallowedTools: z.array(z.string()).default([]),
  requireApprovalFor: z.array(z.string()).default([]),
});
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const employeeSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  framework: frameworkSchema,
  workspaceDir: z.string().min(1),
  stateDir: z.string().min(1),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  skills: z.array(z.string()).default([]),
  permissions: permissionPolicySchema,
  sessionRef: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
});
export type Employee = z.infer<typeof employeeSchema>;

export const mentionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("employee"), employeeId: z.string().min(1) }),
  z.object({ kind: z.literal("all") }),
]);
export type Mention = z.infer<typeof mentionSchema>;

export const attachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const messageSenderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human") }),
  z.object({ kind: z.literal("employee"), employeeId: z.string().min(1) }),
]);
export type MessageSender = z.infer<typeof messageSenderSchema>;

export const messageKindSchema = z.enum(["chat", "system", "run-event"]);
export type MessageKind = z.infer<typeof messageKindSchema>;

export const messageSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  sender: messageSenderSchema,
  mentions: z.array(mentionSchema).default([]),
  replyTo: z.string().min(1).optional(),
  body: z.string(),
  attachments: z.array(attachmentSchema).default([]),
  kind: messageKindSchema.default("chat"),
  createdAt: isoDateTimeSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const roomPolicySchema = z.object({
  maxConcurrentRuns: z.number().int().positive().optional(),
  maxMentionDepth: z.number().int().nonnegative().optional(),
  employeeMentionsEmployee: mentionPolicySchema.optional(),
  employeeMentionsAll: mentionPolicySchema.optional(),
});
export type RoomPolicy = z.infer<typeof roomPolicySchema>;

export const roomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** group = 多人房间；direct = 与单个员工的单聊。 */
  kind: z.enum(["group", "direct"]).default("group"),
  memberIds: z.array(z.string().min(1)).default([]),
  policy: roomPolicySchema.optional(),
  createdAt: isoDateTimeSchema,
});
export type Room = z.infer<typeof roomSchema>;

export const approvalRequestSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1),
  details: z.string().optional(),
  createdAt: isoDateTimeSchema,
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const runStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("queued") }),
  z.object({ status: z.literal("running"), startedAt: isoDateTimeSchema }),
  z.object({
    status: z.literal("awaiting-approval"),
    startedAt: isoDateTimeSchema,
    request: approvalRequestSchema,
  }),
  z.object({
    status: z.literal("done"),
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema,
  }),
  z.object({
    status: z.literal("failed"),
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema,
    error: z.string(),
  }),
  z.object({
    status: z.literal("cancelled"),
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema,
  }),
]);
export type RunState = z.infer<typeof runStateSchema>;
