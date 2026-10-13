import { basename, join } from "node:path";

import type {
  WeworkConfig,
  DeepPartial,
  Employee,
  MessageLogRepair,
  Message,
  PermissionMode,
} from "@wework/core";
import { app, dialog, ipcMain, type BrowserWindow } from "electron";

import {
  createEmployeeFromDraft,
  defaultWorkspaceDir,
  ensureDir,
  listSkills,
  probeFrameworks,
  type AppServices,
} from "./services";
import { withoutApiKey } from "./secrets";

export interface CreateEmployeePayload {
  displayName: string;
  framework: Employee["framework"];
  model?: string;
  systemPrompt?: string;
  skills?: string[];
  permissionMode: PermissionMode;
  /** 是否允许这位员工申请招人（模拟 HR）。 */
  canHire?: boolean;
  /** 允许联网（搜索 / 下载）。文件写入仍限制在它自己的工作目录内。 */
  network?: boolean;
  workspaceDir?: string;
  stateDir?: string;
}

function handle<TPayload, TResult>(
  channel: string,
  handler: (payload: TPayload) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, async (_event, payload: TPayload) => handler(payload));
}

export function registerIpc(
  services: AppServices,
  getWindow: () => BrowserWindow | null,
): void {
  const { config, employees, rooms, messages, memory, service, dataDir, secrets } = services;
  const send = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload);
  };

  const events = service.getEvents();
  events.on("message", (payload) => send("wework:message", payload));
  events.on("run-started", (payload) => send("wework:run", { kind: "started", ...payload }));
  events.on("run-text", (payload) => send("wework:run", { kind: "text", ...payload }));
  events.on("run-finished", (payload) =>
    send("wework:run", { kind: "finished", ...payload }),
  );
  events.on("run-skipped", (payload) => send("wework:run", { kind: "skipped", ...payload }));
  events.on("approval-requested", (payload) => send("wework:approval", payload));

  handle("app:bootstrap", async () => ({
    dataDir,
    bootstrapDir: services.bootstrapDir,
    // 明文密钥永不发给渲染层：这里只给一份抹掉密钥的配置 + 一个「设没设」的布尔量。
    config: withoutApiKey(config.get()),
    builtinApiKeySet: (await secrets.getBuiltinApiKey()) !== null,
    employees: employees.list(),
    removedEmployees: employees.listRemoved(),
    rooms: rooms.list(),
    frameworks: await probeFrameworks(config),
    skills: await listSkills(services),
  }));

  handle("app:relaunch", () => {
    app.relaunch();
    app.exit(0);
    return true;
  });

  handle("skills:catalog", () => listSkills(services));

  handle<{ employeeId: string }, unknown>("memory:list", async ({ employeeId }) => {
    const facts = await memory.listFacts(employeeId);
    const pending = await memory.listPending(employeeId);
    return {
      count: facts.length,
      pendingCount: pending.length,
      facts: facts.slice().reverse(),
      pending: pending.slice().reverse(),
    };
  });

  handle<{ employeeId: string; factId: string }, boolean>(
    "memory:forget",
    ({ employeeId, factId }) => memory.forgetFact(employeeId, factId),
  );

  handle<{ employeeId: string }, boolean>("memory:clear", async ({ employeeId }) => {
    await memory.clear(employeeId);
    return true;
  });

  handle<DeepPartial<WeworkConfig>, WeworkConfig>("settings:update", (patch) => {
    // API Key 只走 settings:set-builtin-key（加密存储）。这里剥掉它，
    // 免得任何一条路径把明文写进 config.json。
    if (patch.builtinAgent === undefined) return config.update(patch);
    const { apiKey: _ignored, ...rest } = patch.builtinAgent;
    return config.update({ ...patch, builtinAgent: rest });
  });

  /** 存或清内置兜底员工的 API Key；密钥只在主进程与加密文件之间流动。 */
  handle<{ apiKey: string | null }, { ok: true }>(
    "settings:set-builtin-key",
    async ({ apiKey }) => {
      await secrets.setBuiltinApiKey(apiKey);
      return { ok: true };
    },
  );

  handle("launcher:probe", () => probeFrameworks(config));

  handle<CreateEmployeePayload, Employee>("employee:create", async (payload) => {
    // 与「员工申请招人」共用同一个创建入口，两条路行为一致。
    const result = await createEmployeeFromDraft({ dataDir, employees }, payload);
    if (!result.ok) throw new Error(result.reason);
    return result.employee;
  });

  handle<{ id: string; patch: Partial<CreateEmployeePayload> }, Employee>(
    "employee:update",
    async ({ id, patch }) => {
      const current = employees.get(id);
      if (!current) throw new Error(`员工不存在: ${id}`);
      const next: Partial<Employee> = {};
      if (patch.displayName !== undefined) next.displayName = patch.displayName.trim();
      if (patch.framework !== undefined) next.framework = patch.framework;
      if (patch.model !== undefined) next.model = patch.model.trim() || undefined;
      if (patch.systemPrompt !== undefined) next.systemPrompt = patch.systemPrompt || undefined;
      if (patch.skills !== undefined) next.skills = patch.skills;
      if (patch.canHire !== undefined) next.canHire = patch.canHire;
      if (patch.permissionMode !== undefined || patch.network !== undefined) {
        next.permissions = {
          ...current.permissions,
          ...(patch.permissionMode === undefined ? {} : { mode: patch.permissionMode }),
          ...(patch.network === undefined ? {} : { network: patch.network }),
        };
      }
      return employees.update(id, next);
    },
  );

  /**
   * 从名册移除员工，**保留**房间与聊天记录（历史里仍然显示原来的名字）。
   */
  handle<{ id: string }, Employee>("employee:remove", ({ id }) => employees.remove(id));

  /** 把移除的员工放回名册。 */
  handle<{ id: string }, Employee>("employee:restore", ({ id }) => employees.restore(id));

  /**
   * 彻底删除：档案、记忆、与它的一对一房间及其消息。
   * 群聊房间只把它移出成员，不删除房间本身。
   * 工作目录留在磁盘上（可能装着用户的东西），只在回执里告知路径。
   */
  handle<{ id: string }, { workspaceDir: string }>("employee:purge", async ({ id }) => {
    const employee = employees.get(id);
    if (!employee) throw new Error(`员工不存在: ${id}`);

    for (const room of rooms.list()) {
      const isDirectWithEmployee =
        room.kind === "direct" && room.memberIds.length === 1 && room.memberIds[0] === id;
      if (isDirectWithEmployee) {
        await rooms.remove(room.id);
        await messages.removeRoom(room.id);
        continue;
      }
      if (room.memberIds.includes(id)) {
        await rooms.update(room.id, {
          memberIds: room.memberIds.filter((memberId) => memberId !== id),
        });
      }
    }

    await memory.clear(id);
    await employees.purge(id);
    return { workspaceDir: employee.workspaceDir };
  });

  handle<{ name: string; memberIds?: string[]; kind?: "group" | "direct" }, unknown>(
    "room:create",
    ({ name, memberIds, kind }) =>
      rooms.create({ name: name.trim(), memberIds: memberIds ?? [], kind: kind ?? "group" }),
  );

  /** 单聊：已存在就复用，避免每次点击都新建一个房间。 */
  handle<{ employeeId: string }, unknown>("room:direct", async ({ employeeId }) => {
    const employee = employees.get(employeeId);
    if (!employee) throw new Error(`员工不存在: ${employeeId}`);

    const existing = rooms
      .list()
      .find(
        (room) =>
          room.kind === "direct" &&
          room.memberIds.length === 1 &&
          room.memberIds[0] === employeeId,
      );
    if (existing) return existing;

    return rooms.create({
      name: employee.displayName,
      kind: "direct",
      memberIds: [employeeId],
    });
  });

  handle<{ id: string; patch: { name?: string; memberIds?: string[] } }, unknown>(
    "room:update",
    ({ id, patch }) => rooms.update(id, patch),
  );

  /** 解散房间：移除房间条目并删除它的消息记录（员工的工作目录与记忆不受影响）。 */
  handle<{ id: string }, boolean>("room:remove", async ({ id }) => {
    await rooms.remove(id);
    await messages.removeRoom(id);
    return true;
  });

  handle<{ roomId: string; employeeId: string; member: boolean }, unknown>(
    "room:member",
    async ({ roomId, employeeId, member }) => {
      const room = rooms.get(roomId);
      if (!room) throw new Error(`房间不存在: ${roomId}`);
      const memberIds = member
        ? [...new Set([...room.memberIds, employeeId])]
        : room.memberIds.filter((id) => id !== employeeId);
      return rooms.update(roomId, { memberIds });
    },
  );

  handle<{ roomId: string }, Message[]>("room:messages", ({ roomId }) =>
    messages.readAll(roomId),
  );

  /** 修复读不出来的消息记录：坏行隔离到备份文件，能解析的保留。 */
  handle<{ roomId: string }, MessageLogRepair>("room:repair", ({ roomId }) =>
    messages.repair(roomId),
  );

  handle<
    { roomId: string; body: string; files?: { name: string; sourcePath: string }[] },
    Message
  >("room:send", ({ roomId, body, files }) =>
    service.submitHumanMessage(roomId, body, files ?? []),
  );

  /** 让用户在系统文件选择器里挑附件；主进程直接拿到路径，不必把文件内容搬过 IPC。 */
  handle("files:pick", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "选择要发给员工的附件",
    });
    if (result.canceled) return [];
    return result.filePaths.map((path) => ({ name: basename(path), sourcePath: path }));
  });

  handle("run:stopAll", () => ({ cancelled: service.stopAll() }));

  handle<{ approvalId: string; approved: boolean }, boolean>(
    "approval:resolve",
    ({ approvalId, approved }) => service.resolveApproval(approvalId, approved),
  );
}
