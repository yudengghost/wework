import type { AdapterCreation } from "../adapters/createAdapter";
import type { AgentAdapter, AgentEvent } from "../adapters/events";
import type { ConfigStore } from "../config/configStore";
import { createId } from "../domain/ids";
import type { Employee, Mention, Message, Room } from "../domain/schema";
import type { EmployeeStore } from "../employee/employeeStore";
import { EventBus } from "../events/eventBus";
import { parseMentions } from "./mentions";
import type { MessageLog } from "./messageLog";
import type { RoomStore } from "./roomStore";

export interface RoomServiceEvents extends Record<string, unknown> {
  message: Message;
  "run-started": { roomId: string; employeeId: string; runId: string };
  "run-text": { roomId: string; employeeId: string; runId: string; delta: string };
  "run-finished": { roomId: string; employeeId: string; runId: string; ok: boolean; error?: string };
  "run-skipped": { roomId: string; employeeId: string; reason: string };
  "approval-requested": {
    approvalId: string;
    roomId: string;
    employeeId: string;
    targetId: string;
    summary: string;
  };
}

export interface RoomServiceDeps {
  config: ConfigStore;
  employees: EmployeeStore;
  rooms: RoomStore;
  messages: MessageLog;
  createAdapter: (employee: Employee) => Promise<AdapterCreation>;
  events?: EventBus<RoomServiceEvents>;
  now?: () => Date;
}

interface RunTask {
  runId: string;
  roomId: string;
  employeeId: string;
  depth: number;
  trigger: Message;
  turn: TurnBudget;
}

interface TurnBudget {
  remainingRuns: number;
}

interface PendingApproval {
  task: RunTask;
  targetId: string;
}

/**
 * 房间调度器：消息进、员工跑、回复回房间，并负责所有刹车。
 *
 * 它不认识任何具体 CLI：拿适配器靠注入的 createAdapter，因此 Plan 4 的全部行为都能用
 * FakeAdapter 确定性地测出来。
 */
export class RoomService {
  private readonly events: EventBus<RoomServiceEvents>;
  private readonly now: () => Date;
  private readonly queue: RunTask[] = [];
  private readonly running = new Set<Promise<void>>();
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly roomRunCounts = new Map<string, number>();
  private readonly recentTriggers = new Map<string, number>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private drainPromise: Promise<void> | null = null;

  constructor(private readonly deps: RoomServiceDeps) {
    this.events = deps.events ?? new EventBus<RoomServiceEvents>();
    this.now = deps.now ?? (() => new Date());
  }

  getEvents(): EventBus<RoomServiceEvents> {
    return this.events;
  }

  async listMessages(roomId: string, limit?: number): Promise<Message[]> {
    return limit === undefined
      ? this.deps.messages.readAll(roomId)
      : this.deps.messages.readRecent(roomId, limit);
  }

  /** 人类发一条消息：落库、解析 @、按策略投递。 */
  async submitHumanMessage(roomId: string, body: string): Promise<Message> {
    const room = this.requireRoom(roomId);
    const parsed = parseMentions(body, this.candidates());
    const message = await this.appendMessage({
      roomId,
      sender: { kind: "human" },
      body,
      mentions: parsed.mentions,
    });

    const policy = this.deps.config.get().policy.humanMentionsEmployee;
    const targets = this.expandTargets(room, parsed.mentions, null);
    const turn: TurnBudget = { remainingRuns: this.deps.config.get().scheduler.maxRunsPerTurn };

    for (const employeeId of targets) {
      if (policy === "confirm") {
        this.requestApproval(roomId, employeeId, employeeId, message, turn, 0);
        continue;
      }
      this.enqueue({ roomId, employeeId, depth: 0, trigger: message, turn });
    }

    this.kickDrain();
    return message;
  }

