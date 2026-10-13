import type { AdapterCreation } from "../adapters/createAdapter";
import type { AgentAdapter, AgentEvent } from "../adapters/events";
import type { AttachmentStore, WorkspaceAttachment } from "../attachments/attachmentStore";
import type { ConfigStore } from "../config/configStore";
import { createId } from "../domain/ids";
import type { Attachment, Employee, Mention, Message, Room } from "../domain/schema";
import type { EmployeeStore } from "../employee/employeeStore";
import { EventBus } from "../events/eventBus";
import type { MemoryStore } from "../memory/memoryStore";
import { defaultPromptPack, render, type PromptPack } from "../prompts/promptPack";
import type { SkillInfo } from "../skills/skillCatalog";
import { parseMentions } from "./mentions";
import { extractEmployeeRequests, type EmployeeDraft } from "./employeeRequest";
import type { CursorStore } from "./cursorStore";
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
    /** run = 员工之间的投递；hire = 招人申请。 */
    kind?: "run" | "hire";
    draft?: EmployeeDraft;
  };
}

export interface RoomServiceDeps {
  config: ConfigStore;
  employees: EmployeeStore;
  rooms: RoomStore;
  messages: MessageLog;
  createAdapter: (employee: Employee) => Promise<AdapterCreation>;
  cursors: CursorStore;
  memory?: MemoryStore;
  /** 附件落在磁盘上的位置；不传则不支持附件。 */
  attachments?: AttachmentStore;
  /** 应用层提供的"创建员工"能力；不传则员工不能申请招人。 */
  createEmployee?: (
    draft: EmployeeDraft,
  ) => Promise<{ ok: true; employee: Employee } | { ok: false; reason: string }>;
  /** 面向模型的文案；不传则用内置默认值。 */
  prompts?: PromptPack;
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
  /** run = 员工之间的投递；hire = 员工提交的招人申请。 */
  kind: "run" | "hire";
  targetId: string;
  roomId: string;
  summary: string;
  requesterId: string;
  task?: RunTask;
  draft?: EmployeeDraft;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " / ").trim();
}

