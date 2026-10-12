import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  ConfigStore,
  EmployeeStore,
  FileStore,
  MessageLog,
  RoomService,
  RoomStore,
  createAdapterForEmployee,
  createSystemEnvironment,
  resolveLauncher,
  type AdapterCreation,
  type Employee,
  type Framework,
  type LauncherResolution,
} from "@buddy/core";
import { app } from "electron";

export interface AppServices {
  dataDir: string;
  store: FileStore;
  config: ConfigStore;
  employees: EmployeeStore;
  rooms: RoomStore;
  messages: MessageLog;
  service: RoomService;
}

export async function createServices(): Promise<AppServices> {
  const dataDir = join(app.getPath("userData"), "data");
  const store = new FileStore();
  await store.ensureDir(dataDir);

  const config = new ConfigStore(store, join(dataDir, "config.json"));
  await config.load();

  const employees = new EmployeeStore(store, join(dataDir, "employees.json"));
  await employees.load();

  const rooms = new RoomStore(store, join(dataDir, "rooms.json"));
  await rooms.load();

  const messages = new MessageLog(store, dataDir);

  const service = new RoomService({
    config,
    employees,
    rooms,
    messages,
    createAdapter: (employee: Employee): Promise<AdapterCreation> =>
      createAdapterForEmployee({ employee, launchers: config.get().launchers }),
  });

  return { dataDir, store, config, employees, rooms, messages, service };
}

/** 探测两个 CLI 框架当前是否可用，供 UI 显示「已就绪 / 未找到」。 */
export async function probeFrameworks(config: ConfigStore): Promise<
  Record<string, { status: LauncherResolution["status"]; detail: string }>
> {
  const frameworks: Extract<Framework, "codex" | "claude-code">[] = ["codex", "claude-code"];
  const env = createSystemEnvironment();
  const result: Record<string, { status: LauncherResolution["status"]; detail: string }> = {};

  for (const framework of frameworks) {
    const resolution = await resolveLauncher(framework, config.get().launchers[framework], env);
    result[framework] =
      resolution.status === "found"
        ? { status: "found", detail: resolution.resolvedPath }
        : { status: "not-found", detail: "未找到，可在设置里手动指定路径" };
  }

  return result;
}

/** 员工工作目录的默认落点；同名时自动加序号避免互相踩。 */
export function defaultWorkspaceDir(
  dataDir: string,
  displayName: string,
  takenDirs: string[],
): string {
  const slug = displayName.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "employee";
  let candidate = join(dataDir, "workspaces", slug);
  let counter = 2;
  while (takenDirs.includes(candidate)) {
    candidate = join(dataDir, "workspaces", `${slug}-${counter}`);
    counter += 1;
  }
  return candidate;
}

export async function ensureDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}