  /** 人类对「员工 @ 员工」的放行决定。 */
  async resolveApproval(approvalId: string, approved: boolean): Promise<boolean> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    this.pendingApprovals.delete(approvalId);
    if (approved) {
      this.queue.push(pending.task);
      this.kickDrain();
    }
    return true;
  }

  /** 一键停止：清空队列并中止所有在跑的 run。 */
  stopAll(): number {
    const cancelled = this.queue.length + this.activeRuns.size;
    this.queue.length = 0;
    for (const controller of this.activeRuns.values()) controller.abort();
    this.activeRuns.clear();
    return cancelled;
  }

  async waitForIdle(): Promise<void> {
    for (;;) {
      this.kickDrain();
      const current = this.drainPromise;
      if (current) await current;
      if (this.queue.length === 0 && this.running.size === 0) return;
    }
  }

  // ---- 内部 ----

  private candidates(): { id: string; displayName: string }[] {
    return this.deps.employees.list().map((employee) => ({
      id: employee.id,
      displayName: employee.displayName,
    }));
  }

  private requireRoom(roomId: string): Room {
    const room = this.deps.rooms.get(roomId);
    if (!room) throw new Error(`房间不存在: ${roomId}`);
    return room;
  }

  private expandTargets(
    room: Room,
    mentions: Mention[],
    senderEmployeeId: string | null,
  ): string[] {
    const targets = new Set<string>();
    for (const mention of mentions) {
      if (mention.kind === "all") {
        for (const memberId of room.memberIds) {
          if (memberId !== senderEmployeeId) targets.add(memberId);
        }
      } else if (room.memberIds.includes(mention.employeeId)) {
        targets.add(mention.employeeId);
      }
    }
    return [...targets];
  }

  private enqueue(input: Omit<RunTask, "runId">): void {
    const { scheduler } = this.deps.config.get();

    const roomRuns = this.roomRunCounts.get(input.roomId) ?? 0;
    if (roomRuns >= scheduler.maxTotalRunsPerRoom) {
      this.skip(input.roomId, input.employeeId, "本房间运行次数已达上限");
      return;
    }
    if (input.turn.remainingRuns <= 0) {
      this.skip(input.roomId, input.employeeId, "本轮运行次数已达上限");
      return;
    }
    if (input.depth > scheduler.maxMentionDepth) {
      this.skip(input.roomId, input.employeeId, "@ 接续层数超出上限");
      return;
    }

    const senderKey =
      input.trigger.sender.kind === "human" ? "human" : input.trigger.sender.employeeId;
    const dedupeKey = `${input.employeeId}|${senderKey}|${input.trigger.body}`;
    const at = this.now().getTime();
    const previous = this.recentTriggers.get(dedupeKey);
    if (previous !== undefined && at - previous < scheduler.dedupeWindowMs) {
      this.skip(input.roomId, input.employeeId, "重复消息已忽略");
      return;
    }
    this.recentTriggers.set(dedupeKey, at);

    input.turn.remainingRuns -= 1;
    this.queue.push({ ...input, runId: createId("run") });
  }

  private skip(roomId: string, employeeId: string, reason: string): void {
    this.events.emit("run-skipped", { roomId, employeeId, reason });
  }

  private requestApproval(
    roomId: string,
    employeeId: string,
    targetId: string,
    trigger: Message,
    turn: TurnBudget,
    depth: number,
  ): void {
    const approvalId = createId("appr");
    const target = this.deps.employees.get(employeeId);
    this.pendingApprovals.set(approvalId, {
      targetId,
      task: { runId: createId("run"), roomId, employeeId, depth, trigger, turn },
    });
    this.events.emit("approval-requested", {
      approvalId,
      roomId,
      employeeId,
      targetId,
      summary: `${trigger.body.slice(0, 60)} → ${target?.displayName ?? targetId}`,
    });
  }

  private kickDrain(): void {
    if (this.drainPromise) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
    });
  }

  private async drain(): Promise<void> {
    const { maxConcurrentRuns } = this.deps.config.get().scheduler;
    while (this.queue.length > 0) {
      if (this.running.size >= maxConcurrentRuns) {
        await Promise.race([...this.running]);
        continue;
      }
      const task = this.queue.shift();
      if (!task) break;
      const promise = this.executeRun(task)
        .catch(() => undefined)
        .finally(() => {
          this.running.delete(promise);
        });
      this.running.add(promise);
    }
    await Promise.all([...this.running]);
  }

  private async executeRun(task: RunTask): Promise<void> {
    const employee = this.deps.employees.get(task.employeeId);
    if (!employee) {
      this.skip(task.roomId, task.employeeId, "员工不存在");
      return;
    }

    this.roomRunCounts.set(task.roomId, (this.roomRunCounts.get(task.roomId) ?? 0) + 1);

    const created = await this.deps.createAdapter(employee);
    if (!created.ok) {
      this.skip(task.roomId, task.employeeId, created.reason);
      return;
    }

    const controller = new AbortController();
    this.activeRuns.set(task.runId, controller);
    this.events.emit("run-started", {
      roomId: task.roomId,
      employeeId: task.employeeId,
      runId: task.runId,
    });

    try {
      const prompt = await this.buildPrompt(task, employee);
      const result = await created.adapter.run(
        {
          prompt,
          systemPrompt: employee.systemPrompt,
          cwd: employee.workspaceDir,
          model: employee.model,
          permissions: employee.permissions,
          sessionRef: employee.sessionRef,
          signal: controller.signal,
          timeoutMs: this.deps.config.get().scheduler.wallClockBudgetMs,
        },
        (event) => this.forwardEvent(task, event),
      );

      if (result.sessionRef && result.sessionRef !== employee.sessionRef) {
        await this.deps.employees
          .update(employee.id, { sessionRef: result.sessionRef })
          .catch(() => undefined);
      }

      if (!result.ok) {
        this.events.emit("run-finished", {
          roomId: task.roomId,
          employeeId: task.employeeId,
          runId: task.runId,
          ok: false,
          error: result.cancelled
            ? "已取消"
            : result.timedOut
              ? "运行超时"
              : result.stderr.trim() || "运行失败",
        });
        return;
      }

      const body = result.text.trim();
      if (body !== "") {
        const room = this.deps.rooms.get(task.roomId);
        const parsed = parseMentions(body, this.candidates());
        const reply = await this.appendMessage({
          roomId: task.roomId,
          sender: { kind: "employee", employeeId: employee.id },
          body,
          mentions: parsed.mentions,
        });
        if (room) await this.followUpMentions(room, reply, task);
      }

      this.events.emit("run-finished", {
        roomId: task.roomId,
        employeeId: task.employeeId,
        runId: task.runId,
        ok: true,
      });
    } catch (error) {
      this.events.emit("run-finished", {
        roomId: task.roomId,
        employeeId: task.employeeId,
        runId: task.runId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.activeRuns.delete(task.runId);
    }
  }

  private async followUpMentions(room: Room, reply: Message, parent: RunTask): Promise<void> {
    const targets = this.expandTargets(room, reply.mentions, parent.employeeId);
    for (const employeeId of targets) {
      const mentionsAll = reply.mentions.some((mention) => mention.kind === "all");
      const policy = this.mentionPolicy(room, mentionsAll ? "all" : "employee");
      if (policy === "confirm") {
        this.requestApproval(room.id, employeeId, employeeId, reply, parent.turn, parent.depth + 1);
        continue;
      }
      this.enqueue({
        roomId: room.id,
        employeeId,
        depth: parent.depth + 1,
        trigger: reply,
        turn: parent.turn,
      });
    }
  }

  private mentionPolicy(room: Room, kind: "employee" | "all"): "auto" | "confirm" {
    const { policy } = this.deps.config.get();
    return kind === "all"
      ? (room.policy?.employeeMentionsAll ?? policy.employeeMentionsAll)
      : (room.policy?.employeeMentionsEmployee ?? policy.employeeMentionsEmployee);
  }

  private forwardEvent(task: RunTask, event: AgentEvent): void {
    if (event.type === "text" || event.type === "reasoning") {
      this.events.emit("run-text", {
        roomId: task.roomId,
        employeeId: task.employeeId,
        runId: task.runId,
        delta: event.text,
      });
    }
  }

  private async buildPrompt(task: RunTask, employee: Employee): Promise<string> {
    const { contextWindowMessages } = this.deps.config.get().scheduler;
    const transcript = await this.deps.messages.readRecent(task.roomId, contextWindowMessages);
    const lines = transcript
      .map((message) => `${this.labelOf(message)}: ${message.body}`)
      .join("\n");
    const from = this.labelOf(task.trigger);

    return [
      "以下是房间最近的对话记录：",
      "<room_transcript>",
      lines,
      "</room_transcript>",
      "",
      `现在轮到你，你是「${employee.displayName}」。请直接回复下面这条消息：`,
      `<message from="${from}">`,
      task.trigger.body,
      "</message>",
    ].join("\n");
  }

  private labelOf(message: Message): string {
    if (message.sender.kind === "human") return "人类";
    const employee = this.deps.employees.get(message.sender.employeeId);
    return employee?.displayName ?? message.sender.employeeId;
  }

  private async appendMessage(input: {
    roomId: string;
    sender: Message["sender"];
    body: string;
    mentions: Mention[];
  }): Promise<Message> {
    const message: Message = {
      id: createId("msg"),
      roomId: input.roomId,
      sender: input.sender,
      mentions: input.mentions,
      body: input.body,
      attachments: [],
      kind: "chat",
      createdAt: this.now().toISOString(),
    };
    await this.deps.messages.append(message);
    this.events.emit("message", message);
    return message;
  }
}
