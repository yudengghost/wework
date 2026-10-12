import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
  createAdapterForEmployee,
  loadPromptPack,
} from "../src/index";

/**
 * 真机端到端：从建员工开始，走完整流程完成一个**真实工作任务**（写一份带表格的文档）。
 * 会真的调用本机 Codex，消耗额度。默认跳过：
 *   $env:BUDDY_LIVE_TESTS=1; npm run test -w @buddy/core -- live-workflow
 */
const liveEnabled = process.env.BUDDY_LIVE_TESTS === "1";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-workflow-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("真机工作流：写一份带表格的文档", () => {
  it("从创建员工到产出文件，全链路可用", async () => {
    const store = new FileStore();
    const config = new ConfigStore(store, join(root, "config.json"));
    await config.load();
    // 关掉记忆归纳，避免验证过程中多跑一次模型调用，让本测试只关注「干活」。
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
      createAdapter: (employee) =>
        createAdapterForEmployee({ employee, launchers: config.get().launchers }),
    });

    // 1) 创建员工（可写工作目录，否则它没法落盘）
    const workspaceDir = join(root, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const employee = await employees.create({
      displayName: "文档员",
      framework: "codex",
      workspaceDir,
      stateDir: join(root, "state"),
      systemPrompt: "你是技术文档作者，产出简洁准确的中文文档。",
      permissions: { mode: "workspace-write" },
      skills: [],
    });

    // 2) 建群聊房间（顺便验证群聊提示词里会带上同事说明）
    const room = await rooms.create({ name: "文档任务", memberIds: [employee.id] });

    // 3) 派一个真实任务
    await service.submitHumanMessage(
      room.id,
      [
        "@文档员 请在当前工作目录下创建 report.md，内容包括：",
        "1) 一级标题「季度进度」；",
        "2) 一个 3 行 3 列的 Markdown 表格（表头：模块 / 负责人 / 状态）；",
        "3) 表格下面一句话总结。",
        "完成后只回复「已生成 report.md」。",
      ].join("\n"),
    );
    await service.waitForIdle();

    const transcript = await messages.readAll(room.id);
    const reply = transcript.at(-1)?.body ?? "";
    const filePath = join(workspaceDir, "report.md");
    const produced = await readFile(filePath, "utf8").catch(() => "");

    console.log(`[workflow] 消息数=${transcript.length}`);
    console.log(`[workflow] 员工回复=${JSON.stringify(reply.slice(0, 200))}`);
    console.log(`[workflow] 产出文件长度=${produced.length}`);
    console.log(`[workflow] 文件前 300 字=${JSON.stringify(produced.slice(0, 300))}`);
    console.log(`[workflow] 会话 id=${employees.get(employee.id)?.sessionRef ?? "(无)"}`);

    // 4) 校验：真的产出了文件，且包含标题与表格
    expect(transcript.length).toBeGreaterThanOrEqual(2);
    expect(transcript[1]?.sender).toEqual({ kind: "employee", employeeId: employee.id });
    expect(produced.length).toBeGreaterThan(0);
    expect(produced).toContain("季度进度");
    expect(produced).toContain("|");
    // 会话应被记下来，下次可续接
    expect(employees.get(employee.id)?.sessionRef).toBeTruthy();
  }, 600000);
});
