// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
