import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigStore,
  EmployeeStore,
  FileStore,
  MessageLog,
  RoomStore,
  type Message,
} from "../src/index";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "wework-integration-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("核心存储层协同", () => {
  it("配置 + 员工 + 房间 + 消息端到端可用", async () => {
    const store = new FileStore();

    const configStore = new ConfigStore(store, join(dataDir, "config.json"));
    const config = await configStore.load();
    expect(config.scheduler.maxMentionDepth).toBe(3);
    await configStore.update({ policy: { employeeMentionsEmployee: "confirm" } });

    const employeeStore = new EmployeeStore(store, join(dataDir, "employees.json"));
    await employeeStore.load();
    const reviewer = await employeeStore.create({
      displayName: "评审员",
      framework: "claude-code",
      workspaceDir: join(dataDir, "workspaces", "reviewer"),
      stateDir: join(dataDir, "state", "reviewer"),
      permissions: { mode: "read-only" },
      skills: [],
    });
    const coder = await employeeStore.create({
      displayName: "码农",
      framework: "codex",
      workspaceDir: join(dataDir, "workspaces", "coder"),
      stateDir: join(dataDir, "state", "coder"),
      permissions: { mode: "workspace-write" },
      skills: [],
    });

    const roomStore = new RoomStore(store, join(dataDir, "rooms.json"));
    await roomStore.load();
    const room = await roomStore.create({
      name: "发布前检查",
      memberIds: [coder.id, reviewer.id],
    });

    const messageLog = new MessageLog(store, dataDir);
    const now = new Date().toISOString();
    const humanMessage: Message = {
      id: "msg_human_1",
      roomId: room.id,
      sender: { kind: "human" },
      mentions: [{ kind: "employee", employeeId: reviewer.id }],
      body: "@评审员 看下这次改动",
      attachments: [],
      kind: "chat",
      createdAt: now,
    };
    await messageLog.append(humanMessage);
    await messageLog.append({
      id: "msg_employee_1",
      roomId: room.id,
      sender: { kind: "employee", employeeId: reviewer.id },
      mentions: [],
      body: "看过了，没问题",
      attachments: [],
      kind: "chat",
      createdAt: new Date().toISOString(),
    });

    const recent = await messageLog.readRecent(room.id, 10);
    expect(recent).toHaveLength(2);
    expect(recent[1]?.body).toBe("看过了，没问题");
    expect(await messageLog.count(room.id)).toBe(2);

    const reloadedEmployees = new EmployeeStore(store, join(dataDir, "employees.json"));
    await reloadedEmployees.load();
    expect(reloadedEmployees.getByName("码农")?.id).toBe(coder.id);

    const reloadedConfig = new ConfigStore(store, join(dataDir, "config.json"));
    await reloadedConfig.load();
    expect(reloadedConfig.get().policy.employeeMentionsEmployee).toBe("confirm");
  });
});
