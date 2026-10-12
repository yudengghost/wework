import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigStore,
  CursorStore,
  EmployeeStore,
  FileStore,
  MemoryStore,
  MessageLog,
  RoomService,
  RoomStore,
  createCodexAdapter,
  createSystemEnvironment,
  resolveLauncher,
  createAdapterForEmployee,
  type AgentEvent,
} from "../src/index";

/**
 * 可选的真机联调测试：会真的调用本机已安装的 Codex CLI（消耗少量额度）。
 * 默认跳过，用 BUDDY_LIVE_TESTS=1 显式开启：
 *   $env:BUDDY_LIVE_TESTS=1; npm run test -w @buddy/core -- live-agent
 */
const liveEnabled = process.env.BUDDY_LIVE_TESTS === "1";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "buddy-live-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("真实 Codex CLI 联调", () => {
  it("从探测到事件解析的完整链路可用", async () => {
    const resolution = await resolveLauncher(
      "codex",
      { executablePath: null, detectWsl: false },
      createSystemEnvironment(),
    );
    if (resolution.status !== "found") {
      throw new Error("本机未找到 codex，无法进行联调");
    }

    const adapter = createCodexAdapter(resolution);
    const events: AgentEvent[] = [];

    const result = await adapter.run(
      {
        prompt: "Reply with exactly one word: pong",
        cwd: workDir,
        permissions: {
          mode: "read-only",
          allowedTools: [],
          disallowedTools: [],
          requireApprovalFor: [],
        },
        timeoutMs: 120000,
      },
      (event) => events.push(event),
    );

    console.log(`[live] command=${resolution.command} baseArgs=${JSON.stringify(resolution.baseArgs)}`);
    console.log(`[live] ok=${result.ok} exit=${result.exitCode} text=${JSON.stringify(result.text)}`);
    console.log(`[live] sessionRef=${result.sessionRef} usage=${JSON.stringify(result.usage)}`);
    console.log(`[live] stderr=${JSON.stringify(result.stderr.slice(0, 800))}`);
    console.log(`[live] eventTypes=${events.map((event) => event.type).join(",")}`);

    expect(result.ok).toBe(true);
    expect(result.text.toLowerCase()).toContain("pong");
    expect(result.sessionRef).toBeTruthy();
    expect(events.some((event) => event.type === "usage")).toBe(true);
  }, 180000);
});

