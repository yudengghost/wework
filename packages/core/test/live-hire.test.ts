import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AttachmentStore,
  ConfigStore,
  CursorStore,
  EmployeeStore,
  EventBus,
  FileStore,
  MemoryStore,
  MessageLog,
  RoomService,
  RoomStore,
  createAdapterForEmployee,
  loadPromptPack,
  type EmployeeDraft,
  type RoomServiceEvents,
} from "../src/index";

/**
 * 真机演示「模拟 HR」：员工自己判断缺人、自己提交招人申请，用户在房间里批准后
 * 才真正创建。会真的调用本机 Codex。默认跳过：
 *   $env:BUDDY_LIVE_TESTS=1; npm run test -w @buddy/core -- live-hire
 */
const liveEnabled = process.env.BUDDY_LIVE_TESTS === "1";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-hire-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("真机模拟 HR：员工自主发起招人", () => {
  it("HR 员工提交申请，用户批准后新员工才真正创建", async () => {
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

    const approvals: {
      approvalId: string;
      kind?: string;
      summary: string;
      draft?: EmployeeDraft;
      skillsUnknown?: string[];
    }[] = [];
    const events = new EventBus<RoomServiceEvents>();
    const promptsSeen: string[] = [];

    const service = new RoomService({
      config,
      employees,
      rooms,
      messages,
      cursors,
      memory,
      prompts,
      attachments,
      events,
      // 技能目录：HR 应该能看到这两个技能，并把需要的那一个写到申请里。
      skillCatalog: async () => [
        {
          id: "docx",
          name: "文档处理",
          description: "创建与编辑 Word 文档。",
          source: "framework",
          entryPath: join(root, "skills", "docx", "SKILL.md"),
        },
        {
          id: "xlsx",
          name: "表格处理",
          description: "创建与编辑 Excel 表格。",
          source: "framework",
          entryPath: join(root, "skills", "xlsx", "SKILL.md"),
        },
      ],
      // 与桌面端 createEmployeeFromDraft 同形：建目录 + 落档案。
      createEmployee: async (draft) => {
        const workspaceDir = join(root, "workspaces", draft.displayName);
        const stateDir = join(root, "state", draft.displayName);
        await mkdir(workspaceDir, { recursive: true });
        await mkdir(stateDir, { recursive: true });
        const employee = await employees.create({
          displayName: draft.displayName,
          framework: draft.framework,
          workspaceDir,
          stateDir,
          model: draft.model,
          systemPrompt: draft.systemPrompt,
          skills: draft.skills ?? [],
          permissions: { mode: draft.permissionMode ?? "workspace-write" },
        });
        return { ok: true, employee };
      },
      // 包一层只为了把真正投出去的提示词留下来做断言。
      createAdapter: async (employee) => {
        const created = await createAdapterForEmployee({
          employee,
          launchers: config.get().launchers,
        });
        if (!created.ok) return created;
        const inner = created.adapter;
        return {
          ok: true,
          adapter: {
            framework: inner.framework,
            run: (request, onEvent) => {
              promptsSeen.push(request.prompt);
              return inner.run(request, onEvent);
            },
          },
        };
      },
    });
    service.getEvents().on("approval-requested", (payload) => approvals.push(payload));

    const hrWorkspace = join(root, "workspaces", "hr");
    await mkdir(hrWorkspace, { recursive: true });
    const hr = await employees.create({
      displayName: "HR主管",
      framework: "codex",
      workspaceDir: hrWorkspace,
      stateDir: join(root, "state", "hr"),
      systemPrompt: "你是团队负责人，负责判断人手是否充足并组建团队。",
      canHire: true,
      permissions: { mode: "workspace-write" },
      skills: [],
    });
    const room = await rooms.create({ name: "团队组建", memberIds: [hr.id] });

    await service.submitHumanMessage(
      room.id,
      "@HR主管 我们这个项目一直没人写测试，交付质量没底。缺人是事实，不用再确认。请直接提交招人申请：名字叫「测试员」，用 codex，权限 workspace-write（它要能写测试文件），并给它开上「docx」这个技能（技能目录里只有 docx 和 xlsx，它写测试报告要用 docx）。",
    );
    await service.waitForIdle();

    const transcript = await messages.readAll(room.id);
    console.log(`[hire] 房间消息数=${transcript.length}`);
    transcript.forEach((message, index) => {
      console.log(`[hire] --- 消息${index} [${message.kind}] ${JSON.stringify(message.body.slice(0, 500))}`);
    });
    console.log(`[hire] HR 回复=${JSON.stringify((transcript[1]?.body ?? "").slice(0, 400))}`);
    console.log(
      `[hire] 提示词里有技能目录=${promptsSeen[0]?.includes("<skills_catalog>") === true}，申请里的技能=${JSON.stringify(approvals[0]?.draft?.skills ?? null)}`,
    );
    console.log(`[hire] 申请里的未知技能=${JSON.stringify(approvals[0]?.skillsUnknown ?? null)}`);
    console.log(`[hire] 待审批数=${approvals.length}`);
    console.log(`[hire] 审批内容=${JSON.stringify(approvals[0]?.draft ?? null)}`);
    console.log(
      `[hire] 批准前员工=${JSON.stringify(employees.list().map((item) => item.displayName))}`,
    );

    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.kind).toBe("hire");
    const draft = approvals[0]?.draft;
    expect(draft?.displayName).toBe("测试员");
    expect(draft?.framework).toBe("codex");
    expect(draft?.permissionMode).toBe("workspace-write");
    // HR 必须真的按目录填技能，而不是凭空编一个 id。
    expect(draft?.skills).toEqual(["docx"]);
    expect(approvals[0]?.skillsUnknown).toBeUndefined();
    expect(promptsSeen[0]).toContain("<skills_catalog>");
    expect(employees.list().map((item) => item.displayName)).toEqual(["HR主管"]);

    await service.resolveApproval(approvals[0]?.approvalId as string, true);
    await service.waitForIdle();

    const after = await messages.readAll(room.id);
    console.log(
      `[hire] 批准后员工=${JSON.stringify(employees.list().map((item) => item.displayName))}`,
    );
    console.log(`[hire] 房间系统消息=${JSON.stringify(after.at(-1)?.body ?? "")}`);
    console.log(`[hire] 新员工权限=${employees.getByName("测试员")?.permissions.mode}`);

    expect(employees.list().map((item) => item.displayName)).toEqual(["HR主管", "测试员"]);
    expect(employees.getByName("测试员")?.permissions.mode).toBe("workspace-write");
    expect(employees.getByName("测试员")?.skills).toEqual(["docx"]);
    expect(after.at(-1)?.body).toContain("已通过");
  }, 600000);
});
