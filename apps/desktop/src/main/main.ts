import { appendFileSync, writeFileSync } from "node:fs";
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
  out.groupMembersAfterCreate = group.memberIds.length;

  const second = await window.buddy.invoke("employee:create", {
    displayName: "联调员工B",
    framework: "codex",
    permissionMode: "read-only",
  });
  const added = await window.buddy.invoke("room:member", {
    roomId: group.id,
    employeeId: second.id,
    member: true,
  });
  out.afterAddMember = added.memberIds.length;
  const removed = await window.buddy.invoke("room:member", {
    roomId: group.id,
    employeeId: second.id,
    member: false,
  });
  out.afterRemoveMember = removed.memberIds.length;

  const memory = await window.buddy.invoke("memory:list", { employeeId: employee.id });
  out.memoryCount = memory.count;

  const beforeDelete = await window.buddy.invoke("app:bootstrap");
  out.roomsBeforeDelete = beforeDelete.rooms.length;
  await window.buddy.invoke("room:remove", { id: group.id });
  const after = await window.buddy.invoke("app:bootstrap");
  out.roomsAfterDelete = after.rooms.length;
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
      const shotPath = process.env.BUDDY_SMOKE_SHOT;
      if (shotPath) {
        // 只截图、不跑剧本：用来肉眼检查真实渲染结果。
        setTimeout(() => {
          void (async () => {
            try {
              // 先量一次真实布局：如果这些数字是对的，图上的接缝就只可能是截图产物。
              const metrics = await window?.webContents.executeJavaScript(
                `(() => {
                  const q = (sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) };
                  };
                  return JSON.stringify({
                    viewport: document.documentElement.clientWidth,
                    bodyScrollW: document.body.scrollWidth,
                    bodyScrollH: document.body.scrollHeight,
                    app: q(".app"),
                    sidebar: q(".sidebar"),
                    list: q(".list"),
                    main: q(".main"),
                    messages: q(".messages"),
                    composer: q(".composer"),
                    messagesScrollH: document.querySelector(".messages")?.scrollHeight ?? 0,
                  });
                })()`,
              );
              trace(`layout: ${String(metrics)}`);
              const clickSelector = process.env.BUDDY_SMOKE_SHOT_CLICK;
              const shotJs = process.env.BUDDY_SMOKE_SHOT_JS;
              if (shotJs) {
                // 允许在截图前执行任意脚本，例如展开所有折叠区再截图。
                await window?.webContents.executeJavaScript(shotJs);
                await new Promise((resolve) => setTimeout(resolve, 1100));
              } else if (clickSelector) {
                await window?.webContents.executeJavaScript(
                  `document.querySelector(${JSON.stringify(clickSelector)})?.click()`,
                );
                await new Promise((resolve) => setTimeout(resolve, 900));
              }
              window?.webContents.invalidate();
              await new Promise((resolve) => setTimeout(resolve, 700));
              await window?.webContents.capturePage();
              await new Promise((resolve) => setTimeout(resolve, 300));
              const image = await window?.webContents.capturePage();
              if (image) writeFileSync(shotPath, image.toPNG());
              trace(`screenshot: ${shotPath}`);
            } catch (error) {
              trace(`screenshot failed: ${String(error)}`);
            } finally {
              app.quit();
            }
          })();
        }, 2600);
      } else {
        setTimeout(() => {
          trace("smoke: 超时兜底退出");
          app.quit();
        }, 20000);
        await runSmoke();
        setTimeout(() => app.quit(), 300);
      }
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
