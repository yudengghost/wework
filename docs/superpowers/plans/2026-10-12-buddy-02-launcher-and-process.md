# Buddy 启动器解析与进程执行层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `@buddy/core` 的第二层：跨来源探测 Codex / Claude Code 可执行文件，以及一个安全、可流式、可超时、可取消的子进程执行器。

**Architecture:** 探测逻辑与环境访问解耦：`LaunchEnvironment` 是注入的接口（`which` / `listDirs` / `fileExists` / `resolveWslCommand`），真实实现走 `node:child_process` + `node:fs`，测试用桩。`ProcessRunner` 只负责拉起进程与逐行流式事件，不懂任何框架语义。

**Tech Stack:** 同上，无新增依赖。

**注：** 本文件比 Plan 1 精简（不重复贴每段实现代码），原因是它在本会话内紧接着执行、实现代码会直接进入仓库。接口与验收标准仍完整。

---

## 已实测确认的硬约束

在 Windows 上实测（Node 24.19）：

| 方式 | 参数 `he said "hi" & echo pwned` 的实际到达 | 结论 |
| --- | --- | --- |
| `spawn(shim, args, { shell: true })` | 被拆成 `["he","said","hi"]`，且 `echo pwned` 被真的执行 | **禁止使用** |
| 直接 `spawn(".cmd")`（无 shell） | 抛 `EINVAL` | 必须有 shell |
| `spawn("cmd.exe", ["/d","/s","/c", shim, ...args])` | 参数保真，但**路径含空格时失败** | 不采用 |
| `spawn("cmd.exe", ["/d","/s","/c","call", shim, ...args])` | 参数保真、无命令注入，且兼容含空格路径 | **采用** |

`call` 形态的已知边界（实测）：`&` `|` `(` `)` `"` `;` 与中文都原样到达、**不会被执行**；
但 `%VAR%` 会被展开成真实环境变量，`^` 会被吞掉，且 `%%` 无法转义（非批处理上下文）。
普通百分号（如 `提升 30% 到 100%`）安全。

**由此推出一条架构硬约束：提示词等自由文本必须走 stdin，绝不放进 argv。**
这条在 Plan 3 由适配器的 stdin 投递测试负责保证。

本机实测的解析结果（证明「不写死路径」成立）：`where.exe codex` 同时返回 `.cmd`、`.ps1` 与无扩展名 shim，
打分机制自动选中真实 exe `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`；`claude` 解析为 `~\.local\bin\claude.exe`。
即本机路径下完全不会经过 cmd.exe。

## 文件结构

```
packages/core/src/launcher/
  environment.ts        # LaunchEnvironment 接口 + createSystemEnvironment()
  resolveLauncher.ts    # 候选收集、打分、生成 LaunchSpec
packages/core/src/process/
  lineSplitter.ts       # 纯函数：字节流 → 行
  killProcessTree.ts    # Windows 用 taskkill /T /F，其它平台 kill
  processRunner.ts      # spawn + 流式 + 超时 + 取消 + 汇总
packages/core/test/fixtures/
  fake-cli.mjs          # 假 agent CLI
  argv-shim.cmd         # 模拟 npm 的 .cmd 包装脚本
```

## 任务分解

### Task 1: 行切分
新增 `process/lineSplitter.ts`：`createLineSplitter(onLine)` 返回 `push(chunk: string)` 与 `flush()`。
覆盖：空行、CRLF、跨 chunk 断行、结尾无换行、连续空行不产生空行事件。

### Task 2: 进程执行器
新增 `process/processRunner.ts`。接口：

```ts
interface ProcessRunOptions {
  command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv;
  stdin?: string; timeoutMs?: number; signal?: AbortSignal;
  onStdoutLine?: (line: string) => void; onStderrLine?: (line: string) => void;
}
interface ProcessRunResult {
  exitCode: number | null; signal: NodeJS.Signals | null;
  stdout: string; stderr: string; timedOut: boolean; cancelled: boolean;
}
```
覆盖：逐行回调、stdin 投递、非零退出码、stderr 捕获、超时后进程确实被杀（用耗时断言）、AbortSignal 取消、参数逐字节保真（反注入回归测试）。

### Task 3: 杀进程树
新增 `process/killProcessTree.ts`：`killProcessTree(child, platform)`。Windows 走 `taskkill /pid <pid> /T /F`，其它平台 `child.kill("SIGTERM")`，并对已退出进程静默。

### Task 4: 启动器探测
新增 `launcher/environment.ts` 与 `launcher/resolveLauncher.ts`。探测优先级与打分：

1. 全局配置里用户显式指定的路径（source `settings`）
2. `which` 结果，按优先级打分：`.exe` = 3 > `.cmd`/`.bat` = 2 > `.ps1` = 1；Windows 上无扩展名的 bash shim 记 0 分（直接用不了）
3. 已知安装位置：`%APPDATA%\npm`、`%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`（版本化子目录）、`%USERPROFILE%\.local\bin`、`%LOCALAPPDATA%\Programs`、`%USERPROFILE%\scoop\shims`、`%ProgramData%\chocolatey\bin`、`%LOCALAPPDATA%\Microsoft\WinGet\Links`
4. 可选 WSL（设置里开启时）：`wsl.exe -e <linux 路径>` 作为 command/baseArgs

生成的 `LaunchSpec`：

```ts
{ framework, command, baseArgs, source, resolvedPath, note? }
```

- `.exe` → `command = 该 exe`，`baseArgs = []`
- `.cmd` / `.bat` → `command = "cmd.exe"`，`baseArgs = ["/d","/s","/c", 路径]`
- `.ps1` → `command = "powershell.exe"`，`baseArgs = ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File", 路径]`
- WSL → `command = "wsl.exe"`，`baseArgs = ["-e", linux路径]`

找不到时返回 `{ status: "not-found", framework, searched }`，供 UI 引导手动指定。

### Task 5: 接线与边界
`src/index.ts` 导出新模块；新增边界断言：`process/` 与 `launcher/` 都不 import `room/`、`employee/`。

## 完成标准

1. `npm run test` 全绿，且测试数从 68 增长到覆盖上述全部条目。
2. `npm run typecheck` 无错误。
3. `resolveLauncher` 在本机能真的解析出 codex 与 claude（不写死路径），且在桩环境下能覆盖 `.exe` / `.cmd` / `.ps1` / 找不到四种分支。
4. `.cmd` 参数保真回归测试存在并通过。
