// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { api } from "./api";
import { installBridge, makeEmployee, makeMessage } from "./tests/support";

afterEach(() => {
  Reflect.deleteProperty(window, "buddy");
});

// 渲染层与主进程之间唯一的契约就是「通道名 + 载荷形状」。
// 两侧只共享 packages/core 的类型，桥本身是泛型无校验的，tsc 抓不到漂移，所以在这里钉住。
describe("api 与主进程的通道契约", () => {
  it("按约定的通道与载荷形状调用主进程", async () => {
    const bridge = installBridge();
    bridge.handlers.set("employee:remove", () => makeEmployee({ id: "emp_1" }));
    bridge.handlers.set("room:send", () => makeMessage());
    bridge.handlers.set("approval:resolve", () => true);
    bridge.handlers.set("room:repair", () => ({ roomId: "room_1", kept: 0, quarantined: 0, backupPath: null }));
    bridge.handlers.set("settings:set-builtin-key", () => ({ ok: true }));

    await api.removeEmployee("emp_1");
    await api.send("room_1", "干活", [{ name: "a.txt", sourcePath: "E:/a.txt" }]);
    await api.resolveApproval("appr_1", true);
    await api.repairRoom("room_1");
    await api.setBuiltinApiKey("sk-1");
    await api.setBuiltinApiKey(null);

    expect(bridge.calls).toEqual([
      { channel: "employee:remove", payload: { id: "emp_1" } },
      {
        channel: "room:send",
        payload: {
          roomId: "room_1",
          body: "干活",
          files: [{ name: "a.txt", sourcePath: "E:/a.txt" }],
        },
      },
      { channel: "approval:resolve", payload: { approvalId: "appr_1", approved: true } },
      { channel: "room:repair", payload: { roomId: "room_1" } },
      { channel: "settings:set-builtin-key", payload: { apiKey: "sk-1" } },
      { channel: "settings:set-builtin-key", payload: { apiKey: null } },
    ]);
  });

  it("不带附件时也显式传空数组，主进程不必判 undefined", async () => {
    const bridge = installBridge();
    bridge.handlers.set("room:send", () => makeMessage());

    await api.send("room_1", "只说一句话");

    expect(bridge.calls[0]?.payload).toEqual({ roomId: "room_1", body: "只说一句话", files: [] });
  });
});
