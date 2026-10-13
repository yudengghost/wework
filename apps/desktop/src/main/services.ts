import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  ConfigStore,
  AttachmentStore,
  CursorStore,
  EmployeeStore,
  FileStore,
  MemoryStore,
  MessageLog,
  loadPromptPack,
  createRosterFileWriter,
  RoomService,
  RoomStore,
  createAdapterForEmployee,
  catalogSkills,
  createSystemSkillFileSystem,
  createSystemEnvironment,
  resolveLauncher,
  catalogSkills as scanSkills,
  type AdapterCreation,
  type Employee,
  type Framework,
  type LauncherResolution,
  type PermissionMode,
  type SkillInfo,
  type SkillsSettings,
} from "@buddy/core";
import { app, safeStorage } from "electron";

import { createSecretStore, type SecretStore } from "./secrets";
import { remapEmployeePaths } from "./migrate";

/** 改名之前的应用名：老版本的数据目录就在它底下。 */
const legacyAppName = "Buddy";

/**
 * 改名迁移：老版本把配置与数据放在 %APPDATA%\Buddy\data。
 *
 * 新位置还是空的、而老位置有配置时，整份拷过来——改个软件名不该让用户的员工、房间
 * 与记忆凭空消失。用拷贝而不是搬走：老目录原样留着，用户确认无误后自己删。
 */
async function migrateLegacyDataDir(targetDir: string): Promise<boolean> {
  if (await exists(join(targetDir, "config.json"))) return false;
  const legacyDir = join(app.getPath("appData"), legacyAppName, "data");
  if (!(await exists(join(legacyDir, "config.json")))) return false;
  // force: false —— 目标已有的文件一律不覆盖，只补缺。
  await cp(legacyDir, targetDir, { recursive: true, force: false });
  await remapCopiedEmployees(join(targetDir, "employees.json"), legacyDir, targetDir);
  return true;
}

/**
 * 拷完之后把档案里的绝对路径改到新目录。
 * 读不动或格式不对就算了：迁移是尽力而为，不能因为一份档案坏了就让应用起不来。
 */
async function remapCopiedEmployees(
  employeesPath: string,
  legacyDir: string,
  targetDir: string,
): Promise<void> {
  try {
    const employees = JSON.parse(await readFile(employeesPath, "utf8")) as unknown;
    if (!Array.isArray(employees)) return;
    if (remapEmployeePaths(employees, legacyDir, targetDir) === 0) return;
    await writeFile(employeesPath, `${JSON.stringify(employees, null, 2)}\n`, "utf8");
  } catch {
    // 交给用户：档案有问题时应用里本来就有一条「读不到就报出来」的路径。
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface AppServices {
  /** 配置与数据的默认落点，固定不变。 */
  bootstrapDir: string;
  /** 实际使用的数据根目录，可在设置里改到别处。 */
  dataDir: string;
  /** 可编辑的提示词文件路径（首次启动会自动写出默认值）。 */
  promptsPath: string;
  store: FileStore;
  secrets: SecretStore;
  config: ConfigStore;
  employees: EmployeeStore;
  rooms: RoomStore;
  messages: MessageLog;
  memory: MemoryStore;
  service: RoomService;
  /** 从老名字（Buddy）的数据目录迁过来时记下来源，便于在日志里说明数据去了哪。 */
  migratedFrom?: string;
}

export async function createServices(): Promise<AppServices> {
  // 配置固定放在这里；BUDDY_CONFIG_DIR 便于测试与绿色版把整份配置挪走。
  const bootstrapDir = process.env.BUDDY_CONFIG_DIR ?? join(app.getPath("userData"), "data");
  const store = new FileStore();
  // 显式指定过目录（绿色版 / 测试）就说明用户心里有数，不去动他的数据。
  let migratedFrom: string | undefined;
  if (process.env.BUDDY_CONFIG_DIR === undefined) {
    const migrated = await migrateLegacyDataDir(bootstrapDir).catch(() => false);
    if (migrated) migratedFrom = join(app.getPath("appData"), legacyAppName, "data");
  }
  await store.ensureDir(bootstrapDir);

  // 配置本身永远留在默认位置：否则把数据目录改坏就再也找不到配置了。
  const config = new ConfigStore(store, join(bootstrapDir, "config.json"));
  await config.load();

  // 密钥与配置分开放：config.json 是用户会手改、可能被拷来拷去的文件，
  // 明文密钥不该混在里面。safeStorage 在 Windows 上就是 DPAPI（当前用户绑定）。
  const secrets = createSecretStore(store, join(bootstrapDir, "secrets.json"), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, "base64")),
  });

  // 迁移：老版本把明文 Key 写在 config.json 里。搬进安全存储，并把明文从配置里抹掉。
  const legacyApiKey = config.get().builtinAgent.apiKey;
  if (legacyApiKey !== null && secrets.canStoreSecrets()) {
    await secrets.setBuiltinApiKey(legacyApiKey);
    await config.update({ builtinAgent: { apiKey: null } });
  }

  // 优先级：环境变量（便于测试与绿色版）> 设置里指定 > 默认位置。
  const dataDir = process.env.BUDDY_DATA_DIR ?? config.get().storage.dataDir ?? bootstrapDir;
  await store.ensureDir(dataDir);

  const employees = new EmployeeStore(store, join(dataDir, "employees.json"));
  await employees.load();

  const rooms = new RoomStore(store, join(dataDir, "rooms.json"));
  await rooms.load();

  const messages = new MessageLog(store, dataDir);
  const memory = new MemoryStore(store, dataDir);
  const cursors = new CursorStore(store, join(dataDir, "cursors.json"));
  await cursors.load();
  const promptsPath = join(dataDir, "prompts.json");
  const { pack: prompts } = await loadPromptPack(store, promptsPath);
  const attachments = new AttachmentStore({ dataDir });
  const service = new RoomService({
    config,
    employees,
    rooms,
    messages,
    memory,
    cursors,
    prompts,
    attachments,
    // 员工申请招人时也走这个入口，与界面创建行为完全一致。
    createEmployee: (draft) => createEmployeeFromDraft({ dataDir, employees }, draft),
    rosterFile: createRosterFileWriter(),
    skillsFor: async (employee: Employee) => {
      const catalog = await loadSkillCatalog(dataDir, config.get().skills);
      return catalog.filter((skill) => employee.skills.includes(skill.id));
    },
    // 招人时 HR 要看到全量技能目录才能挑技能，也要用它校验申请里的技能 id。
    skillCatalog: () => loadSkillCatalog(dataDir, config.get().skills),
    createAdapter: (employee: Employee): Promise<AdapterCreation> =>
      createAdapterForEmployee({ employee, launchers: config.get().launchers }),
  });

  return {
    bootstrapDir,
    dataDir,
    migratedFrom,
    promptsPath,
    store,
    secrets,
    config,
    employees,
    rooms,
    messages,
    memory,
    service,
  };
}

