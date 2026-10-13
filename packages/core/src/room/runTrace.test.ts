import { describe, expect, it } from "vitest";

import {
  MAX_RECORDS,
  MAX_STEPS_PER_RUN,
  MAX_TRACE_TEXT,
  RunTraceStore,
  formatDuration,
} from "./runTrace";

function clock(start = Date.parse("2026-10-13T10:00:00.000Z")): {
  now: () => Date;
  advance: (ms: number) => void;
} {
  let current = start;
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

function store(): { traces: RunTraceStore; advance: (ms: number) => void } {
  const time = clock();
  return { traces: new RunTraceStore(time.now), advance: time.advance };
}

describe("RunTraceStore", () => {
  it("入队那一刻就能查到记录：用户在员工开口之前就有东西可看", () => {
    const { traces } = store();
    traces.queue({ runId: "run_1", roomId: "room_1", employeeId: "emp_1", trigger: "写份周报" });

    const [trace] = traces.snapshot();
    expect(trace?.status).toBe("queued");
    expect(trace?.trigger).toBe("写份周报");
    expect(trace?.startedAt).toBeUndefined();
  });

  it("排队位置由队列现算，不写死在记录里", () => {
    const { traces } = store();
    traces.queue({ runId: "run_1", roomId: "room_1", employeeId: "emp_1", trigger: "a" });
    traces.queue({ runId: "run_2", roomId: "room_1", employeeId: "emp_2", trigger: "b" });

    const positions = new Map([
      ["run_1", 1],
      ["run_2", 2],
    ]);
    const snapshot = traces.snapshot(positions);
    expect(snapshot.map((trace) => [trace.runId, trace.position])).toEqual([
      ["run_1", 1],
      ["run_2", 2],
    ]);

    // 队列变短后位置跟着变，且开跑之后不再有位置。
    traces.start("run_1");
    const next = traces.snapshot(new Map([["run_2", 1]]));
    expect(next.map((trace) => [trace.runId, trace.position])).toEqual([
      ["run_1", undefined],
      ["run_2", 1],
    ]);
  });

  it("正在跑的排在排队的前面", () => {
    const { traces } = store();
    traces.queue({ runId: "run_queued", roomId: "room_1", employeeId: "emp_1", trigger: "a" });
    traces.queue({ runId: "run_running", roomId: "room_1", employeeId: "emp_2", trigger: "b" });
    traces.start("run_running");

    expect(traces.snapshot().map((trace) => trace.runId)).toEqual(["run_running", "run_queued"]);
  });

  it("步骤与文本都有上限，长任务不会把内存撑爆", () => {
    const { traces } = store();
    traces.queue({ runId: "run_1", roomId: "room_1", employeeId: "emp_1", trigger: "a" });
    traces.start("run_1");
    for (let index = 0; index < MAX_STEPS_PER_RUN * 2; index += 1) {
      traces.step("run_1", { kind: "tool", tool: "command_execution", detail: `cmd ${index}` });
    }
    traces.appendText("run_1", "x".repeat(MAX_TRACE_TEXT + 1000));

    const [trace] = traces.snapshot();
    expect(trace?.steps).toHaveLength(MAX_STEPS_PER_RUN);
    // 留的是尾部：界面上要看的是「刚写到哪」。
    expect(trace?.steps.at(-1)?.detail).toContain(`cmd ${MAX_STEPS_PER_RUN * 2 - 1}`);
    expect(trace?.text).toHaveLength(MAX_TRACE_TEXT);
    expect(trace?.textTruncated).toBe(true);
  });

  it("单步详情超长时截断，不会把整段输出搬进轨迹", () => {
    const { traces } = store();
    traces.queue({ runId: "run_1", roomId: "room_1", employeeId: "emp_1", trigger: "a" });
    traces.start("run_1");
    const stored = traces.step("run_1", {
      kind: "result",
      tool: "command_execution",
      ok: true,
      detail: "y".repeat(5000),
    });
    expect(stored?.detail?.length).toBeLessThan(300);
  });

  it("结束的记录归档且总量有上限，最旧的先丢", () => {
    const { traces } = store();
    for (let index = 0; index < MAX_RECORDS + 5; index += 1) {
      traces.queue({
        runId: `run_${index}`,
        roomId: "room_1",
        employeeId: "emp_1",
        trigger: `任务 ${index}`,
      });
      traces.finish(`run_${index}`, { status: "done" });
    }

    const snapshot = traces.snapshot();
    expect(snapshot).toHaveLength(MAX_RECORDS);
    expect(snapshot[0]?.runId).toBe(`run_${MAX_RECORDS + 4}`);
  });

  it("重复收尾是安全的：队列被取消时两条路径都可能来收尾", () => {
    const { traces } = store();
    traces.queue({ runId: "run_1", roomId: "room_1", employeeId: "emp_1", trigger: "a" });
    expect(traces.finish("run_1", { status: "stopped", reason: "已被用户停止" })?.status).toBe(
      "stopped",
    );
    expect(traces.finish("run_1", { status: "failed" })).toBeUndefined();
    expect(traces.snapshot()).toHaveLength(1);
  });

  it("record 记的是「受理了但没跑」", () => {
    const { traces } = store();
    traces.record({
      runId: "run_1",
      roomId: "room_1",
      employeeId: "emp_1",
      trigger: "再干一次",
      reason: "本轮运行次数已达上限",
    });

    const [trace] = traces.snapshot();
    expect(trace?.status).toBe("skipped");
    expect(trace?.reason).toBe("本轮运行次数已达上限");
  });

  it("返回的是副本，改快照不会影响内部状态", () => {
    const { traces } = store();
    traces.queue({ runId: "run_1", roomId: "room_1", employeeId: "emp_1", trigger: "a" });
    const [trace] = traces.snapshot();
    trace?.steps.push({ at: "x", kind: "note", text: "外部塞进来的" });
    expect(traces.snapshot()[0]?.steps).toEqual([]);
  });
});

describe("formatDuration", () => {
  it("按秒 / 分 / 小时给出人读的用时", () => {
    expect(formatDuration(0)).toBe("1 秒");
    expect(formatDuration(42_000)).toBe("42 秒");
    expect(formatDuration(192_000)).toBe("3 分 12 秒");
    expect(formatDuration(3_780_000)).toBe("1 小时 3 分");
  });
});
