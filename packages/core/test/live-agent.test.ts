import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCodexAdapter,
  createSystemEnvironment,
  resolveLauncher,
  type AgentEvent,
} from "../src/index";

/**
 * 可选的真机联调测试：会真的调用本机已安装的 Codex CLI（消耗少量额度）。
 * 默认跳过，用 BUDDY_LIVE_TESTS=1 显式开启：
 *   $env:BUDDY_LIVE_TESTS=1; npm run test -w @buddy/core -- live-agent
 */
const liveEnabled = process.env.BUDDY_LIVE_TESTS === "1";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "buddy-live-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("真实 Codex CLI 联调", () => {
  it("从探测到事件解析的完整链路可用", async () => {
    const resolution = await resolveLauncher(
      "codex",
      { executablePath: null, detectWsl: false },
      createSystemEnvironment(),
    );
    if (resolution.status !== "found") {
      throw new Error("本机未找到 codex，无法进行联调");
    }

    const adapter = createCodexAdapter(resolution);
    const events: AgentEvent[] = [];

    const result = await adapter.run(
      {
        prompt: "Reply with exactly one word: pong",
        cwd: workDir,
        permissions: {
          mode: "read-only",
          allowedTools: [],
          disallowedTools: [],
          requireApprovalFor: [],
        },
        timeoutMs: 120000,
      },
      (event) => events.push(event),
    );

    console.log(`[live] command=${resolution.command} baseArgs=${JSON.stringify(resolution.baseArgs)}`);
    console.log(`[live] ok=${result.ok} exit=${result.exitCode} text=${JSON.stringify(result.text)}`);
    console.log(`[live] sessionRef=${result.sessionRef} usage=${JSON.stringify(result.usage)}`);
    console.log(`[live] stderr=${JSON.stringify(result.stderr.slice(0, 800))}`);
    console.log(`[live] eventTypes=${events.map((event) => event.type).join(",")}`);

    expect(result.ok).toBe(true);
    expect(result.text.toLowerCase()).toContain("pong");
    expect(result.sessionRef).toBeTruthy();
    expect(events.some((event) => event.type === "usage")).toBe(true);
  }, 180000);
});
