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

/** 冒烟模式：走一遍「渲染层 → preload → 主进程 → core」的完整链路后退出。 */
async function runSmoke(): Promise<void> {
  const target = window;
  if (!target) {
    trace("smoke: 没有窗口");
    return;
  }
  try {
    const result = await target.webContents.executeJavaScript(
      'window.buddy.invoke("app:bootstrap").then((info) => JSON.stringify({ employees: info.employees.length, rooms: info.rooms.length, dataDir: info.dataDir, frameworks: info.frameworks }))',
    );
    trace(`smoke: bootstrap ok: ${String(result)}`);
  } catch (error) {
    trace(`smoke: bootstrap failed: ${String(error)}`);
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
