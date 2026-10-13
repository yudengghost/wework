import { execFile, type ChildProcess } from "node:child_process";

/**
 * 结束一个子进程及其所有后代。
 *
 * Windows 上 `child.kill()` 只结束直接子进程，agent CLI 往往会再派生子进程，
 * 因此用 `taskkill /T /F` 整棵树一起杀。
 */
export function killProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
): void {
  const pid = child.pid;
  const alreadyExited = child.exitCode !== null || child.signalCode !== null;

  if (pid === undefined || alreadyExited) {
    try {
      child.kill();
    } catch {
      // 进程早已结束，忽略。
    }
    return;
  }

  if (platform === "win32") {
    execFile(
      "taskkill.exe",
      ["/pid", String(pid), "/T", "/F"],
      { windowsHide: true },
      (error) => {
        if (!error) return;
        // taskkill 用不了时退回直接 kill，至少别让子进程继续跑。
        try {
          child.kill();
        } catch {
          // 进程早已结束，忽略。
        }
      },
    );
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // 进程早已结束，忽略。
  }
}
