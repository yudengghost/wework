import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AttachmentStore,
  ConfigStore,
  CursorStore,
  EmployeeStore,
  FileStore,
  MemoryStore,
  MessageLog,
  RoomService,
  RoomStore,
  createAdapterForEmployee,
  loadPromptPack,
} from "../src/index";

/**
 * 真机确认「单次运行默认不设超时」不是一句配置说明：
 * 同一个慢任务，显式设了 5 秒超时会被杀掉，默认（不限制）则能跑完。
 *
 * 默认跳过，显式开启才会跑（会真的调用本机 codex）：
 *   $env:WEWORK_LIVE_TESTS="1"; npm run test -w @wework/core -- live-timeout
 */
const liveEnabled = process.env.WEWORK_LIVE_TESTS === "1";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-timeout-live-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 造一间房、一位员工；budget 为 null 表示不设超时。 */
async function setup(budget: number | null) {
  const store = new FileStore();
  const config = new ConfigStore(store, join(root, "config.json"));
  await config.load();
  await config.update({ memory: { enabled: false }, scheduler: { wallClockBudgetMs: budget } });

  const employees = new EmployeeStore(store, join(root, "employees.json"));
  await employees.load();
  const rooms = new RoomStore(store, join(root, "rooms.json"));
  await rooms.load();
  const messages = new MessageLog(store, root);
  const cursors = new CursorStore(store, join(root, "cursors.json"));
  await cursors.load();
  const { pack: prompts } = await loadPromptPack(store, join(root, "prompts.json"));

  const service = new RoomService({
    config,
    employees,
    rooms,
    messages,
    cursors,
    memory: new MemoryStore(store, root),
    prompts,
    attachments: new AttachmentStore({ dataDir: root }),
    createAdapter: (employee) =>
      createAdapterForEmployee({ employee, launchers: config.get().launchers }),
  });

  const workspaceDir = join(root, "workspaces", "小慢");
  await mkdir(workspaceDir, { recursive: true });
  const employee = await employees.create({
    displayName: "小慢",
    framework: "codex",
    workspaceDir,
    stateDir: join(root, "state", "小慢"),
    permissions: { mode: "workspace-write" },
  });
  const room = await rooms.create({ name: "超时自检", memberIds: [employee.id] });
  return { service, room, messages, config };
}

const SLOW_TASK =
  "@小慢 请用 PowerShell 执行一条命令：Start-Sleep -Seconds 12；等它跑完后只回复一行 OK。";

describe.skipIf(!liveEnabled)("真机：单次运行超时", () => {
  it("显式设了 5 秒超时：慢任务会被杀掉并如实说明", async () => {
    const { service, room, messages } = await setup(5000);

    const started = Date.now();
    await service.submitHumanMessage(room.id, SLOW_TASK);
    await service.waitForIdle();
    const elapsed = Date.now() - started;

    const transcript = await messages.readAll(room.id);
    console.log(`[超时] 耗时=${elapsed}ms 记录=${JSON.stringify(transcript.map((m) => m.body.slice(0, 80)))}`);
    expect(transcript.at(-1)?.body).toContain("运行超时");
    expect(service.snapshotRuns()[0]?.status).toBe("failed");
    // 5 秒的闸，不该拖到 12 秒的任务自然结束
    expect(elapsed).toBeLessThan(11_000);
  }, 300000);

  it("默认不设超时：同一个慢任务能正常跑完", async () => {
    const { service, room, messages } = await setup(null);

    const started = Date.now();
    await service.submitHumanMessage(room.id, SLOW_TASK);
    await service.waitForIdle();
    const elapsed = Date.now() - started;

    const transcript = await messages.readAll(room.id);
    const reply = transcript.find((item) => item.sender.kind === "employee")?.body ?? "";
    console.log(`[超时] 耗时=${elapsed}ms 回复=${JSON.stringify(reply.slice(0, 120))}`);
    // 跑得比 5 秒久得多，但没有被杀
    expect(elapsed).toBeGreaterThan(9_000);
    expect(reply).toContain("OK");
    expect(service.snapshotRuns()[0]?.status).toBe("done");
  }, 300000);
});
