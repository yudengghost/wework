import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdapterCreation } from "../adapters/createAdapter";
import type { AgentAdapter, AgentEvent, AgentRunRequest, AgentRunResult } from "../adapters/events";
import { ConfigStore } from "../config/configStore";
import type { Employee } from "../domain/schema";
import { EmployeeStore } from "../employee/employeeStore";
import { EventBus } from "../events/eventBus";
import { MemoryStore } from "../memory/memoryStore";
import type { SkillInfo } from "../skills/skillCatalog";
import type { EmployeeDraft } from "./employeeRequest";
import { FileStore } from "../storage/fileStore";
import { CursorStore } from "./cursorStore";
import { MessageLog } from "./messageLog";
import { RoomService, type RoomServiceEvents } from "./roomService";
import { RoomStore } from "./roomStore";

interface Call {
  employeeId: string;
  prompt: string;
  sessionRef?: string;
}

interface Harness {
  service: RoomService;
  config: ConfigStore;
  employees: EmployeeStore;
  rooms: RoomStore;
  calls: Call[];
  events: EventBus<RoomServiceEvents>;
  replies: Map<string, string>;
  setBehavior: (value: Behavior) => void;
  maxConcurrency: () => number;
  maxPerEmployee: (employeeId: string) => number;
  cursors: CursorStore;
  memory: MemoryStore;
  hires: EmployeeDraft[];
  setSkills: (value: SkillInfo[]) => void;
}

type Behavior = (request: AgentRunRequest, employeeId: string) => {
  text: string;
  ok?: boolean;
  error?: string;
  delayMs?: number;
};

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "buddy-room-service-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function makeHarness(options: { behavior?: Behavior } = {}): Promise<Harness> {
  const store = new FileStore();
  const config = new ConfigStore(store, join(workDir, "config.json"));
  await config.load();
  const employees = new EmployeeStore(store, join(workDir, "employees.json"));
  await employees.load();
  const rooms = new RoomStore(store, join(workDir, "rooms.json"));
  await rooms.load();
  const messages = new MessageLog(store, workDir);
  const memory = new MemoryStore(store, workDir);
  const cursors = new CursorStore(store, join(workDir, "cursors.json"));
  await cursors.load();
  let skills: SkillInfo[] = [];

  const calls: Call[] = [];
  const hires: EmployeeDraft[] = [];
  const replies = new Map<string, string>();
  let behavior: Behavior =
    options.behavior ??
    ((request) => ({ text: replies.get(request.prompt) ?? "收到" }));
  let concurrency = 0;
  let maxConcurrency = 0;
  const activeByEmployee = new Map<string, number>();
  const maxByEmployee = new Map<string, number>();

  const makeAdapter = (employeeId: string, displayName: string): AgentAdapter => ({
    framework: "codex",
    async run(
      request: AgentRunRequest,
      onEvent?: (event: AgentEvent) => void,
    ): Promise<AgentRunResult> {
      calls.push({
        employeeId,
        prompt: request.prompt,
        sessionRef: request.sessionRef,
      });
      concurrency += 1;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      const active = (activeByEmployee.get(employeeId) ?? 0) + 1;
      activeByEmployee.set(employeeId, active);
      maxByEmployee.set(employeeId, Math.max(maxByEmployee.get(employeeId) ?? 0, active));
      const outcome = behavior(request, displayName);
      try {
        if (outcome.delayMs) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, outcome.delayMs);
            request.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        }
        if (request.signal?.aborted) {
          return {
            framework: "codex",
            ok: false,
            exitCode: null,
            text: "",
            cancelled: true,
            timedOut: false,
            stderr: "",
          };
        }
        onEvent?.({ type: "text", text: outcome.text });
        return {
          framework: "codex",
          ok: outcome.ok ?? true,
          exitCode: outcome.ok === false ? 1 : 0,
          text: outcome.text,
          sessionRef: `${employeeId}-session`,
          timedOut: false,
          cancelled: false,
          stderr: outcome.error ?? "",
        };
      } finally {
        concurrency -= 1;
        activeByEmployee.set(employeeId, (activeByEmployee.get(employeeId) ?? 1) - 1);
      }
    },
  });

  const events = new EventBus<RoomServiceEvents>();
  const service = new RoomService({
    config,
    employees,
    rooms,
    messages,
    events,
    memory,
    cursors,
    createEmployee: async (draft) => {
      hires.push(draft);
      const employee = await employees.create({
        displayName: draft.displayName,
        framework: draft.framework,
        workspaceDir: join(workDir, "ws", draft.displayName),
        stateDir: join(workDir, "state", draft.displayName),
        permissions: { mode: draft.permissionMode ?? "workspace-write" },
        skills: draft.skills ?? [],
      });
      return { ok: true, employee };
    },
    skillsFor: async (employee: Employee) =>
      skills.filter((skill) => employee.skills.includes(skill.id)),
    createAdapter: async (employee: Employee): Promise<AdapterCreation> => ({
      ok: true,
      adapter: makeAdapter(employee.id, employee.displayName),
    }),
  });

  return {
    service,
    config,
    employees,
    rooms,
    calls,
    hires,
    events,
    replies,
    setBehavior: (value) => {
      behavior = value;
    },
    maxConcurrency: () => maxConcurrency,
    maxPerEmployee: (employeeId) => maxByEmployee.get(employeeId) ?? 0,
    cursors,
    memory,
    setSkills: (value) => {
      skills = value;
    },
  };
}

