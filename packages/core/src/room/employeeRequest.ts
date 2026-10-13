import { z } from "zod";

import { frameworkSchema, permissionModeSchema } from "../domain/schema";

/** 员工在回复里提议创建的新员工（模拟 HR 的"招人申请"）。 */
export const employeeDraftSchema = z.object({
  displayName: z.string().min(1).max(40),
  framework: frameworkSchema,
  model: z.string().min(1).max(120).optional(),
  systemPrompt: z.string().max(4000).optional(),
  skills: z.array(z.string()).max(64).optional(),
  /**
   * HR 自己从网上找来、已经下载到它工作目录里的技能：写相对路径，指向含 SKILL.md 的目录。
   * 批准后由应用装进技能目录，并自动给新同事启用。
   */
  installSkills: z.array(z.string().min(1).max(200)).max(8).optional(),
  permissionMode: permissionModeSchema.optional(),
  workspaceDir: z.string().min(1).max(400).optional(),
});
export type EmployeeDraft = z.infer<typeof employeeDraftSchema>;

export interface EmployeeRequestBody {
  /** 去掉协议块之后、可以显示给人类的正文。 */
  body: string;
  drafts: EmployeeDraft[];
  /** 协议块存在但内容不合法——必须让用户看见，而不是静默忽略。 */
  errors: string[];
}

/**
 * 从回复正文里抽出创建员工的申请。
 *
 * 约定：一个围栏代码块，开头的语言标记里带 marker（默认 `@@create-employee`），
 * 块体是这段 JSON。用围栏而不是裸 JSON，是为了让模型在正文里夹带别的代码时也能可靠区分。
 */
export function extractEmployeeRequests(body: string, marker: string): EmployeeRequestBody {
  const drafts: EmployeeDraft[] = [];
  const errors: string[] = [];
  const kept: string[] = [];

  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match = fence.exec(body);

  while (match !== null) {
    const header = match[1] ?? "";
    if (!header.includes(marker)) {
      match = fence.exec(body);
      continue;
    }

    kept.push(body.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    let json: unknown;
    try {
      json = JSON.parse((match[2] ?? "").trim());
    } catch (error) {
      errors.push(
        `申请块的 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      );
      match = fence.exec(body);
      continue;
    }

    // 把可选字段的空字符串当成"没填"：模型很自然会把可选字段留成 ""，
    // 因为一个空的可选字段就否掉整条申请，是校验太苛刻，不是模型错了。
    const record =
      typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && value.trim() === "") continue;
      cleaned[key] = value;
    }

    const parsed = employeeDraftSchema.safeParse(cleaned);
    if (!parsed.success) {
      errors.push(
        `申请内容不合法：${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(根)"} ${issue.message}`)
          .join("；")}`,
      );
    } else {
      drafts.push(parsed.data);
    }
    match = fence.exec(body);
  }

  if (drafts.length === 0 && errors.length === 0) {
    return { body, drafts, errors };
  }

  kept.push(body.slice(cursor));
  return { body: kept.join("").replace(/\n{3,}/g, "\n\n").trim(), drafts, errors };
}
