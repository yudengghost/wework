import { spawn } from "node:child_process";

import { killProcessTree } from "./killProcessTree";
import { createLineSplitter } from "./lineSplitter";

export interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export class ProcessRunner {
  run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    return new Promise<ProcessRunResult>((resolve, reject) => {
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const stdoutSplitter = createLineSplitter((line) => options.onStdoutLine?.(line));
      const stderrSplitter = createLineSplitter((line) => options.onStderrLine?.(line));

      const onAbort = () => {
        cancelled = true;
        killProcessTree(child);
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
        stdoutSplitter.push(chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        stderrSplitter.push(chunk);
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });

      child.on("close", (code, closeSignal) => {
        if (settled) return;
        settled = true;
        cleanup();
        stdoutSplitter.flush();
        stderrSplitter.flush();
        resolve({
          exitCode: code,
          signal: closeSignal,
          stdout,
          stderr,
          timedOut,
          cancelled,
        });
      });

      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, options.timeoutMs);
      }

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      if (child.stdin) {
        child.stdin.end(options.stdin ?? "");
      }
    });
  }
}
