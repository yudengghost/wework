import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
 * 真机确认「员工在不在干活」这件事真的看得见：
 * 消息一进队就有记录，调用的命令逐条进入轨迹，失败一定有交代。
 *
 * 默认跳过，显式开启才会跑（会真的调用本机 codex）：
 *   $env:WEWORK_LIVE_TESTS="1"; npm run test -w @wework/core -- live-visibility
 */
const liveEnabled = process.env.WEWORK_LIVE_TESTS === "1";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-visibility-live-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function build(options: { displayName: string; launcherPath?: string }) {
  const store = new FileStore();
  const config = new ConfigStore(store, join(root, "config.json"));
  await config.load();
  await config.update({
    memory: { enabled: false },
    ...(options.launcherPath === undefined
      ? {}
      : { launchers: { codex: { executablePath: options.launcherPath } } }),
  });

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

  const workspaceDir = join(root, "workspaces", options.displayName);
  await mkdir(workspaceDir, { recursive: true });
  const employee = await employees.create({
    displayName: options.displayName,
    framework: "codex",
    workspaceDir,
    stateDir: join(root, "state", options.displayName),
    permissions: { mode: "workspace-write" },
  });
  const room = await rooms.create({ name: "可见性自检", memberIds: [employee.id] });

  const seen: { type: string; detail: string }[] = [];
  const events = service.getEvents();
  events.on("run-queued", (payload) => seen.push({ type: "queued", detail: payload.trigger }));
  events.on("run-started", () => seen.push({ type: "started", detail: "" }));
  events.on("run-step", (payload) =>
    seen.push({
      type: `step/${payload.step.kind}`,
      detail: payload.step.detail ?? payload.step.tool ?? payload.step.text ?? "",
    }),
  );
  events.on("run-finished", (payload) =>
    seen.push({
      type: "finished",
      detail: `${payload.status} ok=${payload.ok} ${payload.elapsedMs}ms ${payload.error ?? ""}`,
    }),
  );

  return { service, room, employee, workspaceDir, messages, seen };
}

describe.skipIf(!liveEnabled)("真机：运行可见性", () => {
  it("从受理到收尾全程可见，工具调用进入轨迹，且真的干了活", async () => {
    const { service, room, workspaceDir, messages, seen } = await build({ displayName: "小察" });

    await service.submitHumanMessage(
      room.id,
      "@小察 请在当前目录建一个 note.txt，内容写 done，然后用一条命令把它打印出来。最后只回复一行：完成。",
    );

    // 关键承诺：消息刚发出去（员工还没开口）就已经有记录可查。
    const early = service.snapshotRuns();
    console.log(`[可见性] 受理瞬间的轨迹=${JSON.stringify(early.map((t) => [t.status, t.trigger]))}`);
    expect(early).toHaveLength(1);
    expect(["queued", "running"]).toContain(early[0]?.status);
    expect(early[0]?.trigger).toContain("note.txt");

    await service.waitForIdle();

    console.log(`[可见性] 事件序列=${JSON.stringify(seen, null, 1)}`);
    const kinds = seen.map((entry) => entry.type);
    expect(kinds[0]).toBe("queued");
    // 受理一定发生在开跑之前：排队期间界面就有东西可显示。
    expect(kinds.indexOf("queued")).toBeLessThan(kinds.indexOf("started"));
    expect(kinds).toContain("step/tool");
    expect(kinds).toContain("finished");

    const toolSteps = seen.filter((entry) => entry.type === "step/tool");
    console.log(`[可见性] 工具步骤=${JSON.stringify(toolSteps.map((entry) => entry.detail))}`);
    // 轨迹里能看到它到底跑了什么命令，而不是一个不动的「正在思考」
    expect(toolSteps.some((entry) => entry.detail.length > 0)).toBe(true);

    const [trace] = service.snapshotRuns();
    expect(trace?.status).toBe("done");
    expect(trace?.steps.length).toBeGreaterThanOrEqual(3);
    expect(trace?.text.length ?? 0).toBeGreaterThan(0);

    const finished = seen.find((entry) => entry.type === "finished");
    console.log(`[可见性] 结束=${finished?.detail}`);
    expect(finished?.detail).toMatch(/^done ok=true \d+ms/);
    expect(Number(finished?.detail.match(/(\d+)ms/)?.[1] ?? 0)).toBeGreaterThan(1000);

    // 轨迹只是观察窗，真正的产出仍要落在它自己的工作目录里
    const written = await readFile(join(workspaceDir, "note.txt"), "utf8").catch(() => "");
    console.log(`[可见性] note.txt=${JSON.stringify(written.slice(0, 80))}`);
    expect(written).toContain("done");

    const transcript = await messages.readAll(room.id);
    expect(transcript.some((item) => item.sender.kind === "employee")).toBe(true);
  }, 600000);

  it("启动失败时房间里给出原因，而不是一片沉默", async () => {
    const { service, room, messages } = await build({
      displayName: "小坏",
      launcherPath: join(root, "definitely-missing", "codex.exe"),
    });

    await service.submitHumanMessage(room.id, "@小坏 帮我看看这个目录");
    await service.waitForIdle();

    const transcript = await messages.readAll(room.id);
    console.log(`[可见性] 失败路径的房间记录=${JSON.stringify(transcript.map((m) => m.body))}`);
    expect(transcript).toHaveLength(2);
    expect(transcript[1]?.kind).toBe("system");
    expect(transcript[1]?.body).toMatch(/没能开始工作|这次运行失败/);

    const [trace] = service.snapshotRuns();
    expect(["failed", "skipped"]).toContain(trace?.status);
    expect((trace?.error ?? trace?.reason ?? "").length).toBeGreaterThan(0);
  }, 300000);
});
