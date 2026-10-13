import type { RunStatus, RunStep, RunTrace } from "@wework/core";

// 运行轨迹的措辞与计时。
//
// 放在渲染层而不是 core：core 只负责记录「发生了什么」（工具名、参数、结果），
// 怎么用中文说给人听是界面的事。这里全是纯函数，便于单独测。

/** 静默多久提示「可能卡住了」。只是提示，不打断运行。 */
export const QUIET_HINT_MS = 25_000;

const TOOL_LABELS: Record<string, string> = {
  // codex
  command_execution: "执行命令",
  file_change: "改动文件",
  web_search: "联网搜索",
  mcp_tool_call: "调用 MCP 工具",
  todo_list: "更新任务清单",
  // claude-code
  Bash: "执行命令",
  Read: "读取文件",
  Write: "写入文件",
  Edit: "修改文件",
  MultiEdit: "修改文件",
  Glob: "查找文件",
  Grep: "搜索内容",
  WebSearch: "联网搜索",
  WebFetch: "抓取网页",
  Task: "派生子任务",
  TodoWrite: "更新任务清单",
};

// 结果行的主语，让「返回成功」这句话读得通。
const RESULT_NOUNS: Record<string, string> = {
  command_execution: "命令",
  Bash: "命令",
  file_change: "文件改动",
  Write: "文件写入",
  Edit: "文件修改",
  web_search: "联网搜索",
  WebSearch: "联网搜索",
  WebFetch: "网页抓取",
};

export function isActive(trace: RunTrace): boolean {
  return trace.status === "queued" || trace.status === "running";
}

export function statusLabel(status: RunStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "工作中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "skipped":
      return "未开始";
    case "stopped":
      return "已停止";
  }
}

export function toolLabel(name: string | undefined): string {
  if (name === undefined || name === "") return "调用工具";
  return TOOL_LABELS[name] ?? `调用 ${name}`;
}

/**
 * 绝对路径的长token。实测 codex 的输出里有两种：Windows 盘符路径（
 * `C:\Users\…\codex-runtimes\…\pwsh.exe`）与 POSIX 路径。
 */
const ABSOLUTE_PATH = /[A-Za-z]:\\[^\s"'`、；，]*|\/[^\s"']*(?:\/[^\s"']*)+/g;

/** 超长的绝对路径只留最后两段：够认出是什么，不至于把一行撑成三行。 */
function collapseLongPaths(text: string, maxToken = 44): string {
  return text.replace(ABSOLUTE_PATH, (match) => {
    if (match.length <= maxToken) return match;
    const parts = match.split(/[\\/]+/).filter((part) => part !== "");
    return `…\\${parts.slice(-2).join("\\")}`;
  });
}

/**
 * 把工具详情整理成能读的一行。
 *
 * 员工自己的工作目录在整个详情里换成相对路径——用户关心的是「它改了 notes\a.md」，
 * 而不是那个又长又一模一样的前缀。剩下的超长路径折叠成 `…\目录\文件`。
 */
export function tidyDetail(detail: string, workspaceDir?: string): string {
  let text = detail;
  if (workspaceDir !== undefined && workspaceDir !== "") {
    for (const root of [workspaceDir, workspaceDir.replace(/\\/g, "/")]) {
      text = text.split(`${root}\\`).join("").split(`${root}/`).join("");
      text = text.split(root).join("");
    }
  }
  return collapseLongPaths(text).replace(/^[\\/]+/, "");
}

export interface StepContext {
  /** 该员工的工作目录：详情里的这个前缀会被抹掉，换成相对路径。 */
  workspaceDir?: string;
}

/** 单步的人话描述。 */
export function describeStep(step: RunStep, context: StepContext = {}): string {
  switch (step.kind) {
    case "queued":
      return "已受理，排队等待";
    case "started":
      return "开始执行";
    case "tool": {
      const detail = step.detail === undefined ? "" : tidyDetail(step.detail, context.workspaceDir);
      return detail === "" ? toolLabel(step.tool) : `${toolLabel(step.tool)}：${detail}`;
    }
    case "result": {
      const noun = RESULT_NOUNS[step.tool ?? ""] ?? "工具";
      const head = step.ok === false ? `${noun}返回失败` : `${noun}返回成功`;
      const detail = step.detail === undefined ? "" : tidyDetail(step.detail, context.workspaceDir);
      return detail === "" ? head : `${head}：${detail}`;
    }
    case "note":
      return step.text ?? "";
  }
}

/** 步骤列表里最新那一步的时间，用来算「静默了多久」。 */
export function lastStepAt(trace: RunTrace): string {
  return trace.steps.at(-1)?.at ?? trace.startedAt ?? trace.queuedAt;
}

export function elapsedMs(trace: RunTrace, nowMs: number): number {
  const started = Date.parse(trace.startedAt ?? trace.queuedAt);
  const ended = Date.parse(trace.finishedAt ?? new Date(nowMs).toISOString());
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
}

export function quietMs(trace: RunTrace, nowMs: number): number {
  const at = Date.parse(lastStepAt(trace));
  return Number.isFinite(at) ? Math.max(0, nowMs - at) : 0;
}

// 「它现在在干什么」——界面上最值钱的一句话。
//
// 排队时说排队（还告诉前面有几个），开跑之后说最近的动作；上一步是工具返回
// 而不见下一步时，说明模型正在消化结果。任何一种情况都不会是空白。
export function currentAction(trace: RunTrace, context: StepContext = {}): string {
  if (trace.status === "queued") {
    const ahead = (trace.position ?? 1) - 1;
    return ahead <= 0 ? "排队中，马上轮到" : `排队中，前面还有 ${ahead} 个任务`;
  }
  if (trace.status !== "running") {
    return trace.reason ?? trace.error ?? statusLabel(trace.status);
  }

  const last = trace.steps.at(-1);
  if (last === undefined || last.kind === "started") return "已启动，正在生成…";
  if (last.kind === "queued") return "正在准备提示词…";
  if (last.kind === "result") return "上一步已返回，继续处理中…";
  return describeStep(last, context);
}

/** 秒表：运行中显示已用时间，结束的显示总用时。 */
export function clockOf(trace: RunTrace, nowMs: number): string {
  return formatClock(elapsedMs(trace, nowMs));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** 触发这次运行的那条消息，用来在面板里认出「这是哪条任务」。 */
export function triggerLine(trace: RunTrace): string {
  const flat = trace.trigger.replace(/\s+/g, " ").trim();
  return flat.length <= 60 ? flat : `${flat.slice(0, 60)}…`;
}

// 轨迹面板只给最近几步：它的用途是回答「在不在干活、干到哪了」，
// 不是把 CLI 的原始日志摊开给人读。
export function recentSteps(trace: RunTrace, limit = 8): RunStep[] {
  return trace.steps.slice(Math.max(0, trace.steps.length - limit));
}
