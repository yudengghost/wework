import type { LauncherSettings } from "../config/schema";
import type { Employee } from "../domain/schema";
import { createSystemEnvironment, type LaunchEnvironment } from "../launcher/environment";
import { resolveLauncher } from "../launcher/resolveLauncher";
import { ProcessRunner } from "../process/processRunner";
import { createClaudeCodeAdapter, createCodexAdapter } from "./cliAgentAdapter";
import type { AgentAdapter } from "./events";

export type AdapterCreation =
  | { ok: true; adapter: AgentAdapter }
  | { ok: false; reason: string };

export interface CreateAdapterOptions {
  employee: Employee;
  launchers: {
    codex: LauncherSettings;
    "claude-code": LauncherSettings;
    builtin?: unknown;
  };
  env?: LaunchEnvironment;
  runner?: ProcessRunner;
}

/**
 * 按员工档案决定用哪个后端，并完成启动器解析。
 * 解析失败时返回原因而不是抛异常，便于 UI 直接展示「请安装或手动指定路径」。
 */
export async function createAdapterForEmployee(
  options: CreateAdapterOptions,
): Promise<AdapterCreation> {
  const { employee } = options;
  const env = options.env ?? createSystemEnvironment();
  const runner = options.runner ?? new ProcessRunner();

  if (employee.framework === "builtin") {
    return { ok: false, reason: "内置兜底员工尚未实现" };
  }

  const settings = options.launchers[employee.framework];
  const resolution = await resolveLauncher(employee.framework, settings, env);
  if (resolution.status !== "found") {
    return {
      ok: false,
      reason: `未找到 ${employee.framework} 可执行文件，请在设置里手动指定路径`,
    };
  }

  const adapter =
    employee.framework === "codex"
      ? createCodexAdapter(resolution, runner)
      : createClaudeCodeAdapter(resolution, runner);

  return { ok: true, adapter };
}
