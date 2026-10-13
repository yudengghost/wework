import { describe, expect, it } from "vitest";

import type { ApprovalEvent } from "./api";
import { groupApprovals, groupTitle } from "./approvals";

function approval(patch: Partial<ApprovalEvent> = {}): ApprovalEvent {
  return {
    approvalId: "appr_1",
    roomId: "room_1",
    employeeId: "emp_hr",
    targetId: "小前",
    summary: "招人申请：小前（codex）",
    kind: "hire",
    ...patch,
  };
}

describe("审批分组", () => {
  it("同一批次的多份招人申请合成一次审核", () => {
    const groups = groupApprovals([
      approval({ approvalId: "appr_1", targetId: "小前", batchId: "batch_1", batchIndex: 1, batchSize: 2 }),
      approval({ approvalId: "appr_2", targetId: "小后", batchId: "batch_1", batchIndex: 2, batchSize: 2 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.targetId)).toEqual(["小前", "小后"]);
    expect(groupTitle(groups[0]!, (id) => (id === "emp_hr" ? "HR主管" : id))).toBe(
      "HR主管 申请招 2 位员工",
    );
  });

  it("单份申请自己成组，标题只提那一位", () => {
    const groups = groupApprovals([approval({ batchId: "batch_1", batchSize: 1 })]);
    expect(groups).toHaveLength(1);
    expect(groupTitle(groups[0]!, () => "HR主管")).toBe("HR主管 申请招人");
  });

  it("不同批次不混在一起，顺序按先出现的排", () => {
    const groups = groupApprovals([
      approval({ approvalId: "appr_a", batchId: "batch_a", targetId: "甲" }),
      approval({ approvalId: "appr_b", batchId: "batch_b", targetId: "乙" }),
    ]);
    expect(groups.map((group) => group.items[0]?.targetId)).toEqual(["甲", "乙"]);
  });

  it("员工之间的放行各成一组，发起人取被 @ 的那位", () => {
    const groups = groupApprovals([
      approval({
        approvalId: "appr_run",
        kind: "run",
        employeeId: "emp_coder",
        targetId: "emp_reviewer",
        summary: "接力 → 小测",
      }),
    ]);

    expect(groups[0]?.kind).toBe("run");
    expect(groups[0]?.requesterId).toBe("emp_reviewer");
    expect(groupTitle(groups[0]!, (id) => (id === "emp_reviewer" ? "小测" : id))).toBe(
      "小测 被 @ 了，需要你确认才继续",
    );
  });
});
