import { describe, expect, it } from "vitest";

import type { PermissionMode } from "../domain/schema";
import { buildClaudeArgs, buildCodexArgs } from "./buildArgs";
import type { AgentRunRequest } from "./events";

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    prompt: "把性能提升 30%，注意 ^ 和 %PATH% 这种写法",
    cwd: "C:/work/employee",
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

describe("buildCodexArgs", () => {
  it("新会话用 exec --sandbox 并以 - 声明从 stdin 读取", () => {
    expect(buildCodexArgs(request())).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--json",
      "--skip-git-repo-check",
      "-",
    ]);
  });

  it("始终带 --skip-git-repo-check：员工工作目录不是 git 仓库", () => {
    expect(buildCodexArgs(request())).toContain("--skip-git-repo-check");
    expect(buildCodexArgs(request({ sessionRef: "thread-1" }))).toContain(
      "--skip-git-repo-check",
    );
  });

  it("三种权限模式映射到对应的 sandbox 取值", () => {
    const modes: PermissionMode[] = ["read-only", "workspace-write", "full"];
    const sandboxes = modes.map((mode) => {
      const args = buildCodexArgs(
        request({
          permissions: {
            mode,
            network: false,
            allowedTools: [],
            disallowedTools: [],
            requireApprovalFor: [],
          },
        }),
      );
      return args[args.indexOf("--sandbox") + 1];
    });

    expect(sandboxes).toEqual(["read-only", "workspace-write", "danger-full-access"]);
  });

  it("允许联网时只加 sandbox_workspace_write.network_access，不动文件沙箱", () => {
    const online = buildCodexArgs(
      request({
        permissions: {
          mode: "workspace-write",
          network: true,
          allowedTools: [],
          disallowedTools: [],
          requireApprovalFor: [],
        },
      }),
    );

    expect(online).toContain("sandbox_workspace_write.network_access=true");
    expect(online).toContain("--sandbox");
    expect(online[online.indexOf("--sandbox") + 1]).toBe("workspace-write");
    // 没开联网时不该出现这个覆盖项
    expect(buildCodexArgs(request())).not.toContain(
      "sandbox_workspace_write.network_access=true",
    );
  });

  it("续接会话走 exec resume，且不重复传 --sandbox", () => {
    const args = buildCodexArgs(request({ sessionRef: "thread-1" }));

    expect(args).toEqual([
      "exec",
      "resume",
      "thread-1",
      "--json",
      "--skip-git-repo-check",
      "-",
    ]);
    expect(args).not.toContain("--sandbox");
  });

  it("model 透传", () => {
    expect(buildCodexArgs(request({ model: "gpt-5" }))).toContain("gpt-5");
  });

  it("argv 里绝不出现提示词文本", () => {
    const args = buildCodexArgs(request());

    expect(args.some((arg) => arg.includes("性能提升"))).toBe(false);
    expect(args.some((arg) => arg.includes("%PATH%"))).toBe(false);
  });
});

describe("buildClaudeArgs", () => {
  it("基础形态包含 stream-json、verbose 与权限模式", () => {
    expect(buildClaudeArgs(request())).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  it("三种权限模式映射到 Claude 的取值", () => {
    const modes: PermissionMode[] = ["read-only", "workspace-write", "full"];
    const mapped = modes.map((mode) => {
      const args = buildClaudeArgs(
        request({
          permissions: {
            mode,
            network: false,
            allowedTools: [],
            disallowedTools: [],
            requireApprovalFor: [],
          },
        }),
      );
      return args[args.indexOf("--permission-mode") + 1];
    });

    expect(mapped).toEqual(["manual", "acceptEdits", "bypassPermissions"]);
  });

  it("工具白名单与黑名单按逗号拼接", () => {
    const args = buildClaudeArgs(
      request({
        permissions: {
          mode: "workspace-write",
          network: false,
          allowedTools: ["Bash(git *)", "Edit"],
          disallowedTools: ["WebFetch"],
          requireApprovalFor: [],
        },
      }),
    );

    expect(args).toContain("--allowedTools");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Bash(git *),Edit");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("WebFetch");
  });

  it("续接会话追加 --resume", () => {
    expect(buildClaudeArgs(request({ sessionRef: "sess-1" }))).toContain("--resume");
    expect(buildClaudeArgs(request({ sessionRef: "sess-1" }))).toContain("sess-1");
  });

  it("argv 里绝不出现提示词文本", () => {
    const args = buildClaudeArgs(request());

    expect(args.some((arg) => arg.includes("性能提升"))).toBe(false);
  });
});
