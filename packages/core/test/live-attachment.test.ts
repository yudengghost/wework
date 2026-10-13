import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  type AgentRunRequest,
} from "../src/index";

/**
 * 真机验证附件：把一份真实文件附在消息上，看员工能不能读到它的内容。
 * 会真的调用本机 Codex。默认跳过：
 *   $env:WEWORK_LIVE_TESTS=1; npm run test -w @wework/core -- live-attachment
 */
const liveEnabled = process.env.WEWORK_LIVE_TESTS === "1";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-attach-live-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("真机附件：员工读取消息里的文件", () => {
  it("附件被复制进工作目录，员工读到内容并据此作答", async () => {
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
    const attachments = new AttachmentStore({ dataDir: root });

    const requests: AgentRunRequest[] = [];
    const service = new RoomService({
      config,
      employees,
      rooms,
      messages,
      cursors,
      memory,
      prompts,
      attachments,
      createAdapter: async (employee) => {
        const created = await createAdapterForEmployee({
          employee,
          launchers: config.get().launchers,
        });
        if (!created.ok) return created;
        return {
          ok: true,
          adapter: {
            framework: created.adapter.framework,
            async run(request, onEvent) {
              requests.push(request);
              return created.adapter.run(request, onEvent);
            },
          },
        };
      },
    });

    // 造一份带唯一暗号的文件，员工只有真读过才知道内容
    const workspaceDir = join(root, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const sourceDir = join(root, "source");
    await mkdir(sourceDir, { recursive: true });
    const sourcePath = join(sourceDir, "项目说明.txt");
    await writeFile(sourcePath, "项目代号：ORCA-7731\n负责人：林工\n", "utf8");

    const employee = await employees.create({
      displayName: "读文件的员工",
      framework: "codex",
      workspaceDir,
      stateDir: join(root, "state"),
      permissions: { mode: "workspace-write" },
      skills: [],
    });
    const room = await rooms.create({
      name: "附件验证",
      kind: "direct",
      memberIds: [employee.id],
    });

    const human = await service.submitHumanMessage(
      room.id,
      "我把项目说明放在附件里了，请读一下，只回答里面的项目代号是什么。",
      [{ name: "项目说明.txt", sourcePath }],
    );
    await service.waitForIdle();

    const transcript = await messages.readAll(room.id);
    const reply = transcript.at(-1)?.body ?? "";
    const stagedRelative = requests[0]?.attachments?.[0]?.relativePath ?? "";
    const stagedCopy = await readFile(
      join(workspaceDir, stagedRelative.replace(/\//g, "\\")),
      "utf8",
    ).catch(() => "");

    console.log(`[attach] 消息附件数=${human.attachments.length}`);
    console.log(`[attach] 房间级副本=${human.attachments[0]?.path ?? ""}`);
    console.log(`[attach] 提示词含 <attachments>=${(requests[0]?.prompt ?? "").includes("<attachments>")}`);
    console.log(`[attach] 请求携带附件数=${requests[0]?.attachments?.length ?? 0}`);
    console.log(`[attach] 工作目录副本相对路径=${stagedRelative}`);
    console.log(`[attach] 副本内容=${JSON.stringify(stagedCopy)}`);
    console.log(`[attach] 员工回复=${JSON.stringify(reply.slice(0, 160))}`);

    // 1) 人类消息上确实挂了附件
    expect(human.attachments).toHaveLength(1);
    expect(human.attachments[0]?.mimeType).toBe("text/plain");
    // 2) 附件确实被复制进了员工工作目录
    expect(stagedRelative).toBe(`attachments/${human.id}/项目说明.txt`);
    expect(stagedCopy).toContain("ORCA-7731");
    // 3) 提示词里告诉了员工附件在哪
    expect(requests[0]?.prompt).toContain("<attachments>");
    expect(requests[0]?.prompt).toContain(stagedRelative);
    // 4) 关键：员工真的读到了内容
    expect(reply).toContain("ORCA-7731");
  }, 600000);
});
