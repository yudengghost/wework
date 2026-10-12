import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ProcessRunner } from "./processRunner";

const fixtureDir = resolve(import.meta.dirname, "..", "..", "test", "fixtures");
const fakeCli = resolve(fixtureDir, "fake-cli.mjs");
const shim = resolve(fixtureDir, "argv-shim.cmd");
const spacedShim = resolve(fixtureDir, "with space", "argv-shim.cmd");

const runner = new ProcessRunner();
const isWindows = process.platform === "win32";

function runNode(args: string[], options: Record<string, unknown> = {}) {
  return runner.run({ command: process.execPath, args: [fakeCli, ...args], ...options });
}

describe("ProcessRunner", () => {
  it("逐行回调 stdout", async () => {
    const lines: string[] = [];

    const result = await runNode(["--lines", "3"], {
      onStdoutLine: (line: string) => lines.push(line),
    });

    expect(result.exitCode).toBe(0);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2] ?? "{}")).toEqual({ type: "line", n: 3 });
  });

  it("把 stdin 投递给子进程", async () => {
    const result = await runNode(["--echo-stdin"], { stdin: "你好 stdin" });

    expect(JSON.parse(result.stdout.trim())).toEqual({ stdin: "你好 stdin" });
  });

  it("非零退出码被如实返回", async () => {
    const result = await runNode(["--exit", "3"]);

    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
  });

  it("捕获 stderr 并逐行回调", async () => {
    const lines: string[] = [];

    const result = await runNode(["--stderr", "boom"], {
      onStderrLine: (line: string) => lines.push(line),
    });

    expect(result.stderr).toContain("boom");
    expect(lines).toEqual(["boom"]);
  });

  it("超时会杀掉进程并如实标记", async () => {
    const startedAt = Date.now();

    const result = await runNode(["--sleep", "30000"], { timeoutMs: 400 });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(15000);
  });

  it("AbortSignal 能取消运行", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const result = await runNode(["--sleep", "30000"], { signal: controller.signal });

    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("命令不存在时以错误拒绝", async () => {
    await expect(
      runner.run({ command: "definitely-not-a-real-binary-xyz", args: [] }),
    ).rejects.toBeTruthy();
  });

  it.skipIf(!isWindows)(
    ".cmd 包装脚本经 cmd.exe 拉起时参数逐字节保真，且不发生注入",
    async () => {
      const tricky = ["--prompt", 'he said "hi" & echo pwned', "--flag=1", "带空格 的值"];
      const seen: string[] = [];

      const result = await runner.run({
        command: "cmd.exe",
        args: ["/d", "/s", "/c", "call", shim, "--dump-args", ...tricky],
        onStdoutLine: (line: string) => seen.push(line),
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(seen[0] ?? "[]")).toEqual(tricky);
      expect(result.stdout).not.toContain("pwned --flag");
    },
  );

  it.skipIf(!isWindows)("路径含空格时 .cmd 包装脚本仍可用", async () => {
    const seen: string[] = [];

    const result = await runner.run({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "call", spacedShim, "--dump-args", "a b", "c"],
      onStdoutLine: (line: string) => seen.push(line),
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(seen[0] ?? "[]")).toEqual(["a b", "c"]);
  });

  it.skipIf(!isWindows)("经 cmd.exe 传递时普通百分号与中文安全，环境变量写法不安全", async () => {
    const seen: string[] = [];

    const result = await runner.run({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "call", shim, "--dump-args", "把性能提升 30% 到 100%", "中文参数"],
      onStdoutLine: (line: string) => seen.push(line),
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(seen[0] ?? "[]")).toEqual(["把性能提升 30% 到 100%", "中文参数"]);
  });
});
