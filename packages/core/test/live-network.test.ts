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
 * 真机确认「员工默认允许联网」不是一句配置：默认建的员工真的能抓到网页。
 * 默认跳过，显式开启才会跑（会真的联网 + 调用本机 codex）：
 *   $env:WEWORK_LIVE_TESTS=1; npm run test -w @wework/core -- live-network
 */
const liveEnabled = process.env.WEWORK_LIVE_TESTS === "1";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-net-live-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("真机：默认员工联网", () => {
  it("建员工时不填联网字段，它也能抓到网页", async () => {
    const store = new FileStore();
    const config = new ConfigStore(store, join(root, "config.json"));
    await config.load();
    await config.update({ memory: { enabled: false } });

    const employees = new EmployeeStore(store, join(root, "employees.json"));
    await employees.load();
    const rooms = new RoomStore(store, join(root, "rooms.json"));
    await rooms.load();
    const messages = new MessageLog(store, root);
    const cursors = new CursorStore(store, join(root, "cursors.json"));
    await cursors.load();
    const memory = new MemoryStore(store, root);
    const { pack: prompts } = await loadPromptPack(store, join(root, "prompts.json"));

    const service = new RoomService({
      config,
      employees,
      rooms,
      messages,
      cursors,
      memory,
      prompts,
      attachments: new AttachmentStore({ dataDir: root }),
      createAdapter: (employee) =>
        createAdapterForEmployee({ employee, launchers: config.get().launchers }),
    });

    const workspaceDir = join(root, "workspaces", "小网");
    await mkdir(workspaceDir, { recursive: true });
    // 故意不写 network：走的就是 schema 的默认值
    const employee = await employees.create({
      displayName: "小网",
      framework: "codex",
      workspaceDir,
      stateDir: join(root, "state", "小网"),
      permissions: { mode: "workspace-write" },
    });
    console.log(`[net] 默认权限=${JSON.stringify(employee.permissions)}`);
    expect(employee.permissions.network).toBe(true);

    const room = await rooms.create({ name: "联网自检", memberIds: [employee.id] });
    await service.submitHumanMessage(
      room.id,
      "@小网 请联网抓 https://example.com，把标题写进你工作目录里的 net.txt，然后只回复一行：标题=<标题>。",
    );
    await service.waitForIdle();

    const transcript = await messages.readAll(room.id);
    const reply = transcript.find((item) => item.sender.kind === "employee")?.body ?? "";
    console.log(`[net] 回复=${JSON.stringify(reply.slice(0, 200))}`);

    const fetched = await readFile(join(workspaceDir, "net.txt"), "utf8").catch(() => "");
    console.log(`[net] net.txt=${JSON.stringify(fetched.slice(0, 120))}`);
    expect(fetched).toContain("Example Domain");
    expect(reply).toContain("Example Domain");
  }, 600000);
});
