// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { installBridge, makeBootstrap, makeEmployee, makeRoom, makeTrace } from "./tests/support";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "wework");
});

describe("应用外壳", () => {
  it("侧栏与主页都显示软件名 Wework，并带皇冠标识", async () => {
    const bridge = installBridge();
    bridge.handlers.set("app:bootstrap", () => makeBootstrap());
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getAllByText("Wework").length).toBeGreaterThan(0));
    // 标识就是那条 W 折线加底座矩形
    expect(container.querySelectorAll("svg polyline").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("svg rect").length).toBeGreaterThan(0);
    expect(screen.queryByText("Buddy")).toBeNull();
  });

  it("有员工时侧栏显示员工数", async () => {
    const bridge = installBridge();
    bridge.handlers.set("app:bootstrap", () =>
      makeBootstrap({ employees: [makeEmployee({ displayName: "小码" })] }),
    );
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText(/1 名员工/)).toBeTruthy());
  });

  it("有运行在跑时：标题行给出在跑的数量，侧栏对应房间点亮小圆点", async () => {
    const bridge = installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ name: "发布检查", memberIds: [employee.id] });
    bridge.handlers.set("app:bootstrap", () =>
      makeBootstrap({ employees: [employee], rooms: [room] }),
    );
    bridge.handlers.set("runs:snapshot", () => [
      makeTrace({ roomId: room.id, employeeId: employee.id }),
    ]);
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText(/1 个运行进行中/)).toBeTruthy());
    expect(container.querySelector(".busy-dot")).toBeTruthy();
  });

  it("没有运行在跑时不提「进行中」，也不点亮圆点", async () => {
    const bridge = installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ name: "发布检查", memberIds: [employee.id] });
    bridge.handlers.set("app:bootstrap", () =>
      makeBootstrap({ employees: [employee], rooms: [room] }),
    );
    bridge.handlers.set("runs:snapshot", () => [
      makeTrace({ roomId: room.id, status: "done", finishedAt: "2026-10-13T10:05:00.000Z" }),
    ]);
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText(/1 名员工/)).toBeTruthy());
    expect(screen.queryByText(/运行进行中/)).toBeNull();
    expect(container.querySelector(".busy-dot")).toBeNull();
  });

  it("用户主动停止的运行不弹「运行失败」警报", async () => {
    const bridge = installBridge();
    bridge.handlers.set("app:bootstrap", () => makeBootstrap());
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Wework").length).toBeGreaterThan(0));

    // 主进程回放两条收尾事件：一条真失败、一条用户停止。
    bridge.emitRun({
      kind: "finished",
      roomId: "room_x",
      employeeId: "emp_1",
      ok: false,
      status: "failed",
      error: "401",
    });
    bridge.emitRun({
      kind: "finished",
      roomId: "room_x",
      employeeId: "emp_1",
      ok: false,
      status: "stopped",
      error: "已被用户停止",
    });

    await waitFor(() => expect(screen.getByText(/运行失败/)).toBeTruthy());
    expect(screen.queryByText(/已被用户停止/)).toBeNull();
  });

  it("批准招人后立刻重取名册：新员工不用重启就出现在侧栏", async () => {
    const bridge = installBridge();
    const hr = makeEmployee({ displayName: "小码" });
    const hired = makeEmployee({ displayName: "新招的测试" });
    const room = makeRoom({ name: "发布前检查", memberIds: [hr.id] });
    let boots = 0;
    bridge.handlers.set("app:bootstrap", () => {
      boots += 1;
      // 第一次快照里还没有这位新同事，批准之后才会出现在名册里
      return makeBootstrap({ employees: boots === 1 ? [hr] : [hr, hired], rooms: [room] });
    });
    bridge.handlers.set("approval:resolve", () => true);
    render(<App />);

    await waitFor(() => expect(screen.getByText(/1 名员工/)).toBeTruthy());
    fireEvent.click(screen.getByText("发布前检查"));
    await waitFor(() => expect(screen.getByText(/还没有消息/)).toBeTruthy());

    bridge.emitApproval({
      approvalId: "appr_1",
      roomId: room.id,
      employeeId: hr.id,
      targetId: "新招的测试",
      summary: "招人申请：新招的测试（codex）",
      kind: "hire",
    });
    await waitFor(() => expect(screen.getByText("批准招人")).toBeTruthy());

    fireEvent.click(screen.getByText("批准招人"));

    await waitFor(() => expect(screen.getByText(/2 名员工/)).toBeTruthy());
    expect(screen.getByText("新招的测试")).toBeTruthy();
  });
});
