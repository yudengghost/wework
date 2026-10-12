import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { BrowserWindow, app } from "electron";

import { registerIpc } from "./ipc";
import { createServices } from "./services";

let window: BrowserWindow | null = null;

/**
 * Windows 上 Electron 是 GUI 子系统程序，主进程的 console 输出没有控制台可去，
 * 因此诊断信息统一写到 BUDDY_SMOKE_FILE 指向的文件里。
 */
function trace(line: string): void {
  const file = process.env.BUDDY_SMOKE_FILE;
  if (!file) return;
  try {
    appendFileSync(file, `${line}\n`);
  } catch {
    // 诊断失败不应影响应用本身。
  }
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    title: "Buddy",
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(join(__dirname, "..", "renderer", "index.html"));
  trace("window: html loaded");
  window.on("closed", () => {
    window = null;
  });

  window.webContents.on("did-fail-load", (_event, code, description) => {
    trace(`window: did-fail-load ${code} ${description}`);
  });
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) trace(`renderer[${level}]: ${message}`);
  });
}

/**
 * 冒烟模式：在真实渲染进程里走一遍「渲染层 → preload → 主进程 → core」的完整链路，
 * 并把主要功能串成一个剧本跑一遍，最后退出。
 */
const smokeScript = `(async () => {
  const out = {};
  const boot = await window.buddy.invoke("app:bootstrap");
  out.dataDir = boot.dataDir;
  out.frameworks = Object.entries(boot.frameworks).map(([k, v]) => k + "=" + v.status).join(",");
  out.skillCount = boot.skills.length;

  const employee = await window.buddy.invoke("employee:create", {
    displayName: "联调员工",
    framework: "codex",
    permissionMode: "read-only",
  });
  out.employee = employee.id;

  const direct = await window.buddy.invoke("room:direct", { employeeId: employee.id });
  out.directKind = direct.kind;
  out.directMembers = direct.memberIds.length;

  const again = await window.buddy.invoke("room:direct", { employeeId: employee.id });
  out.directReused = again.id === direct.id;

  const group = await window.buddy.invoke("room:create", {
    name: "测试群",
    memberIds: [employee.id],
    kind: "group",
  });
  out.groupKind = group.kind;

  const memory = await window.buddy.invoke("memory:list", { employeeId: employee.id });
  out.memoryCount = memory.count;

  const after = await window.buddy.invoke("app:bootstrap");
  out.rooms = after.rooms.length;
  out.employees = after.employees.length;
  return JSON.stringify(out);
})()`;

async function runSmoke(): Promise<void> {
  const target = window;
  if (!target) {
    trace("smoke: 没有窗口");
    return;
  }
  try {
    trace(`smoke: ok ${await target.webContents.executeJavaScript(smokeScript)}`);
  } catch (error) {
    trace(`smoke: failed: ${String(error)}`);
    process.exitCode = 1;
  }
}

void app
  .whenReady()
  .then(async () => {
    const services = await createServices();
    trace(`services: ready dataDir=${services.dataDir}`);
    registerIpc(services, () => window);
    await createWindow();

    if (process.env.BUDDY_SMOKE === "1") {
      setTimeout(() => {
        trace("smoke: 超时兜底退出");
        app.quit();
      }, 20000);
      await runSmoke();
      setTimeout(() => app.quit(), 300);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch((error: unknown) => {
    trace(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
