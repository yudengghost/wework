import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LaunchSpec } from "../launcher/resolveLauncher";
import { createClaudeCodeAdapter, createCodexAdapter } from "./cliAgentAdapter";
import type { AgentEvent, AgentRunRequest } from "./events";

const fixtureDir = resolve(import.meta.dirname, "..", "..", "test", "fixtures");
const fakeCli = resolve(fixtureDir, "fake-cli.mjs");

let workDir: string;
let capturePath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "wework-adapter-"));
  capturePath = join(workDir, "capture.json");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** 用假 CLI 冒充真实后端：它记录 argv 与 stdin，并吐出真实抓取到的事件流。 */
function specFor(fixtureName: string, framework: "codex" | "claude-code"): LaunchSpec {
  return {
    framework,
    command: process.execPath,
    baseArgs: [
      fakeCli,
      "--capture-to",
      capturePath,
      "--emit-fixture",
      resolve(fixtureDir, fixtureName),
    ],
    source: "settings",
    resolvedPath: fakeCli,
  };
}

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    prompt: "把性能提升 30%，注意 %PATH% 与 ^ 这种写法",
    systemPrompt: "你是资深评审员，只指出真实缺陷。",
    cwd: workDir,
    permissions: {
      mode: "workspace-write",
      network: false,
      allowedTools: [],
      disallowedTools: [],
      requireApprovalFor: [],
    },
    ...overrides,
  };
}

interface Capture {
  argv: string[];
  stdin: string;
}

async function readCapture(): Promise<Capture> {
  return JSON.parse(await readFile(capturePath, "utf8")) as Capture;
}

describe("CliAgentAdapter 与 Codex", () => {
  it("提示词只走 stdin，argv 里没有任何自由文本", async () => {
    const adapter = createCodexAdapter(specFor("codex-stream.jsonl", "codex"));

    const result = await adapter.run(request());
    const capture = await readCapture();

    expect(result.ok).toBe(true);
    expect(capture.argv).toEqual([
      "--capture-to",
      capturePath,
      "--emit-fixture",
      resolve(fixtureDir, "codex-stream.jsonl"),
      "exec",
      "--sandbox",
      "workspace-write",
      "--json",
      "--skip-git-repo-check",
      "-",
    ]);
    expect(capture.argv.some((arg) => arg.includes("性能提升"))).toBe(false);
    expect(capture.argv.some((arg) => arg.includes("%PATH%"))).toBe(false);
    expect(capture.stdin).toBe(
      "<employee_role>\n你是资深评审员，只指出真实缺陷。\n</employee_role>\n\n把性能提升 30%，注意 %PATH% 与 ^ 这种写法\n",
    );
  });

  it("把事件流汇总成文本、会话 id 与用量", async () => {
    const adapter = createCodexAdapter(specFor("codex-stream.jsonl", "codex"));
    const events: AgentEvent[] = [];

    const result = await adapter.run(request(), (event) => events.push(event));

    expect(result.text).toBe(
      "I'll list the files in the current directory.Files: readme.md and src.",
    );
    expect(result.sessionRef).toBe("01a12f64-0406-7050-ada9-2a2e3ff67f87");
    expect(result.usage).toEqual({ inputTokens: 76273, outputTokens: 174, costUsd: undefined });
    expect(events.map((event) => event.type)).toEqual([
      "session",
      "text",
      "tool-call",
      "tool-result",
      "text",
      "usage",
    ]);
  });

  it("续接会话时改用 exec resume 并带回 sessionRef", async () => {
    const adapter = createCodexAdapter(specFor("codex-stream.jsonl", "codex"));

    await adapter.run(request({ sessionRef: "thread-42" }));
    const capture = await readCapture();

    expect(capture.argv.slice(-5)).toEqual([
      "resume",
      "thread-42",
      "--json",
      "--skip-git-repo-check",
      "-",
    ]);
    expect(capture.argv).not.toContain("--sandbox");
  });

  it("非零退出码使 ok 为 false，并保留 stderr", async () => {
    const spec = specFor("codex-stream.jsonl", "codex");
    spec.baseArgs.splice(1, 0, "--stderr", "boom", "--exit", "3");
    const adapter = createCodexAdapter(spec);

    const result = await adapter.run(request());

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("boom");
  });
});

describe("CliAgentAdapter 与 Claude Code", () => {
  it("权限模式进 argv，提示词进 stdin", async () => {
    const adapter = createClaudeCodeAdapter(specFor("claude-stream.jsonl", "claude-code"));

    const result = await adapter.run(request());
    const capture = await readCapture();

    expect(result.ok).toBe(true);
    expect(capture.argv.slice(-6)).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
    ]);
    expect(capture.argv.some((arg) => arg.includes("性能提升"))).toBe(false);
    expect(capture.stdin).toContain("你是资深评审员");
  });

  it("汇总 Claude 的文本、会话 id 与成本", async () => {
    const adapter = createClaudeCodeAdapter(specFor("claude-stream.jsonl", "claude-code"));

    const result = await adapter.run(request());

    expect(result.text).toBe("Hi");
    expect(result.sessionRef).toBe("1fd3cf9a-ede3-4b27-b21e-41f3ec79a648");
    expect(result.usage?.costUsd).toBeCloseTo(0.099485, 6);
  });

  it("续接会话时追加 --resume", async () => {
    const adapter = createClaudeCodeAdapter(specFor("claude-stream.jsonl", "claude-code"));

    await adapter.run(request({ sessionRef: "sess-7" }));
    const capture = await readCapture();

    expect(capture.argv).toContain("--resume");
    expect(capture.argv).toContain("sess-7");
  });
});
