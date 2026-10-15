import { describe, expect, it } from "vitest";

import type { RunTrace } from "@wework/core";

import {
  QUIET_HINT_MS,
  clockOf,
  currentAction,
  describeStep,
  elapsedMs,
  formatClock,
  isActive,
  quietMs,
  recentSteps,
  statusLabel,
  toolLabel,
  triggerLine,
} from "./runActivity";

function trace(patch: Partial<RunTrace> = {}): RunTrace {
  return {
    runId: "run_1",
    roomId: "room_1",
    employeeId: "emp_1",
    trigger: "写份周报",
    status: "running",
    queuedAt: "2026-10-13T10:00:00.000Z",
    startedAt: "2026-10-13T10:00:02.000Z",
    steps: [],
    text: "",
    textTruncated: false,
    ...patch,
  };
}

const at = (iso: string): number => Date.parse(iso);

describe("运行轨迹的措辞", () => {
  it("排队中要说清前面还有几个任务", () => {
    expect(currentAction(trace({ status: "queued", position: 1 }))).toBe("排队中，马上轮到");
    expect(currentAction(trace({ status: "queued", position: 3 }))).toBe(
      "排队中，前面还有 2 个任务",
    );
  });

  it("开跑之后说的是最近的动作，而不是一句空话", () => {
    expect(currentAction(trace())).toBe("已启动，正在生成…");
    expect(
      currentAction(
        trace({ steps: [{ at: "2026-10-13T10:00:03.000Z", kind: "tool", tool: "command_execution", detail: "npm test" }] }),
      ),
    ).toBe("执行命令：npm test");
    // 上一步是工具返回、下一步还没来：说明模型正在消化结果，而不是卡死。
    expect(
      currentAction(
        trace({
          steps: [{ at: "2026-10-13T10:00:04.000Z", kind: "result", tool: "command_execution", ok: true }],
        }),
      ),
    ).toBe("上一步已返回，继续处理中…");
  });

  it("结束的运行给出原因或结论", () => {
    expect(currentAction(trace({ status: "failed", error: "401 Unauthorized" }))).toBe(
      "401 Unauthorized",
    );
    expect(currentAction(trace({ status: "skipped", reason: "本轮运行次数已达上限" }))).toBe(
      "本轮运行次数已达上限",
    );
    expect(currentAction(trace({ status: "done" }))).toBe("已完成");
  });

  it("工具名翻译成人话，认不出就如实说调用了什么", () => {
    expect(toolLabel("command_execution")).toBe("执行命令");
    expect(toolLabel("Bash")).toBe("执行命令");
    expect(toolLabel("SomeNewTool")).toBe("调用 SomeNewTool");
    expect(toolLabel(undefined)).toBe("调用工具");
  });

  it("步骤描述覆盖五种形态", () => {
    expect(describeStep({ at: "", kind: "queued" })).toBe("已受理，排队等待");
    expect(describeStep({ at: "", kind: "started" })).toBe("开始执行");
    expect(describeStep({ at: "", kind: "tool", tool: "file_change", detail: "src/a.ts (update)" })).toBe(
      "改动文件：src/a.ts (update)",
    );
    expect(describeStep({ at: "", kind: "result", tool: "command_execution", ok: false, detail: "1 failed" })).toBe(
      "命令返回失败：1 failed",
    );
    expect(describeStep({ at: "", kind: "note", text: "模型返回了错误" })).toBe("模型返回了错误");
  });

  it("员工自己工作目录里的文件显示成相对路径", () => {
    // 取自一次真实运行：codex 的 file_change 给的是绝对路径，铺开有三行长
    // （路径本身换成通用样例，不在公开仓库里带作者本机的目录）
    const step = {
      at: "",
      kind: "tool" as const,
      tool: "file_change",
      detail:
        "D:\\wework-data\\workspaces\\emp_demo_coder\\notes\\a.md (add)、" +
        "D:\\wework-data\\workspaces\\emp_demo_coder\\notes\\b.md (add)",
    };
    expect(
      describeStep(step, {
        workspaceDir: "D:\\wework-data\\workspaces\\emp_demo_coder",
      }),
    ).toBe("改动文件：notes\\a.md (add)、notes\\b.md (add)");
  });

  it("工作目录之外的超长路径折叠成结尾两段", () => {
    // 同样是真实运行里的形状：codex 用绝对路径调 pwsh
    const step = {
      at: "",
      kind: "tool" as const,
      tool: "command_execution",
      detail:
        "\"C:\\\\Users\\\\31896\\\\.cache\\\\codex-runtimes\\\\codex-primary-runtime\\\\dependencies\\\\native\\\\powershell\\\\pwsh.exe\" -Command 'Get-ChildItem -Force'",
    };
    const text = describeStep(step, { workspaceDir: "E:\\tmp\\ws" });
    expect(text).toContain("…\\powershell\\pwsh.exe");
    expect(text).toContain("-Command 'Get-ChildItem -Force'");
    // 名不副实的长前缀不该占着位置
    expect(text).not.toContain("codex-runtimes");
  });

  it("短路径原样保留，不为了短而丢信息", () => {
    const step = {
      at: "",
      kind: "tool" as const,
      tool: "command_execution",
      detail: "npm test -- --run",
    };
    expect(describeStep(step, { workspaceDir: "E:\\tmp\\ws" })).toBe(
      "执行命令：npm test -- --run",
    );
  });
});

