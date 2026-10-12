import type { AdapterCreation } from "../adapters/createAdapter";
import type { AgentAdapter, AgentEvent } from "../adapters/events";
import type { ConfigStore } from "../config/configStore";
import { createId } from "../domain/ids";
import type { Employee, Mention, Message, Room } from "../domain/schema";
import type { EmployeeStore } from "../employee/employeeStore";
import { EventBus } from "../events/eventBus";
import type { MemoryStore } from "../memory/memoryStore";
import type { SkillInfo } from "../skills/skillCatalog";
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
  memory?: MemoryStore;
  /** 该员工启用的技能，用于在提示词里告诉它有哪些能力可用。 */
  skillsFor?: (employee: Employee) => Promise<SkillInfo[]>;
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " / ").trim();
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
  private readonly background = new Set<Promise<void>>();
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
    let targets = this.expandTargets(room, parsed.mentions, null);
    if (room.kind === "direct" && targets.length === 0) {
      // 单聊不需要 @：房间里只有一名员工，默认就是它。
      targets = room.memberIds.slice(0, 1);
    }
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
      const draining = this.drainPromise;
      const pending = [...this.background];

      if (draining) await draining;
      if (pending.length > 0) {
        await Promise.all(pending.map((promise) => promise.catch(() => undefined)));
      }

      if (
        this.queue.length === 0 &&
        this.running.size === 0 &&
        this.background.size === 0
      ) {
        return;
      }
    }
  }

  /** 记忆写入/整理这类收尾工作也纳入 idle 判定，保证测试与 UI 都能等到真正结束。 */
  private track(promise: Promise<void>): void {
    this.background.add(promise);
    void promise.finally(() => this.background.delete(promise));
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
      this.scheduleMemory(task, employee, body);
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
    const memory = await this.memoryBlock(task, employee);
    const skills = await this.skillBlock(employee);

    return [
      "以下是房间最近的对话记录：",
      "<room_transcript>",
      lines,
      "</room_transcript>",
      ...(memory === "" ? [] : ["", memory]),
      ...(skills === "" ? [] : ["", skills]),
      "",
      `现在轮到你，你是「${employee.displayName}」。请直接回复下面这条消息：`,
      `<message from="${from}">`,
      task.trigger.body,
      "</message>",
    ].join("\n");
  }

  private async memoryBlock(task: RunTask, employee: Employee): Promise<string> {
    const memory = this.deps.memory;
    const settings = this.deps.config.get().memory;
    if (!memory || !settings.enabled) return "";

    const recent = await memory.recent(employee.id, settings.maxInjectedEntries);
    const entries = settings.crossRoomRecall
      ? recent
      : recent.filter((entry) => entry.roomId === task.roomId);
    if (entries.length === 0) return "";

    return [
      "<your_memory>",
      "（你的长期记忆，供参考，不必逐条回应）",
      ...entries.map((entry) => `- [${entry.kind}] ${oneLine(entry.text)}`),
      "</your_memory>",
    ].join("\n");
  }

  private async skillBlock(employee: Employee): Promise<string> {
    if (!this.deps.skillsFor) return "";
    const skills = await this.deps.skillsFor(employee);
    if (skills.length === 0) return "";

    return [
      "<available_skills>",
      "以下技能已启用。任务匹配时，先读取对应的 SKILL.md 再动手：",
      ...skills.map(
        (skill) =>
          `- ${skill.id}${skill.description ? `：${skill.description}` : ""}（${skill.entryPath}）`,
      ),
      "</available_skills>",
    ].join("\n");
  }

  private scheduleMemory(task: RunTask, employee: Employee, replyBody: string): void {
    const memory = this.deps.memory;
    const settings = this.deps.config.get().memory;
    if (!memory || !settings.enabled) return;
    this.track(this.recordMemory(task, employee, replyBody));
  }

  private async recordMemory(
    task: RunTask,
    employee: Employee,
    replyBody: string,
  ): Promise<void> {
    const memory = this.deps.memory;
    if (!memory) return;
    const settings = this.deps.config.get().memory;
    const room = this.deps.rooms.get(task.roomId);

    try {
      await memory.append(employee.id, {
        kind: "exchange",
        scope: room?.kind === "direct" ? "direct" : "group",
        roomId: task.roomId,
        text: `任务：${truncate(oneLine(task.trigger.body), 300)}\n结果：${truncate(oneLine(replyBody), 500)}`,
      });

      const count = await memory.count(employee.id);
      if (count >= settings.consolidateAfterEntries) {
        await this.consolidateMemory(employee, settings.maxInjectedEntries);
      } else if (count > settings.maxEntriesPerEmployee) {
        await memory.trim(employee.id, settings.maxEntriesPerEmployee);
      }
    } catch {
      // 记忆属于增强能力，失败不应影响主流程。
    }
  }

  /** 把最旧的若干条记忆交给员工自己压缩成一条摘要。 */
  private async consolidateMemory(employee: Employee, keepLast: number): Promise<void> {
    const memory = this.deps.memory;
    if (!memory) return;
    const settings = this.deps.config.get().memory;
    const entries = await memory.list(employee.id);
    const keep = Math.min(keepLast, entries.length);
    const absorb = entries.slice(0, entries.length - keep);
    if (absorb.length === 0) return;

    const created = await this.deps.createAdapter(employee);
    if (!created.ok) {
      await memory.trim(employee.id, settings.maxEntriesPerEmployee);
      return;
    }

    const prompt = [
      "下面是你自己的历史记忆条目。请把它们压缩成一段不超过 200 字的摘要，",
      "保留事实、结论、约定和尚未完成的事项，去掉寒暄与重复。只输出摘要正文。",
      "<memory_entries>",
      ...absorb.map((entry) => `- ${oneLine(entry.text)}`),
      "</memory_entries>",
    ].join("\n");

    try {
      const result = await created.adapter.run({
        prompt,
        systemPrompt: "你是记忆整理器，只做压缩归纳。",
        cwd: employee.workspaceDir,
        permissions: employee.permissions,
        timeoutMs: 120000,
      });
      const text =
        result.ok && result.text.trim() !== ""
          ? truncate(oneLine(result.text), 600)
          : `${absorb.length} 条旧记忆已折叠`;
      await memory.consolidate(employee.id, keep, text);
    } catch {
      await memory.trim(employee.id, settings.maxEntriesPerEmployee);
    }
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