describe.skipIf(!liveEnabled)("真实房间端到端联调", () => {
  it("人类 @员工 后，员工在房间里产出回复", async () => {
    const store = new FileStore();
    const config = new ConfigStore(store, join(workDir, "config.json"));
    await config.load();
    const employees = new EmployeeStore(store, join(workDir, "employees.json"));
    await employees.load();
    const rooms = new RoomStore(store, join(workDir, "rooms.json"));
    await rooms.load();
    const messages = new MessageLog(store, workDir);
    const cursors = new CursorStore(store, join(workDir, "cursors.json"));
    await cursors.load();

    const service = new RoomService({
      config,
      employees,
      rooms,
      messages,
      cursors,
      createAdapter: (employee) =>
        createAdapterForEmployee({ employee, launchers: config.get().launchers }),
    });

    const workspaceDir = join(workDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const employee = await employees.create({
      displayName: "小码",
      framework: "codex",
      workspaceDir,
      stateDir: join(workDir, "state"),
      permissions: { mode: "read-only" },
      skills: [],
    });
    const room = await rooms.create({ name: "联调房间", memberIds: [employee.id] });

    await service.submitHumanMessage(room.id, "@小码 Reply with exactly one word: pong");
    await service.waitForIdle();

    const all = await messages.readAll(room.id);
    console.log(
      `[live-room] messages=${all.length} kinds=${all.map((item) => item.sender.kind).join(",")} reply=${JSON.stringify(all.at(-1)?.body)}`,
    );

    expect(all).toHaveLength(2);
    expect(all[1]?.sender).toEqual({ kind: "employee", employeeId: employee.id });
    expect((all[1]?.body ?? "").toLowerCase()).toContain("pong");
    expect(employees.get(employee.id)?.sessionRef).toBeTruthy();
  }, 240000);
});

describe.skipIf(!liveEnabled)("真实运行中的上下文与记忆", () => {
  interface RecordedRun {
    kind: "work" | "distill";
    sessionRef?: string;
    prompt: string;
  }

  it("上下文靠原生会话续接 + 增量投递，记忆经归纳后注入", async () => {
    const store = new FileStore();
    const config = new ConfigStore(store, join(workDir, "config.json"));
    await config.load();
    await config.update({
      memory: { distillAfterPending: 1, maxInjectedFacts: 5 },
      scheduler: { contextWindowMessages: 20 },
    });

    const employees = new EmployeeStore(store, join(workDir, "employees.json"));
    await employees.load();
    const rooms = new RoomStore(store, join(workDir, "rooms.json"));
    await rooms.load();
    const messages = new MessageLog(store, workDir);
    const cursors = new CursorStore(store, join(workDir, "cursors.json"));
    await cursors.load();
    const memory = new MemoryStore(store, workDir);

    const runs: RecordedRun[] = [];
    const service = new RoomService({
      config,
      employees,
      rooms,
      messages,
      cursors,
      memory,
      createAdapter: async (employee) => {
        const created = await createAdapterForEmployee({
          employee,
          launchers: config.get().launchers,
        });
        if (!created.ok) return created;
        // 包一层，记录每次真实调用看到了什么提示词、用的是哪个会话。
        return {
          ok: true,
          adapter: {
            framework: created.adapter.framework,
            async run(request, onEvent) {
              runs.push({
                kind: request.systemPrompt?.includes("记忆整理器") ? "distill" : "work",
                sessionRef: request.sessionRef,
                prompt: request.prompt,
              });
              return created.adapter.run(request, onEvent);
            },
          },
        };
      },
    });

    const workspaceDir = join(workDir, "ws-memory");
    await mkdir(workspaceDir, { recursive: true });
    const employee = await employees.create({
      displayName: "小记",
      framework: "codex",
      workspaceDir,
      stateDir: join(workDir, "state-memory"),
      permissions: { mode: "read-only" },
      skills: [],
    });
    const room = await rooms.create({ name: "记忆联调", memberIds: [employee.id] });

    // 第一轮：建立一条约定，触发归纳
    await service.submitHumanMessage(
      room.id,
      "@小记 请记住这条约定：本项目的测试命令是 npm test。只需回复「记住了」。",
    );
    await service.waitForIdle();

    const work1 = runs.find((run) => run.kind === "work");
    const distill = runs.find((run) => run.kind === "distill");
    const facts = await memory.listFacts(employee.id);
    console.log(`[live-mem] work1.sessionRef=${work1?.sessionRef ?? "(新会话)"}`);
    console.log(`[live-mem] 归纳调用 sessionRef=${distill?.sessionRef ?? "(新会话)"}`);
    console.log(`[live-mem] 长期记忆=${JSON.stringify(facts.map((fact) => fact.text))}`);

    expect(work1).toBeTruthy();
    expect(distill).toBeTruthy();
    // 归纳必须用全新会话，不能污染员工的工作会话
    expect(distill?.sessionRef).toBeUndefined();
    expect(facts.length).toBeGreaterThan(0);
    expect(await memory.countPending(employee.id)).toBe(0);

    // 第二轮：验证「原生会话承担上下文」+「增量投递不重灌历史」+「长期记忆被注入」
    runs.length = 0;
    await service.submitHumanMessage(room.id, "@小记 刚才那条约定里的测试命令是什么？只回答命令本身。");
    await service.waitForIdle();

    const work2 = runs.find((run) => run.kind === "work");
    const replies = await messages.readAll(room.id);
    console.log(`[live-mem] work2.sessionRef=${work2?.sessionRef ?? "(新会话)"}`);
    console.log(`[live-mem] 提示词含长期记忆=${work2?.prompt.includes("<long_term_memory>")}`);
    console.log(
      `[live-mem] 提示词含上一轮原话=${work2?.prompt.includes("请记住这条约定") ?? false}`,
    );
    console.log(`[live-mem] 末条回复=${JSON.stringify(replies.at(-1)?.body)}`);

    expect(work2?.sessionRef).toBeTruthy();
    expect(work2?.prompt).toContain("<long_term_memory>");
    expect(work2?.prompt).not.toContain("请记住这条约定");
    expect(replies.at(-1)?.body ?? "").toContain("npm test");
  }, 600000);
});
