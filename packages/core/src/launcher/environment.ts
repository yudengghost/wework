import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 探测所需的环境访问面。抽成接口是为了让探测逻辑可以在无副作用的情况下被测试。 */
export interface LaunchEnvironment {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** 等价于 where.exe / which -a：返回候选绝对路径，保持系统返回顺序。 */
  which(command: string): Promise<string[]>;
  /** 列出目录下的子目录名，用于版本化安装目录（如 Codex 的 bin/<hash>）。 */
  listDirs(dir: string): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  /** 在 WSL 里定位命令，返回 Linux 侧绝对路径；不可用返回 null。 */
  resolveWslCommand(command: string): Promise<string | null>;
}

/** 只允许把形如 `codex` 的名字拼进 bash 命令，避免探测阶段的注入。 */
const safeCommandName = /^[A-Za-z0-9._-]+$/;

export function createSystemEnvironment(): LaunchEnvironment {
  return {
    platform: process.platform,
    env: process.env,

    async which(command: string): Promise<string[]> {
      const finder = process.platform === "win32" ? "where.exe" : "which";
      const args = process.platform === "win32" ? [command] : ["-a", command];
      try {
        const { stdout } = await execFileAsync(finder, args, { windowsHide: true });
        return stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== "");
      } catch {
        return [];
      }
    },

    async listDirs(dir: string): Promise<string[]> {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        return [];
      }
    },

    async fileExists(path: string): Promise<boolean> {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },

    async resolveWslCommand(command: string): Promise<string | null> {
      if (process.platform !== "win32" || !safeCommandName.test(command)) return null;
      try {
        const { stdout } = await execFileAsync(
          "wsl.exe",
          ["-e", "bash", "-lc", `command -v ${command}`],
          { windowsHide: true, timeout: 10000 },
        );
        const candidate = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .pop();
        return candidate && candidate.startsWith("/") ? candidate : null;
      } catch {
        return null;
      }
    },
  };
}
