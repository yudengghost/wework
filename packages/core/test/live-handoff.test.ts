import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
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
  type AgentRunRequest,
  type RoomServiceEvents,
} from "../src/index";

/**
 * 真机验证**员工之间的接力**：两个真实员工在同一个群聊里，
 * 人类只把活交给 A，并说「写完后交给复核员」，由 A 自己决定用 @ 把消息递给 B。
 *
 * 关键点：不给 A 任何「用 @ 交接」的额外指示——它只能从提示词里的 <team> 块得知
 * @ 意味着什么。因此这条测试同时验证了机制与那段提示词是否真的有效。
 *
 * 默认跳过：$env:BUDDY_LIVE_TESTS=1; npm run test -w @buddy/core -- live-handoff
 */
const liveEnabled = process.env.BUDDY_LIVE_TESTS === "1";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-handoff-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("真机接力：员工把活交给另一位员工", () => {
  it("A 写出 @复核员，B 真的被拉起并在房间里回复", async () => {
    const store = new FileStore();
    const config = new ConfigStore(store, join(root, "config.json"));
    await config.load();
    await config.update({ memory: { enabled: false } });

    const employees = new EmployeeStore(store, join(root, "employees.json"));
    await employees.load();
    const rooms = await new RoomStore(store, join(root, "rooms.json"));
    await rooms.load();
    const messages = new MessageLog(store, root);
    const cursors = new CursorStore(store, join(root, "cursors.json"));
    await cursors.load();
    const memory = new MemoryStore(store, root);
    const { pack: prompts } = await loadPromptPack(store, join(root, "prompts.json"));

    // 记录每位员工实际看到的提示词，用来确认 <team> 块确实送达。
    const seen: { employeeId: string; hadTeamBlock: boolean; prompt: string }[] = [];
    const started: string[] = [];
    const events = new EventBus<RoomServiceEvents>();

    const service = new RoomService({
      config,
      employees,
      rooms,
      messages,
      cursors,
      memory,
      prompts,
      events,
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
            async run(request: AgentRunRequest, onEvent) {
              seen.push({
                employeeId: employee.id,
                hadTeamBlock: request.prompt.includes("<team>"),
                prompt: request.prompt,
              });
              return created.adapter.run(request, onEvent);
            },
          },
        };
      },
    });
    service.getEvents().on("run-started", (payload) => started.push(payload.employeeId));

    const authorDir = join(root, "ws-author");
    const reviewerDir = join(root, "ws-reviewer");
    await mkdir(authorDir, { recursive: true });
    await mkdir(reviewerDir, { recursive: true });

    const author = await employees.create({
      displayName: "撰写员",
      framework: "codex",
      workspaceDir: authorDir,
      stateDir: join(root, "state-author"),
      permissions: { mode: "workspace-write" },
      skills: [],
    });
    const reviewer = await employees.create({
      displayName: "复核员",
      framework: "codex",
      workspaceDir: reviewerDir,
      stateDir: join(root, "state-reviewer"),
      permissions: { mode: "read-only" },
      skills: [],
    });
    const room = await rooms.create({
      name: "接力验证",
      memberIds: [author.id, reviewer.id],
    });

    // 注意：只说「交给复核员」，不说怎么交——交接方式必须由 A 自己从 <team> 块推断。
    await service.submitHumanMessage(
      room.id,
      "@撰写员 写一句 30 字以内的产品简介，主题是「Buddy：本地多 Agent 协作桌面应用」。写完后交给复核员确认没有错别字。",
    );
    await service.waitForIdle();

    const transcript = await messages.readAll(room.id);
    const byAuthor = transcript.filter(
      (item) => item.sender.kind === "employee" && item.sender.employeeId === author.id,
    );
    const byReviewer = transcript.filter(
      (item) => item.sender.kind === "employee" && item.sender.employeeId === reviewer.id,
    );

    console.log(`[handoff] 房间消息数=${transcript.length}`);
    console.log(`[handoff] 触发的运行=${JSON.stringify(started)}`);
    console.log(`[handoff] A 收到的提示词含 <team>=${seen[0]?.hadTeamBlock}`);
    console.log(`[handoff] A 的回复=${JSON.stringify(byAuthor[0]?.body.slice(0, 200))}`);
    console.log(`[handoff] B 的回复=${JSON.stringify(byReviewer[0]?.body.slice(0, 200))}`);

    // 机制层面：A 必须真的用 @ 把消息递出去
    expect(byAuthor[0]?.body ?? "").toContain("@复核员");
    expect(byAuthor[0]?.mentions).toContainEqual({
      kind: "employee",
      employeeId: reviewer.id,
    });
    // 行为层面：B 真的被拉起来并回复了
    expect(started).toContain(reviewer.id);
    expect(byReviewer.length).toBeGreaterThan(0);
    expect((byReviewer[0]?.body ?? "").trim().length).toBeGreaterThan(0);

    // 第二轮：B 复核完并没有 @ 回 A。人类再问一句，A 是否能看到 B 的回复？
    const reviewerReplyNeedle = (byReviewer[0]?.body ?? "").trim().slice(0, 15);
    const authorSeenBefore = seen.filter((item) => item.employeeId === author.id).length;

    await service.submitHumanMessage(room.id, "@撰写员 复核员那边怎么说的？一句话概括。");
    await service.waitForIdle();

    const authorPrompts = seen.filter((item) => item.employeeId === author.id);
    const secondPrompt = authorPrompts.at(-1)?.prompt ?? "";
    const transcript2 = await messages.readAll(room.id);

    console.log(`[handoff] A 第二次运行的提示词长度=${secondPrompt.length}`);
    console.log(
      `[handoff] 提示词含 B 的回复原文=${secondPrompt.includes(reviewerReplyNeedle)}（needle=${JSON.stringify(reviewerReplyNeedle)}）`,
    );
    console.log(`[handoff] 提示词含「复核员」署名=${secondPrompt.includes("复核员")}`);
    console.log(`[handoff] A 第二次回复=${JSON.stringify(transcript2.at(-1)?.body.slice(0, 160))}`);

    // A 确实又跑了一次
    expect(authorPrompts.length).toBe(authorSeenBefore + 1);
    // 关键：B 的回复通过增量上下文进入了 A 的视野，并带上发送者名字
    expect(secondPrompt).toContain(reviewerReplyNeedle);
    expect(secondPrompt).toContain("复核员");
  }, 600000);
});
