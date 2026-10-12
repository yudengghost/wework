import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigStore,
  CursorStore,
  EmployeeStore,
  FileStore,
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
