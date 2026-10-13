import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
  catalogSkills,
  createAdapterForEmployee,
  createSystemSkillFileSystem,
  installSkillsFromWorkspace,
  loadPromptPack,
  type EmployeeDraft,
  type RoomServiceEvents,
} from "../src/index";

/**
 * 真机演示「HR 自己上网找技能、下载、招人时带上」。
 *
 * 员工跑在沙箱里只能写自己的工作目录，所以约定是：下载到工作目录 → 申请里写相对路径 →
 * 批准后由应用装进技能目录。这条测试会**真的联网下载**，默认跳过：
 *   $env:WEWORK_LIVE_TESTS=1; npm run test -w @wework/core -- live-skill-install
 */
const liveEnabled = process.env.WEWORK_LIVE_TESTS === "1";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-skill-live-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!liveEnabled)("真机：HR 自己找技能并装给新同事", () => {
  it("HR 联网下载技能 → 申请里带上 → 批准后装进技能目录并启用", async () => {
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
      draft?: EmployeeDraft;
      summary: string;
    }[] = [];
    const events = new EventBus<RoomServiceEvents>();
    // 技能扫描按真实进程环境找框架目录（这里关掉框架技能，只看临时数据目录）。
    const env = process.env;

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
      // 技能目录就是临时数据目录，扫描逻辑与线上完全一致。
      skillCatalog: () =>
        catalogSkills({
          dataDir: root,
          includeFrameworkSkills: false,
          env,
          fs: createSystemSkillFileSystem(),
        }),
      skillsFor: async (employee) =>
        (
          await catalogSkills({
            dataDir: root,
            includeFrameworkSkills: false,
            env,
            fs: createSystemSkillFileSystem(),
          })
        ).filter((skill) => employee.skills.includes(skill.id)),
      // 与桌面端 createEmployeeFromDraft 同形：先装技能，再建人，最后把回执交回去。
      createEmployee: async (draft, context) => {
        const install = await installSkillsFromWorkspace({
          dataDir: root,
          requesterWorkspaceDir: context.requesterWorkspaceDir,
          sources: draft.installSkills ?? [],
        });
        const workspaceDir = join(root, "workspaces", draft.displayName);
        const stateDir = join(root, "state", draft.displayName);
        await mkdir(workspaceDir, { recursive: true });
        await mkdir(stateDir, { recursive: true });
        const employee = await employees.create({
          displayName: draft.displayName,
          framework: draft.framework,
          workspaceDir,
          stateDir,
          systemPrompt: draft.systemPrompt,
          skills: [...new Set([...(draft.skills ?? []), ...install.installed, ...install.reused])],
          permissions: { mode: draft.permissionMode ?? "workspace-write" },
        });
        const notes = [
          ...install.installed.map((id) => `已把新技能「${id}」装进技能目录并启用。`),
          ...install.failed.map((item) => `技能没装上「${item.source}」：${item.reason}`),
        ];
        return { ok: true, employee, ...(notes.length === 0 ? {} : { notes }) };
      },
      createAdapter: (employee) =>
        createAdapterForEmployee({ employee, launchers: config.get().launchers }),
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
      // 联网是这条流程的前提：沙箱默认不放开网络，实测 hr 会拿到 NO_NETWORK。
      permissions: { mode: "workspace-write", network: true },
      skills: [],
    });
    const room = await rooms.create({ name: "团队组建", memberIds: [hr.id] });

    await service.submitHumanMessage(
      room.id,
      "@HR主管 我们需要一位写文档的同事，但它得会用现成的技能。本机技能目录是空的，请你自己去网上找：" +
        "打开 https://github.com/anthropics/skills 看看现有技能清单（skills/<名字>/SKILL.md），" +
        "挑一个跟「写文档」最匹配的，把它下载到你自己的工作目录 .wework/skills/<技能名>/SKILL.md（正文一起存下来），" +
        "然后提交招人申请：名字叫「文档专员」，codex，权限 workspace-write，skills 写你下载的那个技能名，" +
        "installSkills 写相对路径 .wework/skills/<技能名>。不用再确认，直接提。",
    );
    await service.waitForIdle();

    const transcript = await messages.readAll(room.id);
    console.log(`[skill] 房间消息数=${transcript.length}`);
    console.log(`[skill] HR 回复=${JSON.stringify((transcript[1]?.body ?? "").slice(0, 600))}`);
    console.log(`[skill] 待审批=${JSON.stringify(approvals[0]?.draft ?? null)}`);

    expect(approvals).toHaveLength(1);
    const draft = approvals[0]?.draft;
    const installSource = draft?.installSkills?.[0] ?? "";
    expect(installSource.startsWith(".wework/skills/")).toBe(true);

    // 下载必须真的落在 HR 的工作目录里，否则应用那边搬什么都不知道
    const downloaded = join(hrWorkspace, installSource, "SKILL.md");
    console.log(`[skill] 下载落点=${downloaded} 存在=${await exists(downloaded)}`);
    expect(await exists(downloaded)).toBe(true);
    console.log(`[skill] 下载到的内容前 200 字=${JSON.stringify((await readFile(downloaded, "utf8")).slice(0, 200))}`);

    await service.resolveApproval(approvals[0]?.approvalId as string, true);
    await service.waitForIdle();

    const skillId = installSource.replace(/^\.wework\/skills\//, "");
    const installed = join(root, "skills", skillId, "SKILL.md");
    console.log(`[skill] 装进技能目录=${installed} 存在=${await exists(installed)}`);
    expect(await exists(installed)).toBe(true);
    const hired = employees.getByName("文档专员")?.skills ?? [];
    console.log(`[skill] 新员工技能=${JSON.stringify(hired)}`);
    expect(hired).toContain(skillId);
    // 同一份技能被 skills 与 installSkills 各写一次时，不该在档案里出现两遍
    expect(hired.filter((id) => id === skillId)).toHaveLength(1);

    const after = await messages.readAll(room.id);
    console.log(`[skill] 批准后回执=${JSON.stringify(after.map((item) => item.body).slice(-2))}`);
    expect(after.some((item) => item.body.includes("装进技能目录"))).toBe(true);
  }, 900000);
});
