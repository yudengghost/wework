import { posix, win32 } from "node:path";

import type { LauncherSettings } from "../config/schema";
import type { Framework } from "../domain/schema";
import { createSystemEnvironment, type LaunchEnvironment } from "./environment";

const frameworkCommands: Record<Framework, string[]> = {
  codex: ["codex"],
  "claude-code": ["claude"],
  builtin: [],
};

export type LaunchSource = "settings" | "path" | "known-location" | "wsl";

export interface LaunchSpec {
  framework: Framework;
  /** 真正要被 spawn 的可执行文件。 */
  command: string;
  /** 在适配器追加自己的参数之前、必须固定的前缀参数。 */
  baseArgs: string[];
  source: LaunchSource;
  /** 解析出来的原始路径，用于 UI 显示与「重新探测」。 */
  resolvedPath: string;
  /** 该解析结果的使用注意事项。 */
  note?: string;
}

export type LauncherResolution =
  | ({ status: "found" } & LaunchSpec)
  | { status: "not-found"; framework: Framework; searched: string[] };

function toolsFor(platform: NodeJS.Platform) {
  return platform === "win32" ? win32 : posix;
}

function joinPath(platform: NodeJS.Platform, ...parts: string[]): string {
  return toolsFor(platform).join(...parts);
}

/**
 * 候选打分：.exe 最高，避免经过 cmd.exe 解释器。
 * Windows 上无扩展名的是 bash shim，在当前环境无法直接使用，记 0 分。
 */
export function scoreCandidate(candidate: string, platform: NodeJS.Platform): number {
  const extension = toolsFor(platform).extname(candidate).toLowerCase();
  if (platform !== "win32") return extension === "" ? 3 : 0;
  if (extension === ".exe") return 3;
  if (extension === ".cmd" || extension === ".bat") return 2;
  if (extension === ".ps1") return 1;
  return 0;
}

export function buildLaunchSpec(
  framework: Framework,
  resolvedPath: string,
  source: LaunchSource,
  platform: NodeJS.Platform,
): LaunchSpec {
  const path = toolsFor(platform).normalize(resolvedPath);
  const extension = toolsFor(platform).extname(path).toLowerCase();

  if (platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    return {
      framework,
      resolvedPath: path,
      source,
      command: "cmd.exe",
      baseArgs: ["/d", "/s", "/c", "call", path],
      note:
        "npm 包装脚本必须经 cmd.exe 的 call 形态启动。cmd 会解析参数，含 %VAR% 或 ^ 的实参会被改写，" +
        "因此提示词等自由文本必须走 stdin，不要放进 argv。",
    };
  }

  if (platform === "win32" && extension === ".ps1") {
    return {
      framework,
      resolvedPath: path,
      source,
      command: "powershell.exe",
      baseArgs: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path],
    };
  }

  return { framework, resolvedPath: path, source, command: path, baseArgs: [] };
}

interface KnownLocations {
  plain: string[];
  versioned: { parent: string; child: string }[];
}

function collectKnownLocations(framework: Framework, env: LaunchEnvironment): KnownLocations {
  const names = frameworkCommands[framework];
  const { platform } = env;
  const roots = {
    appData: env.env.APPDATA,
    localAppData: env.env.LOCALAPPDATA,
    userProfile: env.env.USERPROFILE ?? env.env.HOME,
    programData: env.env.ProgramData,
  };
  const exeSuffix = platform === "win32" ? ".exe" : "";

  const plain: string[] = [];
  const add = (root: string | undefined, ...parts: string[]) => {
    if (root) plain.push(joinPath(platform, root, ...parts));
  };

  for (const name of names) {
    add(roots.appData, "npm", `${name}.cmd`);
    add(roots.appData, "npm", `${name}.ps1`);
    add(roots.appData, "npm", name);
    add(roots.userProfile, ".local", "bin", `${name}${exeSuffix}`);
    add(roots.localAppData, "Programs", `${name}${exeSuffix}`);
    add(roots.userProfile, "scoop", "shims", `${name}${exeSuffix}`);
    add(roots.programData, "chocolatey", "bin", `${name}${exeSuffix}`);
    add(roots.localAppData, "Microsoft", "WinGet", "Links", `${name}${exeSuffix}`);
  }

  const versioned: { parent: string; child: string }[] = [];
  if (framework === "codex" && roots.localAppData) {
    versioned.push({
      parent: joinPath(platform, roots.localAppData, "OpenAI", "Codex", "bin"),
      child: "codex.exe",
    });
  }

  return { plain, versioned };
}

/**
 * 解析某框架的启动方式。优先级：
 * 用户显式设置 → PATH → 已知安装位置 → 可选 WSL。
 */
export async function resolveLauncher(
  framework: Framework,
  settings: LauncherSettings,
  env: LaunchEnvironment = createSystemEnvironment(),
): Promise<LauncherResolution> {
  const names = frameworkCommands[framework];
  if (names.length === 0) {
    return { status: "not-found", framework, searched: [] };
  }

  if (settings.executablePath) {
    return {
      status: "found",
      ...buildLaunchSpec(framework, settings.executablePath, "settings", env.platform),
    };
  }

  const fromPath: { candidate: string; source: LaunchSource }[] = [];
  for (const name of names) {
    for (const candidate of await env.which(name)) {
      fromPath.push({ candidate, source: "path" });
    }
  }

  const { plain, versioned } = collectKnownLocations(framework, env);
  const fromKnown: { candidate: string; source: LaunchSource }[] = [];
  for (const candidate of plain) {
    if (await env.fileExists(candidate)) {
      fromKnown.push({ candidate, source: "known-location" });
    }
  }
  for (const entry of versioned) {
    for (const subdirectory of await env.listDirs(entry.parent)) {
      const candidate = joinPath(env.platform, entry.parent, subdirectory, entry.child);
      if (await env.fileExists(candidate)) {
        fromKnown.push({ candidate, source: "known-location" });
      }
    }
  }

  const best = [...fromPath, ...fromKnown]
    .map((entry) => ({ ...entry, score: scoreCandidate(entry.candidate, env.platform) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .at(0);

  if (best) {
    return {
      status: "found",
      ...buildLaunchSpec(framework, best.candidate, best.source, env.platform),
    };
  }

  if (settings.detectWsl && env.platform === "win32") {
    const linuxPath = await env.resolveWslCommand(names[0] as string);
    if (linuxPath) {
      return {
        status: "found",
        framework,
        source: "wsl",
        resolvedPath: linuxPath,
        command: "wsl.exe",
        baseArgs: ["-e", linuxPath],
      };
    }
  }

  return {
    status: "not-found",
    framework,
    searched: [...fromPath.map((entry) => entry.candidate), ...plain, ...fromKnown.map((entry) => entry.candidate)],
  };
}
