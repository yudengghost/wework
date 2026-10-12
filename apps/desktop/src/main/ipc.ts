import { join } from "node:path";

import type {
  BuddyConfig,
  DeepPartial,
  Employee,
  Message,
  PermissionMode,
} from "@buddy/core";
import { app, ipcMain, type BrowserWindow } from "electron";

import {
  defaultWorkspaceDir,
  ensureDir,
  listSkills,
  probeFrameworks,
  type AppServices,
} from "./services";

export interface CreateEmployeePayload {
  displayName: string;
  framework: Employee["framework"];
  model?: string;
  systemPrompt?: string;
  skills?: string[];
  permissionMode: PermissionMode;
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
  const { config, employees, rooms, messages, memory, service, dataDir } = services;
  const send = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload);
  };

  const events = service.getEvents();
  events.on("message", (payload) => send("buddy:message", payload));
  events.on("run-started", (payload) => send("buddy:run", { kind: "started", ...payload }));
  events.on("run-text", (payload) => send("buddy:run", { kind: "text", ...payload }));
  events.on("run-finished", (payload) =>
    send("buddy:run", { kind: "finished", ...payload }),
  );
  events.on("run-skipped", (payload) => send("buddy:run", { kind: "skipped", ...payload }));
  events.on("approval-requested", (payload) => send("buddy:approval", payload));

  handle("app:bootstrap", async () => ({
    dataDir,
    bootstrapDir: services.bootstrapDir,
    config: config.get(),
    employees: employees.list(),
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
    const pending = await memory.countPending(employeeId);
    return {
      count: facts.length,
      pending,
      recent: facts.slice(-5).reverse(),
    };
  });

  handle<{ employeeId: string }, boolean>("memory:clear", async ({ employeeId }) => {
    await memory.clear(employeeId);
    return true;
  });

  handle<DeepPartial<BuddyConfig>, BuddyConfig>("settings:update", (patch) =>
    config.update(patch),
  );

  handle("launcher:probe", () => probeFrameworks(config));

  handle<CreateEmployeePayload, Employee>("employee:create", async (payload) => {
    const takenDirs = employees.list().map((employee) => employee.workspaceDir);
    const workspaceDir =
      payload.workspaceDir?.trim() ||
      defaultWorkspaceDir(dataDir, payload.displayName.trim(), takenDirs);
    const stateDir =
      payload.stateDir?.trim() || join(dataDir, "state", workspaceDir.split(/[\\/]/).pop() ?? "x");

    await ensureDir(workspaceDir);
    await ensureDir(stateDir);

    return employees.create({
      displayName: payload.displayName.trim(),
      framework: payload.framework,
      workspaceDir,
      stateDir,
      model: payload.model?.trim() ? payload.model.trim() : undefined,
      systemPrompt: payload.systemPrompt?.trim() ? payload.systemPrompt : undefined,
      skills: payload.skills ?? [],
      permissions: {
        mode: payload.permissionMode,
        allowedTools: [],
        disallowedTools: [],
        requireApprovalFor: [],
      },
    });
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
      if (patch.permissionMode !== undefined) {
        next.permissions = { ...current.permissions, mode: patch.permissionMode };
      }
      return employees.update(id, next);
    },
  );

  handle<{ id: string }, boolean>("employee:remove", async ({ id }) => {
    await employees.remove(id);
    return true;
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

  handle<{ roomId: string; body: string }, Message>("room:send", ({ roomId, body }) =>
    service.submitHumanMessage(roomId, body),
  );

  handle("run:stopAll", () => ({ cancelled: service.stopAll() }));

  handle<{ approvalId: string; approved: boolean }, boolean>(
    "approval:resolve",
    ({ approvalId, approved }) => service.resolveApproval(approvalId, approved),
  );
}