describe("运行轨迹的计时", () => {
  it("运行中按当前时间累计，结束后定格", () => {
    expect(elapsedMs(trace(), at("2026-10-13T10:00:32.000Z"))).toBe(30_000);
    expect(
      elapsedMs(trace({ finishedAt: "2026-10-13T10:01:02.000Z" }), at("2026-10-13T11:00:00.000Z")),
    ).toBe(60_000);
  });

  it("排队时间也算在内：用户等的是从发出消息开始的时长", () => {
    const queued = trace({ status: "queued", startedAt: undefined });
    expect(elapsedMs(queued, at("2026-10-13T10:00:05.000Z"))).toBe(5_000);
  });

  it("静默时长从最后一步算起，没有步骤就从启动算起", () => {
    expect(quietMs(trace(), at("2026-10-13T10:00:30.000Z"))).toBe(28_000);
    expect(
      quietMs(
        trace({ steps: [{ at: "2026-10-13T10:00:20.000Z", kind: "tool", tool: "Bash" }] }),
        at("2026-10-13T10:00:50.000Z"),
      ),
    ).toBe(30_000);
    expect(QUIET_HINT_MS).toBe(25_000);
  });

  it("秒表按 mm:ss 显示", () => {
    expect(clockOf(trace(), at("2026-10-13T10:00:32.000Z"))).toBe("00:30");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(3_723_000)).toBe("62:03");
  });
});

describe("运行轨迹的列表", () => {
  it("只回看最近几步", () => {
    const steps = Array.from({ length: 20 }, (_item, index) => ({
      at: `2026-10-13T10:00:${String(index).padStart(2, "0")}.000Z`,
      kind: "tool" as const,
      tool: "Bash",
      detail: `cmd ${index}`,
    }));
    const kept = recentSteps(trace({ steps }), 5);
    expect(kept).toHaveLength(5);
    expect(kept.at(-1)?.detail).toBe("cmd 19");
  });

  it("触发消息换行压平并截断", () => {
    expect(triggerLine(trace({ trigger: "写份\n周报" }))).toBe("写份 周报");
    expect(triggerLine(trace({ trigger: "长".repeat(100) }))?.length).toBe(61);
  });

  it("只有排队与在跑算「进行中」", () => {
    expect(isActive(trace())).toBe(true);
    expect(isActive(trace({ status: "queued" }))).toBe(true);
    for (const status of ["done", "failed", "skipped", "stopped"] as const) {
      expect(isActive(trace({ status }))).toBe(false);
    }
    expect(statusLabel("stopped")).toBe("已停止");
  });
});
