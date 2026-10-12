import { describe, expect, it } from "vitest";

import { createSystemEnvironment, resolveLauncher } from "../src/index";

/**
 * 真实机器上的探测冒烟测试：验证「不写死路径」确实成立。
 * 未安装对应 CLI 时不判定失败，但命中时必须给出结构完整的启动方式。
 */
describe("真实环境探测", () => {
  it("在本机解析 codex 与 claude-code", async () => {
    const env = createSystemEnvironment();
    const summary: string[] = [];

    for (const framework of ["codex", "claude-code"] as const) {
      const resolution = await resolveLauncher(
        framework,
        { executablePath: null, detectWsl: false },
        env,
      );

      if (resolution.status === "not-found") {
        summary.push(`${framework}: 未安装（搜索 ${resolution.searched.length} 个位置）`);
        continue;
      }

      expect(resolution.command).toBeTruthy();
      expect(resolution.resolvedPath).toBeTruthy();
      expect(resolution.baseArgs).toBeInstanceOf(Array);
      summary.push(
        `${framework}: source=${resolution.source} command=${resolution.command} path=${resolution.resolvedPath}`,
      );
    }

    console.log(`[real-launcher] ${summary.join(" | ")}`);
  });
});
