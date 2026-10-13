import type { ApprovalEvent } from "./api";

/**
 * 待审批事项按「一次申请」分组。
 *
 * HR 一次提交多份招人申请时，核心会给它们同一个 batchId、并逐份发审批事件。
 * 对用户来说这是**一次**审核（一个批次、一个人拍板），所以这里合成一组；
 * 员工 @ 员工那种单件放行本来就只带自己的 id，各自成组。
 */
export interface ApprovalGroup {
  key: string;
  /** 发起人的员工 id（招人申请是 HR；传递放行是被 @ 的那位）。 */
  requesterId: string;
  kind: "hire" | "run";
  items: ApprovalEvent[];
}

export function groupApprovals(approvals: ApprovalEvent[]): ApprovalGroup[] {
  const groups = new Map<string, ApprovalGroup>();
  for (const approval of approvals) {
    const key = approval.batchId ?? approval.approvalId;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(approval);
      continue;
    }
    groups.set(key, {
      key,
      requesterId: approval.kind === "hire" ? approval.employeeId : approval.targetId,
      kind: approval.kind === "hire" ? "hire" : "run",
      items: [approval],
    });
  }
  return [...groups.values()];
}

/** 一次审核的标题：单份就是那一位，多份说清是几位候选人。 */
export function groupTitle(group: ApprovalGroup, nameOf: (id: string) => string): string {
  const who = nameOf(group.requesterId);
  if (group.kind !== "hire") return `${who} 被 @ 了，需要你确认才继续`;
  return group.items.length === 1
    ? `${who} 申请招人`
    : `${who} 申请招 ${group.items.length} 位员工`;
}
