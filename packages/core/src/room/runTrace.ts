/**
 * 运行轨迹：把「一次员工运行」的全过程记成可查询的记录。
 *
 * 存在的理由是一个真实的体验缺陷：消息发出去之后，界面上除了一个静止的
 * 「正在思考…」什么都没有——员工在排队、在跑命令、还是根本没启动起来，
 * 用户分辨不出来。轨迹把「排队 → 启动 → 调工具 → 产出 / 失败」这一段
 * 变成可读的步骤流。
 *
 * 两条边界：
 * - 轨迹是**运行期的观察窗**，不是聊天记录。它不落进房间消息、不进上下文，
 *   重启即消失（进程内的运行本来也不会跨重启存活）。
 * - 全部结构都有界：单次运行的步骤数、文本长度、保留的记录条数都封顶，
 *   长时间使用不会无限增长。
 */

export type RunStatus = "queued" | "running" | "done" | "failed" | "skipped" | "stopped";

export type RunStepKind = "queued" | "started" | "tool" | "result" | "note";

export interface RunStep {
  at: string;
  kind: RunStepKind;
  /** 工具名，保留框架原文（command_execution / Bash / Read…），措辞交给界面层。 */
  tool?: string;
  /** 一行摘要：命令原文、参数或输出片段，已截断。 */
  detail?: string;
  /** 工具结果是否成功。 */
  ok?: boolean;
  /** note 用的说明文本，由调度器生成。 */
  text?: string;
}

export interface RunTrace {
  runId: string;
  roomId: string;
  employeeId: string;
  /** 触发这次运行的消息摘要，用来在界面上认出「这是哪条任务」。 */
  trigger: string;
  status: RunStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** 排队位置，1 = 下一个被执行；只有 queued 时有值。 */
  position?: number;
  steps: RunStep[];
  /** 已产出的可见文本；超长时只留尾部，界面另有完整正文。 */
  text: string;
  textTruncated: boolean;
  error?: string;
  reason?: string;
}

/** 单次运行的步骤上限：命令跑得再多也不该把内存与界面撑爆。 */
export const MAX_STEPS_PER_RUN = 60;
/** 单次运行在轨迹里留存的文本上限（超出只留尾部）。 */
export const MAX_TRACE_TEXT = 8000;
/** 保留多少条「已结束」的记录供回看。 */
export const MAX_RECORDS = 40;
const MAX_STEP_DETAIL = 240;
const MAX_TRIGGER = 80;
const MAX_ERROR = 200;

export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " / ").trim();
}

export function truncate(text: string, max: number): string {
  const flat = oneLine(text);
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/** 人读的用时：给房间里的说明文字与界面上的计时共用，避免两处各写一遍。 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/** 保留尾部：界面上的实时预览要看的是「刚写到哪」，不是开头。 */
function truncateTail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

function clone(trace: RunTrace): RunTrace {
  return { ...trace, steps: trace.steps.map((step) => ({ ...step })) };
}

export interface QueueInput {
  runId: string;
  roomId: string;
  employeeId: string;
  trigger: string;
  status?: RunStatus;
  reason?: string;
}

export class RunTraceStore {
  private readonly active = new Map<string, RunTrace>();
  private readonly finished: RunTrace[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * 记录一次「受理」。放在入队那一刻而不是真正开始时：用户按下发送之后
   * 到员工开口之间的空档，正是他最容易怀疑「是不是没反应」的时段。
   */
  queue(input: QueueInput): RunTrace {
    const trace: RunTrace = {
      runId: input.runId,
      roomId: input.roomId,
      employeeId: input.employeeId,
      trigger: truncate(input.trigger, MAX_TRIGGER),
      status: input.status ?? "queued",
      queuedAt: this.now().toISOString(),
      steps: [],
      text: "",
      textTruncated: false,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    };
    this.active.set(trace.runId, trace);
    return clone(trace);
  }

  /** 受理了但没开始就结束（预算用尽、重复消息、员工不存在…）。 */
  record(input: QueueInput): RunTrace {
    const trace = this.queue({ ...input, status: input.status ?? "skipped" });
    this.finish(trace.runId, { status: trace.status, reason: input.reason });
    return clone(trace);
  }

  step(runId: string, step: Omit<RunStep, "at">): RunStep | undefined {
    const trace = this.active.get(runId);
    if (!trace) return undefined;
    const detail = step.detail === undefined ? undefined : truncate(step.detail, MAX_STEP_DETAIL);
    const stored: RunStep = {
      ...step,
      ...(detail === undefined ? {} : { detail }),
      at: this.now().toISOString(),
    };
    trace.steps.push(stored);
    if (trace.steps.length > MAX_STEPS_PER_RUN) trace.steps.splice(0, trace.steps.length - MAX_STEPS_PER_RUN);
    return stored;
  }

  start(runId: string): void {
    const trace = this.active.get(runId);
    if (!trace) return;
    trace.status = "running";
    trace.startedAt = this.now().toISOString();
    trace.position = undefined;
    this.step(runId, { kind: "started" });
  }

  appendText(runId: string, delta: string): void {
    const trace = this.active.get(runId);
    if (!trace || delta === "") return;
    const next = trace.text + delta;
    if (next.length > MAX_TRACE_TEXT) {
      trace.text = truncateTail(next, MAX_TRACE_TEXT);
      trace.textTruncated = true;
    } else {
      trace.text = next;
    }
  }

  /** 结束并归档。重复调用是安全的（队列被取消时可能两边都来收尾）。 */
  finish(
    runId: string,
    patch: { status: RunStatus; error?: string; reason?: string; note?: string },
  ): RunTrace | undefined {
    const trace = this.active.get(runId);
    if (!trace) return undefined;
    trace.status = patch.status;
    trace.finishedAt = this.now().toISOString();
    trace.position = undefined;
    if (patch.error !== undefined) trace.error = truncate(patch.error, MAX_ERROR);
    if (patch.reason !== undefined) trace.reason = patch.reason;
    if (patch.note !== undefined) this.step(runId, { kind: "note", text: patch.note });
    this.archive(trace);
    return clone(trace);
  }

  get(runId: string): RunTrace | undefined {
    const trace = this.active.get(runId) ?? this.finished.find((item) => item.runId === runId);
    return trace === undefined ? undefined : clone(trace);
  }

  /** 队列位置由调度器算好传进来：位置是队列的属性，不是记录的属性。 */
  snapshot(positions: ReadonlyMap<string, number> = new Map()): RunTrace[] {
    const active = [...this.active.values()];
    const running = active
      .filter((trace) => trace.status === "running")
      .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
    const queued = active
      .filter((trace) => trace.status !== "running")
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

    return [...running, ...queued].map((trace) => {
      const copy = clone(trace);
      const position = positions.get(copy.runId);
      if (position !== undefined && copy.status === "queued") copy.position = position;
      return copy;
    }).concat(this.finished.map((trace) => clone(trace)));
  }

  private archive(trace: RunTrace): void {
    this.active.delete(trace.runId);
    this.finished.unshift(trace);
    if (this.finished.length > MAX_RECORDS) this.finished.length = MAX_RECORDS;
  }
}
