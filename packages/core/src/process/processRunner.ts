import { spawn } from "node:child_process";

import { killProcessTree } from "./killProcessTree";
import { createLineSplitter } from "./lineSplitter";

// 单条流默认最多保留 1MiB 正文用于事后诊断。
const defaultCaptureBytes = 1024 * 1024;

// 有上限的文本累积器。agent CLI 的 stdout 可能很大，而真正被消费的是逐行回调，
// 整份留住只是给「事后看一眼」用的，不能让它把内存拖垮。
// 两套口径分开：totalBytes 是完整观测到的字节数，value() 只是留下来的前缀。
interface CappedText {
  push(chunk: string): void;
  value(): string;
  totalBytes(): number;
  truncated(): boolean;
}

function createCappedText(limit: number): CappedText {
  let text = "";
  let captured = 0;
  let total = 0;

  return {
    push(chunk: string): void {
      const size = Buffer.byteLength(chunk);
      total += size;
      // 整块取舍：宁可少留一块，也不做字节级切割。
      if (captured + size > limit) return;
      text += chunk;
      captured += size;
    },
    value: () => text,
    totalBytes: () => total,
    truncated: () => total > captured,
  };
}

export interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 每条流最多保留多少字节正文（默认 1MiB，0 表示只计数不保留）。 */
  captureBytes?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** 受 captureBytes 限制后的 stdout 前缀；完整大小看 stdoutBytes。 */
  stdout: string;
  /** 受 captureBytes 限制后的 stderr 前缀；完整大小看 stderrBytes。 */
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** 完整观测到的字节数，含没有被保留的部分。 */
  stdoutBytes: number;
  stderrBytes: number;
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

      const captureLimit = options.captureBytes ?? defaultCaptureBytes;
      const stdoutText = createCappedText(captureLimit);
      const stderrText = createCappedText(captureLimit);
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
        stdoutText.push(chunk);
        stdoutSplitter.push(chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderrText.push(chunk);
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
          stdout: stdoutText.value(),
          stderr: stderrText.value(),
          stdoutTruncated: stdoutText.truncated(),
          stderrTruncated: stderrText.truncated(),
          stdoutBytes: stdoutText.totalBytes(),
          stderrBytes: stderrText.totalBytes(),
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
