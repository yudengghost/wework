// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { installBridge, makeBootstrap, makeEmployee } from "./tests/support";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "buddy");
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
    render(<App />);

    await waitFor(() => expect(screen.getByText(/1 名员工/)).toBeTruthy());
  });
});
