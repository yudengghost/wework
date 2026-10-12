import type { PermissionMode } from "../domain/schema";
import type { AgentRunRequest } from "./events";

/** 权限模式映射。Codex 用 --sandbox，取值经 `codex exec --help` 核实。 */
const codexSandboxByMode: Record<PermissionMode, string> = {
  "read-only": "read-only",
  "workspace-write": "workspace-write",
  full: "danger-full-access",
};

/** Claude 用 --permission-mode，取值经 `claude --help` 核实。 */
const claudePermissionByMode: Record<PermissionMode, string> = {
  "read-only": "manual",
  "workspace-write": "acceptEdits",
  full: "bypassPermissions",
};

/**
 * Codex 的参数。
 *
 * 提示词不走 argv，而是用结尾的 `-` 声明「从 stdin 读取」。实测确认 `-` 之后
 * stdout 保持纯 JSONL、stderr 为空。
 * 续接会话时不重复传 --sandbox：`codex exec resume --help` 里没有该选项，会话沿用原有策略。
 */
export function buildCodexArgs(request: AgentRunRequest): string[] {
  // --skip-git-repo-check 是必需项而非可选项：员工工作目录默认是
  // <userData>/workspaces/<employeeId>，不在 git 仓库内，不带该标志时 codex 会以
  // "Not inside a trusted directory" 直接失败退出（本机实测）。
  const shared = [
    "--json",
    "--skip-git-repo-check",
    ...(request.model ? ["-m", request.model] : []),
  ];
  return request.sessionRef
    ? ["exec", "resume", request.sessionRef, ...shared, "-"]
    : ["exec", "--sandbox", codexSandboxByMode[request.permissions.mode], ...shared, "-"];
}

/**
 * Claude Code 的参数。
 *
 * 无位置参数时不传提示词，`claude -p` 会从 stdin 读取（实测确认）。
 * `--verbose` 是 `--output-format stream-json` 在 print 模式下的必需项。
 */
export function buildClaudeArgs(request: AgentRunRequest): string[] {
  const { permissions } = request;
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    claudePermissionByMode[permissions.mode],
    ...(request.model ? ["--model", request.model] : []),
    ...(permissions.allowedTools.length > 0
      ? ["--allowedTools", permissions.allowedTools.join(",")]
      : []),
    ...(permissions.disallowedTools.length > 0
      ? ["--disallowedTools", permissions.disallowedTools.join(",")]
      : []),
    ...(request.sessionRef ? ["--resume", request.sessionRef] : []),
  ];
}
