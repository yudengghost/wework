import { win32 } from "node:path";

import { describe, expect, it } from "vitest";

import type { LaunchEnvironment } from "./environment";
import { resolveLauncher } from "./resolveLauncher";

const win = (...parts: string[]) => win32.join(...parts);

const baseEnv: LaunchEnvironment = {
  platform: "win32",
  env: {
    APPDATA: "C:/Users/u/AppData/Roaming",
    LOCALAPPDATA: "C:/Users/u/AppData/Local",
    USERPROFILE: "C:/Users/u",
    ProgramData: "C:/ProgramData",
  },
  which: async () => [],
  listDirs: async () => [],
  fileExists: async () => false,
  resolveWslCommand: async () => null,
};

function makeEnv(overrides: Partial<LaunchEnvironment>): LaunchEnvironment {
  return { ...baseEnv, ...overrides };
}

const noSettings = { executablePath: null, detectWsl: false };

describe("resolveLauncher", () => {
  it("内置兜底员工不需要启动器", async () => {
    const resolution = await resolveLauncher("builtin", noSettings, makeEnv({}));

    expect(resolution).toEqual({ status: "not-found", framework: "builtin", searched: [] });
  });

  it("设置里显式指定的路径优先级最高", async () => {
    const resolution = await resolveLauncher(
      "codex",
      { executablePath: "D:/tools/codex.exe", detectWsl: false },
      makeEnv({ which: async () => ["C:/other/codex.exe"] }),
    );

    expect(resolution).toMatchObject({
      status: "found",
      source: "settings",
      command: "D:\\tools\\codex.exe",
      baseArgs: [],
    });
  });

  it("PATH 里同时存在 .cmd 与 .exe 时优先 .exe（不经过 cmd 解释器）", async () => {
    const resolution = await resolveLauncher(
      "codex",
      noSettings,
      makeEnv({
        which: async () => [
          win("C:/Users/u/AppData/Roaming", "npm", "codex.cmd"),
          win("C:/Users/u/AppData/Local", "OpenAI", "Codex", "bin", "abc", "codex.exe"),
        ],
      }),
    );

    if (resolution.status !== "found") throw new Error("期望找到启动器");
    expect(resolution.source).toBe("path");
    expect(resolution.command).toBe(
      win("C:/Users/u/AppData/Local", "OpenAI", "Codex", "bin", "abc", "codex.exe"),
    );
    expect(resolution.baseArgs).toEqual([]);
  });

  it("只有 .cmd 时走 cmd.exe 的 call 形态并给出参数限制说明", async () => {
    const shim = win("C:/Users/u/AppData/Roaming", "npm", "codex.cmd");

    const resolution = await resolveLauncher(
      "codex",
      noSettings,
      makeEnv({ which: async () => [shim] }),
    );

    expect(resolution).toMatchObject({
      status: "found",
      command: "cmd.exe",
      baseArgs: ["/d", "/s", "/c", "call", shim],
      source: "path",
    });
    if (resolution.status !== "found") throw new Error("期望找到启动器");
    expect(resolution.note).toContain("stdin");
  });

  it(".ps1 走 powershell 且不经过 cmd", async () => {
    const ps1 = win("C:/Users/u/AppData/Roaming", "npm", "codex.ps1");

    const resolution = await resolveLauncher(
      "codex",
      noSettings,
      makeEnv({ which: async () => [ps1] }),
    );

    expect(resolution).toMatchObject({
      status: "found",
      command: "powershell.exe",
      baseArgs: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1,
      ],
    });
  });

  it("Windows 上无扩展名的 bash shim 被判 0 分弃用", async () => {
    const resolution = await resolveLauncher(
      "codex",
      noSettings,
      makeEnv({ which: async () => [win("C:/Users/u/AppData/Roaming", "npm", "codex")] }),
    );

    expect(resolution.status).toBe("not-found");
  });

  it("从 Codex 的版本化安装目录探测到真实 exe", async () => {
    const binDir = win("C:/Users/u/AppData/Local", "OpenAI", "Codex", "bin");

    const resolution = await resolveLauncher(
      "codex",
      noSettings,
      makeEnv({
        listDirs: async (dir) => (dir === binDir ? ["abc123"] : []),
        fileExists: async (candidate) => candidate === win(binDir, "abc123", "codex.exe"),
      }),
    );

    if (resolution.status !== "found") throw new Error("期望找到启动器");
    expect(resolution.source).toBe("known-location");
    expect(resolution.command).toBe(win(binDir, "abc123", "codex.exe"));
  });

  it("全找不到时返回 not-found 并列出搜索过的路径", async () => {
    const resolution = await resolveLauncher("claude-code", noSettings, makeEnv({}));

    if (resolution.status !== "not-found") throw new Error("期望 not-found");
    expect(resolution.searched.length).toBeGreaterThan(0);
    expect(resolution.searched.some((entry) => entry.includes("claude.cmd"))).toBe(true);
  });

  it("开启 WSL 探测时用 wsl.exe -e 包裹 Linux 侧路径", async () => {
    const resolution = await resolveLauncher(
      "claude-code",
      { executablePath: null, detectWsl: true },
      makeEnv({ resolveWslCommand: async () => "/home/u/.local/bin/claude" }),
    );

    expect(resolution).toMatchObject({
      status: "found",
      source: "wsl",
      command: "wsl.exe",
      baseArgs: ["-e", "/home/u/.local/bin/claude"],
    });
  });

  it("非 Windows 平台上无扩展名的可执行文件得分最高", async () => {
    const resolution = await resolveLauncher(
      "claude-code",
      noSettings,
      makeEnv({ platform: "darwin", which: async () => ["/usr/local/bin/claude"] }),
    );

    expect(resolution).toMatchObject({
      status: "found",
      command: "/usr/local/bin/claude",
      baseArgs: [],
      source: "path",
    });
  });
});
