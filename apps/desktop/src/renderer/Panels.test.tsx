// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmployeesPanel, SettingsPanel } from "./Panels";
import { installBridge, makeBootstrap, makeConfig, makeEmployee } from "./tests/support";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "buddy");
});

const noop = async (): Promise<void> => undefined;

describe("SettingsPanel 保存", () => {
  it("保存成功时给出已保存回执", async () => {
    const bridge = installBridge();
    bridge.handlers.set("settings:update", () => makeConfig());
    render(<SettingsPanel boot={makeBootstrap()} onClose={() => undefined} onChanged={noop} />);

    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());
  });

  it("保存被拒绝时显示原因，而不是假装已保存", async () => {
    const bridge = installBridge();
    bridge.handlers.set("settings:update", () =>
      Promise.reject(new Error("scheduler.maxConcurrentRuns: 必须是正数")),
    );
    render(<SettingsPanel boot={makeBootstrap()} onClose={() => undefined} onChanged={noop} />);

    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(screen.getByText(/保存失败/)).toBeTruthy());
    expect(screen.getByText(/必须是正数/)).toBeTruthy();
    expect(screen.queryByText("已保存")).toBeNull();
  });
});

describe("EmployeesPanel 记忆", () => {
  it("把每位员工的记忆条数都显示出来", async () => {
    const bridge = installBridge();
    const first = makeEmployee({ displayName: "小码" });
    const second = makeEmployee({ displayName: "小测" });
    bridge.handlers.set("memory:list", () => ({
      count: 3,
      pendingCount: 1,
      facts: [],
      pending: [],
    }));
    render(
      <EmployeesPanel
        boot={makeBootstrap({ employees: [first, second] })}
        onClose={() => undefined}
        onChanged={noop}
      />,
    );

    await waitFor(() => expect(screen.getAllByText(/记忆 3 条/)).toHaveLength(2));
    expect(bridge.calls.filter((call) => call.channel === "memory:list")).toHaveLength(2);
  });

  it("读不到记忆时显示错误，而不是静默空着", async () => {
    const bridge = installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    bridge.handlers.set("memory:list", () =>
      Promise.reject(new Error("记忆文件第 1 行不是合法 JSON")),
    );
    render(
      <EmployeesPanel
        boot={makeBootstrap({ employees: [employee] })}
        onClose={() => undefined}
        onChanged={noop}
      />,
    );

    await waitFor(() => expect(screen.getByText(/读取记忆失败/)).toBeTruthy());
  });

  it("移除员工失败时显示原因，而不是点下去没反应", async () => {
    const bridge = installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    bridge.handlers.set("memory:list", () => ({
      count: 0,
      pendingCount: 0,
      facts: [],
      pending: [],
    }));
    bridge.handlers.set("employee:remove", () => Promise.reject(new Error("员工不存在: emp_1")));
    render(
      <EmployeesPanel
        boot={makeBootstrap({ employees: [employee] })}
        onClose={() => undefined}
        onChanged={noop}
      />,
    );

    fireEvent.click(screen.getByText("移除"));

    await waitFor(() => expect(screen.getByText(/员工不存在/)).toBeTruthy());
  });
});

describe("EmployeesPanel 彻底删除", () => {
  it("删除后能在同一个面板里接着新建员工，界面不被原生弹窗卡死", async () => {
    const bridge = installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    // window.alert 在 Electron 里是阻塞渲染进程的原生模态框：出现过一次就会让整个界面卡死。
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    bridge.handlers.set("memory:list", () => ({
      count: 0,
      pendingCount: 0,
      facts: [],
      pending: [],
    }));
    bridge.handlers.set("employee:purge", () => ({ workspaceDir: "E:/tmp/ws/1" }));
    bridge.handlers.set("employee:create", () => makeEmployee({ displayName: "小测" }));
    render(
      <EmployeesPanel
        boot={makeBootstrap({ employees: [employee] })}
        onClose={() => undefined}
        onChanged={noop}
      />,
    );

    fireEvent.click(screen.getByText("彻底删除"));
    // 卡片上的按钮与确认弹窗里的按钮同名，确认弹窗排在 DOM 后面。
    const confirms = screen.getAllByText("彻底删除");
    fireEvent.click(confirms[confirms.length - 1] as HTMLElement);

    await waitFor(() => expect(screen.getByText(/已彻底删除「小码」/)).toBeTruthy());
    expect(screen.getByText(/E:\/tmp\/ws\/1/)).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText("例如 小码") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "小测" } });
    expect(input.value).toBe("小测");
    fireEvent.click(screen.getByText("创建员工"));

    await waitFor(() =>
      expect(
        bridge.calls.some(
          (call) =>
            call.channel === "employee:create" &&
            (call.payload as { displayName?: string }).displayName === "小测",
        ),
      ).toBe(true),
    );
    alertSpy.mockRestore();
  });
});

describe("SettingsPanel 内置兜底密钥", () => {
  it("密钥不回显，保存走专用通道", async () => {
    const bridge = installBridge();
    bridge.handlers.set("settings:set-builtin-key", () => ({ ok: true }));
    render(
      <SettingsPanel
        boot={makeBootstrap({ builtinApiKeySet: true })}
        onClose={() => undefined}
        onChanged={noop}
      />,
    );

    const input = screen.getByPlaceholderText(/已设置/) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByText("当前：已设置")).toBeTruthy();

    fireEvent.change(input, { target: { value: "sk-new" } });
    fireEvent.click(screen.getByText("保存密钥"));

    await waitFor(() =>
      expect(
        bridge.calls.some(
          (call) =>
            call.channel === "settings:set-builtin-key" &&
            JSON.stringify(call.payload) === JSON.stringify({ apiKey: "sk-new" }),
        ),
      ).toBe(true),
    );
    expect(input.value).toBe("");
  });

  it("已设置时有清除入口，清除会把 null 交给主进程", async () => {
    const bridge = installBridge();
    bridge.handlers.set("settings:set-builtin-key", () => ({ ok: true }));
    render(
      <SettingsPanel
        boot={makeBootstrap({ builtinApiKeySet: true })}
        onClose={() => undefined}
        onChanged={noop}
      />,
    );

    fireEvent.click(screen.getByText("清除密钥"));

    await waitFor(() =>
      expect(bridge.calls).toContainEqual({
        channel: "settings:set-builtin-key",
        payload: { apiKey: null },
      }),
    );
  });

  it("未设置时不显示清除入口", () => {
    installBridge();
    render(
      <SettingsPanel
        boot={makeBootstrap({ builtinApiKeySet: false })}
        onClose={() => undefined}
        onChanged={noop}
      />,
    );

    expect(screen.getByText("当前：未设置")).toBeTruthy();
    expect(screen.queryByText("清除密钥")).toBeNull();
  });
});