async function seedTeam(harness: Harness): Promise<{ roomId: string; coder: Employee; reviewer: Employee }> {
  const coder = await harness.employees.create({
    displayName: "小码",
    framework: "codex",
    // 授权招人的那一位；小测保持默认（未授权），用来验证能力门。
    canHire: true,
    workspaceDir: join(workDir, "ws", "coder"),
    stateDir: join(workDir, "state", "coder"),
    permissions: { mode: "workspace-write" },
    skills: [],
  });
  const reviewer = await harness.employees.create({
    displayName: "小测",
    framework: "codex",
    workspaceDir: join(workDir, "ws", "reviewer"),
    stateDir: join(workDir, "state", "reviewer"),
    permissions: { mode: "read-only" },
    skills: [],
  });
  const room = await harness.rooms.create({
    name: "发布前检查",
    memberIds: [coder.id, reviewer.id],
  });
  return { roomId: room.id, coder, reviewer };
}

describe("RoomService", () => {
  it("@某员工时只调用该员工，并把回复落成房间消息", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);

    await harness.service.submitHumanMessage(roomId, "@小码 看下这个 bug");
    await harness.service.waitForIdle();

    expect(harness.calls.map((call) => call.employeeId)).toEqual([coder.id]);
    expect(harness.calls[0]?.prompt).toContain("看下这个 bug");
    expect(harness.calls[0]?.prompt).toContain("<context>");

    const messages = await harness.service.listMessages(roomId);
    expect(messages.map((message) => message.sender.kind)).toEqual(["human", "employee"]);
    expect(messages[1]?.body).toBe("收到");
  });

  it("@all 时调用房间里除发送者外的所有员工", async () => {
    const harness = await makeHarness();
    const { roomId, coder, reviewer } = await seedTeam(harness);

    await harness.service.submitHumanMessage(roomId, "@all 一起看");
    await harness.service.waitForIdle();

    expect(new Set(harness.calls.map((call) => call.employeeId))).toEqual(
      new Set([coder.id, reviewer.id]),
    );
  });

  it("未知的 @ 不产生投递，消息仍然入库", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);

    await harness.service.submitHumanMessage(roomId, "@张三 帮我看下");
    await harness.service.waitForIdle();

    expect(harness.calls).toEqual([]);
    expect(await harness.service.listMessages(roomId)).toHaveLength(1);
  });

  it("员工回复里 @另一个员工时自动接续（默认 auto）", async () => {
    const harness = await makeHarness();
    const { roomId, coder, reviewer } = await seedTeam(harness);
    harness.setBehavior((_request, displayName) =>
      displayName === "小码" ? { text: "@小测 帮我复核一下" } : { text: "复核完毕" },
    );

    await harness.service.submitHumanMessage(roomId, "@小码 改个东西");
    await harness.service.waitForIdle();

    expect(harness.calls.map((call) => call.employeeId)).toEqual([coder.id, reviewer.id]);
  });

  it("策略为 confirm 时员工之间的接续需要人工放行", async () => {
    const harness = await makeHarness();
    const { roomId, coder, reviewer } = await seedTeam(harness);
    await harness.config.update({ policy: { employeeMentionsEmployee: "confirm" } });
    harness.setBehavior((_request, displayName) =>
      displayName === "小码" ? { text: "@小测 帮我复核一下" } : { text: "复核完毕" },
    );
    const requests: string[] = [];
    harness.events.on("approval-requested", (payload) => requests.push(payload.approvalId));

    await harness.service.submitHumanMessage(roomId, "@小码 改个东西");
    await harness.service.waitForIdle();

    expect(harness.calls.map((call) => call.employeeId)).toEqual([coder.id]);
    expect(requests).toHaveLength(1);

    await harness.service.resolveApproval(requests[0] as string, true);
    await harness.service.waitForIdle();

    expect(harness.calls.map((call) => call.employeeId)).toEqual([coder.id, reviewer.id]);
  });

  it("@ 接续层数超限时跳过并给出原因", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    await harness.config.update({ scheduler: { maxMentionDepth: 0 } });
    harness.setBehavior((_request, displayName) =>
      displayName === "小码" ? { text: "@小测 接力" } : { text: "接力完成" },
    );
    const skipped: string[] = [];
    harness.events.on("run-skipped", (payload) => skipped.push(payload.reason));

    await harness.service.submitHumanMessage(roomId, "@小码 开始");
    await harness.service.waitForIdle();

    expect(harness.calls.map((call) => call.employeeId)).toEqual([coder.id]);
    expect(skipped).toEqual(["@ 接续层数超出上限"]);
  });

  it("把会话 id 写回员工档案以便下次续接", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);

    await harness.service.submitHumanMessage(roomId, "@小码 你好");
    await harness.service.waitForIdle();

    expect(harness.employees.get(coder.id)?.sessionRef).toBe(`${coder.id}-session`);
  });

  it("stopAll 会中止正在运行的员工", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    harness.setBehavior(() => ({ text: "不该产出", delayMs: 30000 }));
    const finished: { ok: boolean; error?: string }[] = [];
    harness.events.on("run-finished", (payload) => finished.push(payload));

    await harness.service.submitHumanMessage(roomId, "@all 干活");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cancelled = harness.service.stopAll();
    await harness.service.waitForIdle();

    expect(cancelled).toBeGreaterThan(0);
    expect(finished.length).toBeGreaterThan(0);
    expect(finished.every((entry) => entry.ok === false)).toBe(true);
  });

  it("并发闸生效：maxConcurrentRuns=1 时两个员工不重叠执行", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    await harness.config.update({ scheduler: { maxConcurrentRuns: 1 } });
    harness.setBehavior(() => ({ text: "干完了", delayMs: 120 }));

    await harness.service.submitHumanMessage(roomId, "@all 各自干活");
    await harness.service.waitForIdle();

    expect(harness.calls).toHaveLength(2);
    expect(harness.maxConcurrency()).toBe(1);
  });

  it("单聊房间里不写 @ 也会投递给唯一成员", async () => {
    const harness = await makeHarness();
    const employee = await harness.employees.create({
      displayName: "小码",
      framework: "codex",
      workspaceDir: join(workDir, "ws", "dm"),
      stateDir: join(workDir, "state", "dm"),
      permissions: { mode: "read-only" },
      skills: [],
    });
    const room = await harness.rooms.create({
      name: "和小码单聊",
      kind: "direct",
      memberIds: [employee.id],
    });

    await harness.service.submitHumanMessage(room.id, "随便聊聊，今天怎么样？");
    await harness.service.waitForIdle();

    expect(harness.calls.map((call) => call.employeeId)).toEqual([employee.id]);
    expect(await harness.service.listMessages(room.id)).toHaveLength(2);
  });

  it("往来先进暂存区，不会直接变成长期记忆", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    harness.setBehavior(() => ({ text: "已经把 README 的错别字改完了" }));

    await harness.service.submitHumanMessage(roomId, "@小码 改一下 README 的错别字");
    await harness.service.waitForIdle();

    expect(await harness.memory.countFacts(coder.id)).toBe(0);
    const pending = await harness.memory.listPending(coder.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toContain("改一下 README 的错别字");
    expect(pending[0]?.scope).toBe("group");
  });

  it("第二次运行只喂增量上下文，不重灌已经看过的历史", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);

    await harness.service.submitHumanMessage(roomId, "@小码 第一件事：改错别字");
    await harness.service.waitForIdle();
    await harness.service.submitHumanMessage(roomId, "@小码 第二件事：加注释");
    await harness.service.waitForIdle();

    const second = harness.calls[1]?.prompt ?? "";
    expect(second).toContain("<context>");
    expect(second).toContain("第二件事：加注释");
    expect(second).not.toContain("第一件事：改错别字");
  });

  it("长期记忆会被注入，且与上下文分开标注", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    await harness.memory.appendFact(coder.id, "约定：提交前必须先跑测试", "fact", roomId);

    await harness.service.submitHumanMessage(roomId, "@小码 提交一下");
    await harness.service.waitForIdle();

    const prompt = harness.calls[0]?.prompt ?? "";
    expect(prompt).toContain("<long_term_memory>");
    expect(prompt).toContain("提交前必须先跑测试");
    expect(prompt).toContain("<context>");
  });

  it("累计到阈值后归纳成长期记忆并清空暂存", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    await harness.config.update({ memory: { distillAfterPending: 2 } });
    harness.setBehavior((request) =>
      request.systemPrompt === "你是记忆整理器，只做归纳，不执行任何任务。"
        ? { text: "- 用户要求提交前先跑测试\n- 项目用 pnpm 管理" }
        : { text: "活儿干完了" },
    );

    for (let index = 0; index < 2; index += 1) {
      await harness.service.submitHumanMessage(roomId, `@小码 第 ${index + 1} 件事`);
      await harness.service.waitForIdle();
    }

    const facts = await harness.memory.listFacts(coder.id);
    expect(facts.map((fact) => fact.text)).toEqual([
      "用户要求提交前先跑测试",
      "项目用 pnpm 管理",
    ]);
    expect(await harness.memory.countPending(coder.id)).toBe(0);
  });

  it("归纳结果里没有值得记的内容时不会硬造记忆", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    await harness.config.update({ memory: { distillAfterPending: 2 } });
    harness.setBehavior((request) =>
      request.systemPrompt === "你是记忆整理器，只做归纳，不执行任何任务。"
        ? { text: "无" }
        : { text: "好的" },
    );

    for (let index = 0; index < 2; index += 1) {
      await harness.service.submitHumanMessage(roomId, `@小码 闲聊 ${index + 1}`);
      await harness.service.waitForIdle();
    }

    expect(await harness.memory.countFacts(coder.id)).toBe(0);
    expect(await harness.memory.countPending(coder.id)).toBe(0);
  });

  it("启用的技能会以 SKILL.md 路径写进提示词", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    await harness.employees.update(coder.id, { skills: ["imagegen"] });
    harness.setSkills([
      {
        id: "imagegen",
        name: "图像生成",
        description: "生成位图素材",
        source: "framework",
        entryPath: "C:\\skills\\imagegen\\SKILL.md",
      },
    ]);

    await harness.service.submitHumanMessage(roomId, "@小码 画个图");
    await harness.service.waitForIdle();

    expect(harness.calls[0]?.prompt).toContain("<available_skills>");
    expect(harness.calls[0]?.prompt).toContain("C:\\skills\\imagegen\\SKILL.md");
  });

  it("群聊里明确告诉员工有哪些同事、以及 @ 会真的触发对方", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);

    await harness.service.submitHumanMessage(roomId, "@小码 开始吧");
    await harness.service.waitForIdle();

    const prompt = harness.calls[0]?.prompt ?? "";
    expect(prompt).toContain("<team>");
    expect(prompt).toContain("这是一个群聊房间");
    expect(prompt).toContain("小测（codex）");
    expect(prompt).toContain("@all");
    expect(prompt).toContain("不要 @ 自己");
    // 默认是 auto，所以不该出现「等用户点允许」的说明
    expect(prompt).not.toContain("等用户点允许");
  });

  it("员工互相确认策略下，提示词会说明需要人工放行", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    await harness.config.update({ policy: { employeeMentionsEmployee: "confirm" } });

    await harness.service.submitHumanMessage(roomId, "@小码 开始吧");
    await harness.service.waitForIdle();

    expect(harness.calls[0]?.prompt).toContain("等用户点允许");
  });

  it("单聊里明确说没有同事可以 @", async () => {
    const harness = await makeHarness();
    const employee = await harness.employees.create({
      displayName: "独苗",
      framework: "codex",
      workspaceDir: join(workDir, "ws", "solo"),
      stateDir: join(workDir, "state", "solo"),
      permissions: { mode: "read-only" },
      skills: [],
    });
    const room = await harness.rooms.create({
      name: "单聊",
      kind: "direct",
      memberIds: [employee.id],
    });

    await harness.service.submitHumanMessage(room.id, "随便聊聊");
    await harness.service.waitForIdle();

    const prompt = harness.calls[0]?.prompt ?? "";
    expect(prompt).toContain("这是一个单聊房间");
    expect(prompt).toContain("请不要 @ 任何人");
    expect(prompt).not.toContain("写「@all」");
  });

  it("同一员工的两个任务严格串行，不同员工之间仍可并行", async () => {
    const harness = await makeHarness();
    const { roomId, coder, reviewer } = await seedTeam(harness);
    await harness.config.update({ scheduler: { maxConcurrentRuns: 4 } });
    harness.setBehavior(() => ({ text: "干完了", delayMs: 120 }));

    await harness.service.submitHumanMessage(roomId, "@小码 第一件");
    await harness.service.submitHumanMessage(roomId, "@小码 第二件");
    await harness.service.submitHumanMessage(roomId, "@小测 复核一下");
    await harness.service.waitForIdle();

    expect(harness.maxPerEmployee(coder.id)).toBe(1);
    expect(harness.calls.filter((call) => call.employeeId === coder.id)).toHaveLength(2);
    expect(harness.maxConcurrency()).toBeGreaterThan(1);
    expect(harness.calls.some((call) => call.employeeId === reviewer.id)).toBe(true);
  });

  it("员工 @ 自己不会产生自接力空转", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    harness.setBehavior(() => ({ text: "@小码 我再检查一遍" }));

    await harness.service.submitHumanMessage(roomId, "@小码 开始");
    await harness.service.waitForIdle();

    expect(harness.calls.map((call) => call.employeeId)).toEqual([coder.id]);
  });

  it("@ 不在房间里的员工不会被投递", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    const outsider = await harness.employees.create({
      displayName: "局外人",
      framework: "codex",
      workspaceDir: join(workDir, "ws", "outsider"),
      stateDir: join(workDir, "state", "outsider"),
      permissions: { mode: "read-only" },
      skills: [],
    });

    await harness.service.submitHumanMessage(roomId, "@局外人 帮个忙");
    await harness.service.waitForIdle();

    expect(harness.calls).toEqual([]);
    expect(harness.employees.get(outsider.id)).toBeTruthy();
  });

  it("零成员房间不会触发任何运行", async () => {
    const harness = await makeHarness();
    const room = await harness.rooms.create({ name: "空房间", memberIds: [] });

    await harness.service.submitHumanMessage(room.id, "@all 有人在吗");
    await harness.service.waitForIdle();

    expect(harness.calls).toEqual([]);
    expect(await harness.service.listMessages(room.id)).toHaveLength(1);
  });

  it("员工没有产出文本时不落消息、不记记忆，但游标仍推进", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    harness.setBehavior(() => ({ text: "   " }));

    const human = await harness.service.submitHumanMessage(roomId, "@小码 干点什么");
    await harness.service.waitForIdle();

    expect(await harness.service.listMessages(roomId)).toHaveLength(1);
    expect(await harness.memory.countPending(coder.id)).toBe(0);
    expect(harness.cursors.get(coder.id, roomId)).toBe(human.id);
  });

  it("被取消的运行不推进游标，下次仍能看到那条消息", async () => {
    const harness = await makeHarness();
    const { roomId, coder } = await seedTeam(harness);
    harness.setBehavior(() => ({ text: "不该产出", delayMs: 30000 }));

    await harness.service.submitHumanMessage(roomId, "@小码 长任务");
    await new Promise((resolve) => setTimeout(resolve, 50));
    harness.service.stopAll();
    await harness.service.waitForIdle();

    expect(harness.cursors.get(coder.id, roomId)).toBeUndefined();
    expect(await harness.memory.countPending(coder.id)).toBe(0);
  });

  // ---- 招人（模拟 HR）：同一条回复 → 审批 → 执行链路，单独覆盖它的护栏 ----

  const hireBlock = (json: string): string => `\`\`\`@@create-employee\n${json}\n\`\`\``;

  it("员工提交招人申请时只产生待审批，不会直接创建", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    harness.setBehavior(() => ({
      text: `我们需要一位测试。\n\n${hireBlock('{"displayName":"新招的测试","framework":"codex","permissionMode":"read-only"}')}`,
    }));
    const approvals: { approvalId: string; kind?: string; summary: string }[] = [];
    harness.events.on("approval-requested", (payload) => approvals.push(payload));

    await harness.service.submitHumanMessage(roomId, "@小码 帮我招个测试");
    await harness.service.waitForIdle();

    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.kind).toBe("hire");
    expect(approvals[0]?.summary).toContain("新招的测试");
    // 还没批准，员工名册不该多出人来
    expect(harness.employees.list().map((item) => item.displayName)).not.toContain("新招的测试");
    // 协议块不该出现在房间正文里
    const transcript = await harness.service.listMessages(roomId);
    expect(transcript[1]?.body).toContain("我们需要一位测试");
    expect(transcript[1]?.body).not.toContain("@@create-employee");
  });

  it("批准后才真正创建员工，并把结果写回房间", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    harness.setBehavior(() => ({
      text: hireBlock('{"displayName":"新招的测试","framework":"codex","permissionMode":"read-only"}'),
    }));
    const approvals: string[] = [];
    harness.events.on("approval-requested", (payload) => approvals.push(payload.approvalId));

    await harness.service.submitHumanMessage(roomId, "@小码 招人");
    await harness.service.waitForIdle();
    await harness.service.resolveApproval(approvals[0] as string, true);
    await harness.service.waitForIdle();

    expect(harness.hires.map((draft) => draft.displayName)).toEqual(["新招的测试"]);
    expect(harness.employees.list().map((item) => item.displayName)).toContain("新招的测试");
    const transcript = await harness.service.listMessages(roomId);
    expect(transcript.some((message) => message.body.includes("已通过"))).toBe(true);
  });

  it("拒绝则什么都不发生", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    harness.setBehavior(() => ({
      text: hireBlock('{"displayName":"新招的测试","framework":"codex"}'),
    }));
    const approvals: string[] = [];
    harness.events.on("approval-requested", (payload) => approvals.push(payload.approvalId));

    await harness.service.submitHumanMessage(roomId, "@小码 招人");
    await harness.service.waitForIdle();
    await harness.service.resolveApproval(approvals[0] as string, false);
    await harness.service.waitForIdle();

    expect(harness.hires).toEqual([]);
  });

  it("申请数量封顶，超出后不再受理", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    await harness.config.update({ scheduler: { maxEmployeeCreationsPerRoom: 1 } });
    harness.setBehavior((request) =>
      request.prompt.includes("<hiring>")
        ? { text: hireBlock('{"displayName":"新招的测试","framework":"codex"}') }
        : { text: "好的" },
    );
    const approvals: unknown[] = [];
    harness.events.on("approval-requested", (payload) => approvals.push(payload));

    await harness.service.submitHumanMessage(roomId, "@小码 招第一个人");
    await harness.service.waitForIdle();
    await harness.service.submitHumanMessage(roomId, "@小码 再招一个");
    await harness.service.waitForIdle();

    expect(approvals).toHaveLength(1);
    const transcript = await harness.service.listMessages(roomId);
    expect(transcript.some((message) => message.body.includes("已达上限"))).toBe(true);
  });

  it("格式写错时明确报错，且不产生审批", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    harness.setBehavior(() => ({ text: "```@@create-employee\n{ 坏掉的 json }\n```" }));
    const approvals: unknown[] = [];
    harness.events.on("approval-requested", (payload) => approvals.push(payload));

    await harness.service.submitHumanMessage(roomId, "@小码 招人");
    await harness.service.waitForIdle();

    expect(approvals).toEqual([]);
    const transcript = await harness.service.listMessages(roomId);
    expect(transcript.some((message) => message.body.includes("格式有问题"))).toBe(true);
  });

  it("关闭该能力时既不注入协议说明，也不受理申请", async () => {
    // 未授权员工的对照测试见下一个用例。
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    await harness.config.update({ policy: { employeeMayHire: "off" } });
    harness.setBehavior(() => ({ text: hireBlock('{"displayName":"新招的测试","framework":"codex"}') }));
    const approvals: unknown[] = [];
    harness.events.on("approval-requested", (payload) => approvals.push(payload));

    await harness.service.submitHumanMessage(roomId, "@小码 招人");
    await harness.service.waitForIdle();

    expect(harness.calls[0]?.prompt).not.toContain("<hiring>");
    expect(approvals).toEqual([]);
    expect(harness.hires).toEqual([]);
  });

  it("未授权的员工：不给协议说明，自己写出协议块也不受理", async () => {
    const harness = await makeHarness();
    const { roomId, reviewer } = await seedTeam(harness);
    // 小测默认没有 canHire
    expect(harness.employees.get(reviewer.id)?.canHire).toBe(false);
    harness.setBehavior(() => ({
      text: hireBlock('{"displayName":"偷偷招的人","framework":"codex"}'),
    }));
    const approvals: unknown[] = [];
    harness.events.on("approval-requested", (payload) => approvals.push(payload));

    await harness.service.submitHumanMessage(roomId, "@小测 招个人");
    await harness.service.waitForIdle();

    expect(harness.calls[0]?.prompt).not.toContain("<hiring>");
    expect(approvals).toEqual([]);
    expect(harness.hires).toEqual([]);
    expect(harness.employees.list().map((item) => item.displayName)).not.toContain("偷偷招的人");
  });

  it("授权开关打开后，同一位员工立刻拿到协议说明", async () => {
    const harness = await makeHarness();
    const { roomId, reviewer } = await seedTeam(harness);
    await harness.employees.update(reviewer.id, { canHire: true });
    harness.setBehavior(() => ({
      text: hireBlock('{"displayName":"新招的测试","framework":"codex"}'),
    }));
    const approvals: unknown[] = [];
    harness.events.on("approval-requested", (payload) => approvals.push(payload));

    await harness.service.submitHumanMessage(roomId, "@小测 招个人");
    await harness.service.waitForIdle();

    expect(harness.calls[0]?.prompt).toContain("<hiring>");
    expect(approvals).toHaveLength(1);
  });

  it("被授权招人的员工能看到全体名册，包括不在本房间的同事", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);
    // 一位不在房间里的同事
    await harness.employees.create({
      displayName: "外部同事",
      framework: "claude-code",
      workspaceDir: join(workDir, "ws", "outside"),
      stateDir: join(workDir, "state", "outside"),
      systemPrompt: "负责数据迁移与清洗。",
      permissions: { mode: "read-only" },
      skills: [],
    });

    await harness.service.submitHumanMessage(roomId, "@小码 看看要不要招人");
    await harness.service.waitForIdle();

    const prompt = harness.calls[0]?.prompt ?? "";
    expect(prompt).toContain("<company_roster>");
    expect(prompt).toContain("外部同事");
    expect(prompt).toContain("负责数据迁移与清洗。");
    // 必须说清能力边界，否则它会去 @ 一个不在房间里的人
    expect(prompt).toContain("只能 @ 本房间的成员");
    // 标出谁在本房间
    expect(prompt).toContain("在本房间");
  });

  it("未授权的员工看不到全体名册", async () => {
    const harness = await makeHarness();
    const { roomId } = await seedTeam(harness);

    await harness.service.submitHumanMessage(roomId, "@小测 看看要不要招人");
    await harness.service.waitForIdle();

    expect(harness.calls[0]?.prompt).not.toContain("<company_roster>");
  });
});
