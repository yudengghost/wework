import { join } from "node:path";

import type {
  BuddyConfig,
  DeepPartial,
  Employee,
  Message,
  PermissionMode,
} from "@buddy/core";
import { ipcMain, type BrowserWindow } from "electron";

import {
  defaultWorkspaceDir,
  ensureDir,
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
  const { config, employees, rooms, messages, service, dataDir } = services;
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
    config: config.get(),
    employees: employees.list(),
    rooms: rooms.list(),
    frameworks: await probeFrameworks(config),
  }));

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

  handle<{ name: string; memberIds?: string[] }, unknown>(
    "room:create",
    ({ name, memberIds }) => rooms.create({ name: name.trim(), memberIds: memberIds ?? [] }),
  );

  handle<{ id: string; patch: { name?: string; memberIds?: string[] } }, unknown>(
    "room:update",
    ({ id, patch }) => rooms.update(id, patch),
  );

  handle<{ id: string }, boolean>("room:remove", async ({ id }) => {
    await rooms.remove(id);
    return true;
  });

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