/** 从归纳结果里取出行首是 `- ` / `* ` 的条目，忽略「无」这类空回答。 */
function extractBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line !== "无" && line !== "（无）" && line !== "none");
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
  private readonly prompts: PromptPack;
  private readonly queue: RunTask[] = [];
  private readonly running = new Set<Promise<void>>();
  /** 正在干活的员工；同一位员工同时只允许一个 run。 */
  private readonly busyEmployees = new Set<string>();
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly roomRunCounts = new Map<string, number>();
  private readonly recentTriggers = new Map<string, number>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  /** 每个房间已受理的招人申请数，防止一个员工无限招人。 */
  private readonly hireCounts = new Map<string, number>();
  private drainPromise: Promise<void> | null = null;

  constructor(private readonly deps: RoomServiceDeps) {
    this.events = deps.events ?? new EventBus<RoomServiceEvents>();
    this.now = deps.now ?? (() => new Date());
    this.prompts = deps.prompts ?? defaultPromptPack();
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
  async submitHumanMessage(
    roomId: string,
    body: string,
    files: { name: string; sourcePath: string }[] = [],
  ): Promise<Message> {
    const room = this.requireRoom(roomId);
    const parsed = parseMentions(body, this.candidates());
    // 附件先落到房间级目录：用户原始文件随时可能被移走，而消息要长期可读。
    const messageId = createId("msg");
    const attachments: Attachment[] =
      this.deps.attachments && files.length > 0
        ? await this.deps.attachments.stageIncoming(roomId, messageId, files)
        : [];
    const message = await this.appendMessage({
      roomId,
      sender: { kind: "human" },
      body,
      mentions: parsed.mentions,
      attachments,
      messageId,
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
    if (!approved) return true;

    // 招人申请与投递任务是两类审批，批准后要做的事不同。
    if (pending.kind === "hire") {
      await this.approveHire(pending);
      return true;
    }
    if (pending.task) {
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

      if (draining) await draining;

      if (
        this.queue.length === 0 &&
        this.running.size === 0
      ) {
        return;
      }
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
      } else if (
        room.memberIds.includes(mention.employeeId) &&
        mention.employeeId !== senderEmployeeId
      ) {
        // 员工 @ 自己会造成自接力空转，直接忽略。
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
      kind: "run",
      targetId,
      roomId,
      summary: `${trigger.body.slice(0, 60)} → ${target?.displayName ?? targetId}`,
      requesterId: employeeId,
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

  /** 批准招人：真正创建员工，并把结果写回房间——成功或失败都必须可见。 */
  private async approveHire(pending: PendingApproval): Promise<void> {
    const create = this.deps.createEmployee;
    const draft = pending.draft;
    const requester = this.deps.employees.get(pending.requesterId);
    const name = requester?.displayName ?? "员工";

    if (!create || !draft) {
      await this.appendSystemMessage(pending.roomId, "招人申请无法执行：该能力已关闭。");
      return;
    }

    const result = await create(draft);
    await this.appendSystemMessage(
      pending.roomId,
      result.ok
        ? `${name} 的招人申请已通过，新员工「${result.employee.displayName}」已创建，可在房间头部把它加入本房间。`
        : `${name} 的招人申请未完成：${result.reason}`,
    );
  }

  /** 结果类说明用系统消息落进房间，保证人类一定看得见。 */
  private async appendSystemMessage(roomId: string, body: string): Promise<void> {
    await this.appendMessage({ roomId, sender: { kind: "human" }, body, mentions: [], kind: "system" });
  }

  /**
   * 受理招人申请：格式错误要说出来，数量要封顶，真正创建必须由人类批准。
   */
  private async handleHireRequests(
    room: Room,
    employee: Employee,
    hire: { drafts: EmployeeDraft[]; errors: string[] },
  ): Promise<void> {
    const { policy, scheduler } = this.deps.config.get();
    if (!this.deps.createEmployee || policy.employeeMayHire === "off") return;

    for (const error of hire.errors) {
      await this.appendSystemMessage(room.id, `${employee.displayName} 的招人申请格式有问题：${error}`);
    }
    if (hire.drafts.length === 0) return;

    const used = this.hireCounts.get(room.id) ?? 0;
    if (used >= scheduler.maxEmployeeCreationsPerRoom) {
      await this.appendSystemMessage(
        room.id,
        `本房间的招人申请已达上限（${scheduler.maxEmployeeCreationsPerRoom} 条），${employee.displayName} 这次申请未被受理。`,
      );
      return;
    }
    if (hire.drafts.length > 1) {
      await this.appendSystemMessage(
        room.id,
        `${employee.displayName} 一次提交了 ${hire.drafts.length} 条招人申请，只受理第一条。`,
      );
    }

    const draft = hire.drafts[0] as EmployeeDraft;
    this.hireCounts.set(room.id, used + 1);

    const approvalId = createId("appr");
    const summary = `招人申请：${draft.displayName}（${draft.framework}${
      draft.permissionMode ? ` · ${draft.permissionMode}` : ""
    }）`;
    this.pendingApprovals.set(approvalId, {
      kind: "hire",
      targetId: draft.displayName,
      roomId: room.id,
      summary,
      requesterId: employee.id,
      draft,
    });
    this.events.emit("approval-requested", {
      approvalId,
      roomId: room.id,
      employeeId: employee.id,
      targetId: draft.displayName,
      summary,
      kind: "hire",
      draft,
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

      // 只挑「员工当前空闲」的任务；同一位员工的任务严格串行，避免共用一个会话并发跑。
      const index = this.queue.findIndex((task) => !this.busyEmployees.has(task.employeeId));
      if (index === -1) {
        if (this.running.size === 0) break;
        await Promise.race([...this.running]);
        continue;
      }

      const task = this.queue.splice(index, 1)[0] as RunTask;
      this.busyEmployees.add(task.employeeId);
      const promise = this.executeRun(task)
        .catch(() => undefined)
        .finally(() => {
          this.busyEmployees.delete(task.employeeId);
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
    if (employee.removedAt) {
      // 员工已被移出名册：不再为它跑任务，历史记录保持可读。
      this.skip(task.roomId, task.employeeId, "员工已被移除");
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
      // 附件复制进员工工作目录，这样它在 cwd 内就能直接读到；图片还会作为原生图片入参。
      const workspaceFiles: WorkspaceAttachment[] =
        this.deps.attachments && task.trigger.attachments.length > 0
          ? await this.deps.attachments.stageIntoWorkspace(
              employee.workspaceDir,
              task.trigger.id,
              task.trigger.attachments,
            )
          : [];
      const prompt = await this.buildPrompt(task, employee, workspaceFiles);
      const result = await created.adapter.run(
        {
          prompt,
          systemPrompt: employee.systemPrompt,
          cwd: employee.workspaceDir,
          model: employee.model,
          permissions: employee.permissions,
          attachments: workspaceFiles,
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
        // 招人申请是带外协议：先从正文里剥出来，正文保持可读，申请走审批。
        const hire = this.deps.createEmployee
          ? extractEmployeeRequests(body, this.prompts.employeeRequestMarker)
          : { body, drafts: [], errors: [] };
        const visible = hire.body === "" ? "（提交了一条招人申请，见下方审批）" : hire.body;
        const parsed = parseMentions(visible, this.candidates());
        const reply = await this.appendMessage({
          roomId: task.roomId,
          sender: { kind: "employee", employeeId: employee.id },
          body: visible,
          mentions: parsed.mentions,
        });
        if (room) {
          await this.followUpMentions(room, reply, task);
          await this.handleHireRequests(room, employee, hire);
        }
      }

      this.events.emit("run-finished", {
        roomId: task.roomId,
        employeeId: task.employeeId,
        runId: task.runId,
        ok: true,
      });
      // 记忆写入与归纳都算这位员工仍在忙：串在本次运行之后，不会和下一次运行撞车。
      await this.recordMemory(task, employee, body);
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

  private async buildPrompt(
    task: RunTask,
    employee: Employee,
    attachments: WorkspaceAttachment[] = [],
  ): Promise<string> {
    const { contextWindowMessages } = this.deps.config.get().scheduler;
    const cursor = this.deps.cursors.get(employee.id, task.roomId) ?? null;
    const delta = await this.deps.messages.readAfter(
      task.roomId,
      cursor,
      contextWindowMessages,
    );
    const contextLines = delta
      .map((message) => `${this.labelOf(message)}: ${message.body}`)
      .join("\n");
    const from = this.labelOf(task.trigger);
    const memory = await this.memoryBlock(task, employee);
    const skills = await this.skillBlock(employee);
    const room = this.deps.rooms.get(task.roomId);

    return [
      cursor === null
        ? this.prompts.contextFirstRun
        : this.prompts.contextDelta,
      "<context>",
      contextLines === "" ? this.prompts.contextEmpty : contextLines,
      "</context>",
      ...(room === undefined ? [] : ["", await this.teamBlock(room, employee)]),
      ...(attachments.length === 0 ? [] : ["", this.attachmentBlock(attachments)]),
      ...(memory === "" ? [] : ["", memory]),
      ...(skills === "" ? [] : ["", skills]),
      ...(this.hireGuideEnabled() ? ["", "<hiring>", this.prompts.employeeRequestGuide, "</hiring>"] : []),
      "",
      render(this.prompts.taskHeader, { employee: employee.displayName }),
      `<message from="${from}">`,
      task.trigger.body,
      "</message>",
    ].join("\n");
  }

  /**
   * 告诉员工房间里还有谁、以及 @ 到底意味着什么。
   *
   * 没有这一段时，员工只能从上下文里「模仿」看到过的 @ 写法；它无法知道
   * @ 会真的触发对方跑一次、@all 是广播、以及人工确认策略下对方不会自动开始。
   * 单聊里更会说清楚「没有人可以 @」，避免对着空气喊。
   */
  private async teamBlock(room: Room, employee: Employee): Promise<string> {
    return this.buildTeamBlock(room, employee);
  }

  /** 只有应用层提供了创建能力、且策略允许时才把招人协议告诉员工。 */
  private hireGuideEnabled(): boolean {
    return (
      this.deps.createEmployee !== undefined &&
      this.deps.config.get().policy.employeeMayHire === "confirm"
    );
  }

  private async buildTeamBlock(room: Room, employee: Employee): Promise<string> {
    if (room.kind === "direct") {
      return ["<team>", this.prompts.teamDirect, "</team>"].join("\n");
    }

    const colleagues = room.memberIds
      .filter((memberId) => memberId !== employee.id)
      .map((memberId) => this.deps.employees.get(memberId))
      .filter((item): item is Employee => item !== undefined && item.removedAt === undefined);

    return [
      "<team>",
      render(this.prompts.teamGroupHeader, {
        count: colleagues.length,
        list:
          colleagues.length === 0
            ? this.prompts.teamNoColleagues
            : colleagues.map((item) => `${item.displayName}（${item.framework}）`).join("、"),
      }),
      this.prompts.teamMentionGuide,
      this.prompts.teamBroadcastGuide,
      this.prompts.teamBudgetNote,
      ...(this.mentionPolicy(room, "employee") === "confirm"
        ? [this.prompts.teamConfirmNote]
        : []),
      "</team>",
    ].join("\n");
  }

  private async memoryBlock(task: RunTask, employee: Employee): Promise<string> {
    const memory = this.deps.memory;
    const settings = this.deps.config.get().memory;
    if (!memory || !settings.enabled) return "";

    const all = await memory.listFacts(employee.id);
    const scoped = settings.crossRoomRecall
      ? all
      : all.filter((fact) => fact.roomId === task.roomId);
    const facts = scoped.slice(Math.max(0, scoped.length - settings.maxInjectedFacts));
    if (facts.length === 0) return "";

    return [
      "<long_term_memory>",
      this.prompts.memoryHeader,
      ...facts.map((fact) => `- ${oneLine(fact.text)}`),
      "</long_term_memory>",
    ].join("\n");
  }

  /** 附件清单：给出工作目录内的相对路径，员工用工具就能打开。 */
  private attachmentBlock(attachments: WorkspaceAttachment[]): string {
    return [
      "<attachments>",
      render(this.prompts.attachmentsHeader, { count: attachments.length }),
      ...attachments.map(
        (attachment) =>
          `- ${attachment.relativePath}（${attachment.mimeType}，${Math.max(
            1,
            Math.round(attachment.sizeBytes / 1024),
          )}KB）`,
      ),
      this.prompts.attachmentsGuide,
      "</attachments>",
    ].join("\n");
  }

  private async skillBlock(employee: Employee): Promise<string> {
    if (!this.deps.skillsFor) return "";
    const skills = await this.deps.skillsFor(employee);
    if (skills.length === 0) return "";

    return [
      "<available_skills>",
      this.prompts.skillsHeader,
      ...skills.map(
        (skill) =>
          `- ${skill.id}${skill.description ? `：${skill.description}` : ""}（${skill.entryPath}）`,
      ),
      "</available_skills>",
    ].join("\n");
  }

  /**
   * 一次往来先进暂存区，并推进上下文游标。
   * 只有归纳之后的内容才会变成长期记忆——原始流水不是记忆。
   */
  private async recordMemory(
    task: RunTask,
    employee: Employee,
    replyBody: string,
  ): Promise<void> {
    const memory = this.deps.memory;
    if (!memory) return;
    const settings = this.deps.config.get().memory;
    if (!settings.enabled) return;
    const room = this.deps.rooms.get(task.roomId);

    try {
      await this.deps.cursors.set(employee.id, task.roomId, task.trigger.id);

      // 没有产出就不进暂存区：空往来会把归纳阈值白白消耗掉。
      if (replyBody.trim() !== "") {
        await memory.appendPending(employee.id, {
          scope: room?.kind === "direct" ? "direct" : "group",
          roomId: task.roomId,
          text: `任务：${truncate(oneLine(task.trigger.body), 200)} → 我的处理：${truncate(oneLine(replyBody), 300)}`,
        });
      }

      if ((await memory.countPending(employee.id)) >= settings.distillAfterPending) {
        await this.distill(employee);
      }
    } catch {
      // 记忆属于增强能力，失败不应影响主流程。
    }
  }

  /**
   * 归纳：把暂存的往来交给员工自己提炼成长期记忆。
   * 明确要求只留约定、决定、偏好、未完成事项，避免把寒暄和流水账当记忆。
   */
  private async distill(employee: Employee): Promise<void> {
    const memory = this.deps.memory;
    if (!memory) return;
    const pending = await memory.listPending(employee.id);
    if (pending.length === 0) return;

    const created = await this.deps.createAdapter(employee);
    if (!created.ok) {
      await memory.clearPending(employee.id);
      return;
    }

    const existing = await memory.listFacts(employee.id);
    const prompt = [
      this.prompts.distillInstruction,
      "<recent_work>",
      ...pending.map((entry) => `- ${oneLine(entry.text)}`),
      "</recent_work>",
      ...(existing.length === 0
        ? []
        : ["<already_remembered>", ...existing.map((fact) => `- ${oneLine(fact.text)}`), "</already_remembered>"]),
    ].join("\n");

    try {
      const result = await created.adapter.run({
        prompt,
        systemPrompt: this.prompts.distillSystem,
        cwd: employee.workspaceDir,
        permissions: employee.permissions,
        timeoutMs: 120000,
      });
      const learned = result.ok ? extractBullets(result.text) : [];
      for (const line of learned.slice(0, 8)) {
        await memory.appendFact(
          employee.id,
          truncate(line, 300),
          "fact",
          pending[0]?.roomId,
        );
      }
      await memory.clearPending(employee.id);
      await this.shrinkFacts(employee);
    } catch {
      await memory.clearPending(employee.id);
    }
  }

  /** 长期记忆超上限时，把最旧的落成一条摘要，避免无限增长。 */
  private async shrinkFacts(employee: Employee): Promise<void> {
    const memory = this.deps.memory;
    if (!memory) return;
    const settings = this.deps.config.get().memory;
    const all = await memory.listFacts(employee.id);
    if (all.length <= settings.maxFacts) return;

    const keepCount = Math.max(1, Math.floor(settings.maxFacts / 2));
    const keep = all.slice(all.length - keepCount);
    const absorbed = all.slice(0, all.length - keep.length);

    let digestText = render(this.prompts.digestFallback, { count: absorbed.length });
    const created = await this.deps.createAdapter(employee);
    if (created.ok) {
      try {
        const result = await created.adapter.run({
          prompt: [
            this.prompts.digestInstruction,
            "<memory>",
            ...absorbed.map((fact) => `- ${oneLine(fact.text)}`),
            "</memory>",
          ].join("\n"),
          systemPrompt: this.prompts.digestSystem,
          cwd: employee.workspaceDir,
          permissions: employee.permissions,
          timeoutMs: 120000,
        });
        if (result.ok && result.text.trim() !== "") {
          digestText = truncate(oneLine(result.text), 600);
        }
      } catch {
        // 用兜底文案。
      }
    }

    await memory.writeFacts(employee.id, [
      {
        id: createId("mem"),
        kind: "digest",
        text: digestText,
        roomId: absorbed[0]?.roomId,
        createdAt: new Date().toISOString(),
      },
      ...keep,
    ]);
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
    attachments?: Attachment[];
    messageId?: string;
    kind?: Message["kind"];
  }): Promise<Message> {
    const message: Message = {
      id: input.messageId ?? createId("msg"),
      roomId: input.roomId,
      sender: input.sender,
      mentions: input.mentions,
      body: input.body,
      attachments: input.attachments ?? [],
      kind: input.kind ?? "chat",
      createdAt: this.now().toISOString(),
    };
    await this.deps.messages.append(message);
    this.events.emit("message", message);
    return message;
  }
}
