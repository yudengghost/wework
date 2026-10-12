import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  ConfigStore,
  EmployeeStore,
  FileStore,
  MemoryStore,
  MessageLog,
  RoomService,
  RoomStore,
  createAdapterForEmployee,
  catalogSkills,
  createSystemSkillFileSystem,
  createSystemEnvironment,
  resolveLauncher,
  type AdapterCreation,
  type Employee,
  type Framework,
  type LauncherResolution,
} from "@buddy/core";
import { app } from "electron";

export interface AppServices {
  /** 配置与数据的默认落点，固定不变。 */
  bootstrapDir: string;
  /** 实际使用的数据根目录，可在设置里改到别处。 */
  dataDir: string;
  store: FileStore;
  config: ConfigStore;
  employees: EmployeeStore;
  rooms: RoomStore;
  messages: MessageLog;
  memory: MemoryStore;
  service: RoomService;
}

export async function createServices(): Promise<AppServices> {
  const bootstrapDir = join(app.getPath("userData"), "data");
  const store = new FileStore();
  await store.ensureDir(bootstrapDir);

  // 配置本身永远留在默认位置：否则把数据目录改坏就再也找不到配置了。
  const config = new ConfigStore(store, join(bootstrapDir, "config.json"));
  await config.load();

  // 优先级：环境变量（便于测试与绿色版）> 设置里指定 > 默认位置。
  const dataDir = process.env.BUDDY_DATA_DIR ?? config.get().storage.dataDir ?? bootstrapDir;
  await store.ensureDir(dataDir);

  const employees = new EmployeeStore(store, join(dataDir, "employees.json"));
  await employees.load();

  const rooms = new RoomStore(store, join(dataDir, "rooms.json"));
  await rooms.load();

  const messages = new MessageLog(store, dataDir);
  const memory = new MemoryStore(store, dataDir);
  const skillFs = createSystemSkillFileSystem();

  const service = new RoomService({
    config,
    employees,
    rooms,
    messages,
    memory,
    skillsFor: async (employee: Employee) => {
      const settings = config.get().skills;
      const catalog = await catalogSkills({
        dataDir,
        extraRoots: settings.extraRoots,
        includeFrameworkSkills: settings.includeFrameworkSkills,
        env: process.env,
        fs: skillFs,
      });
      return catalog.filter((skill) => employee.skills.includes(skill.id));
    },
    createAdapter: (employee: Employee): Promise<AdapterCreation> =>
      createAdapterForEmployee({ employee, launchers: config.get().launchers }),
  });

  return {
    bootstrapDir,
    dataDir,
    store,
    config,
    employees,
    rooms,
    messages,
    memory,
    service,
  };
}

/** 列出当前可见的全部技能，供员工编辑界面勾选。 */
export async function listSkills(services: AppServices) {
  const settings = services.config.get().skills;
  return catalogSkills({
    dataDir: services.dataDir,
    extraRoots: settings.extraRoots,
    includeFrameworkSkills: settings.includeFrameworkSkills,
    env: process.env,
    fs: createSystemSkillFileSystem(),
  });
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