/**
 * 技能目录缓存。
 *
 * 扫描一次要 readdir + 逐技能 readFile（32 个技能就是 32 次读盘），而每次运行都会用到，
 * 所以按「数据目录 + 设置」做键缓存，设置变了才重扫。
 */
let skillCache: { key: string; value: SkillInfo[] } | null = null;

export async function loadSkillCatalog(
  dataDir: string,
  settings: SkillsSettings,
): Promise<SkillInfo[]> {
  const key = [
    dataDir,
    settings.includeFrameworkSkills ? "1" : "0",
    ...settings.extraRoots,
  ].join("|");
  if (skillCache?.key === key) return skillCache.value;

  const value = await scanSkills({
    dataDir,
    extraRoots: settings.extraRoots,
    includeFrameworkSkills: settings.includeFrameworkSkills,
    env: process.env,
    fs: createSystemSkillFileSystem(),
  });
  skillCache = { key, value };
  return value;
}

/** 列出当前可见的全部技能，供员工编辑界面勾选。 */
export async function listSkills(services: AppServices) {
  return loadSkillCatalog(services.dataDir, services.config.get().skills);
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

export interface EmployeeDraftInput {
  displayName: string;
  framework: Framework;
  model?: string;
  systemPrompt?: string;
  skills?: string[];
  permissionMode?: PermissionMode;
  canHire?: boolean;
  workspaceDir?: string;
  stateDir?: string;
}

/**
 * 创建员工的唯一入口：界面创建与「员工申请招人」都走这里，避免两条路行为分叉。
 * 不抛异常，失败以 reason 返回，便于审批流程把原因写回房间。
 */
export async function createEmployeeFromDraft(
  deps: { dataDir: string; employees: EmployeeStore },
  draft: EmployeeDraftInput,
): Promise<{ ok: true; employee: Employee } | { ok: false; reason: string }> {
  try {
    const displayName = draft.displayName.trim();
    const takenDirs = deps.employees.list().map((item) => item.workspaceDir);
    const workspaceDir =
      draft.workspaceDir?.trim() || defaultWorkspaceDir(deps.dataDir, displayName, takenDirs);
    const stateDir =
      draft.stateDir?.trim() || join(deps.dataDir, "state", basename(workspaceDir));

    await ensureDir(workspaceDir);
    await ensureDir(stateDir);

    const employee = await deps.employees.create({
      displayName,
      framework: draft.framework,
      workspaceDir,
      stateDir,
      model: draft.model?.trim() ? draft.model.trim() : undefined,
      systemPrompt: draft.systemPrompt?.trim() ? draft.systemPrompt : undefined,
      skills: draft.skills ?? [],
      canHire: draft.canHire ?? false,
      permissions: {
        mode: draft.permissionMode ?? "workspace-write",
        allowedTools: [],
        disallowedTools: [],
        requireApprovalFor: [],
      },
    });
    return { ok: true, employee };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
