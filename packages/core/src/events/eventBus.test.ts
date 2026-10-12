import { describe, expect, it, vi } from "vitest";

import { EventBus } from "./eventBus";

interface TestEvents extends Record<string, unknown> {
  message: { id: string };
  tick: { n: number };
}

describe("EventBus", () => {
  it("把载荷投递给订阅者", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on("message", handler);
    bus.emit("message", { id: "msg_1" });

    expect(handler).toHaveBeenCalledWith({ id: "msg_1" });
  });

  it("on 返回的取消函数能退订", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    const off = bus.on("tick", handler);
    off();
    bus.emit("tick", { n: 1 });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount("tick")).toBe(0);
  });

  it("某个订阅者抛错不影响其它订阅者", () => {
    const onHandlerError = vi.fn();
    const bus = new EventBus<TestEvents>({ onHandlerError });
    const second = vi.fn();

    bus.on("message", () => {
      throw new Error("boom");
    });
    bus.on("message", second);

    bus.emit("message", { id: "msg_1" });

    expect(second).toHaveBeenCalledTimes(1);
    expect(onHandlerError).toHaveBeenCalledTimes(1);
    expect(onHandlerError.mock.calls[0]?.[1]).toBe("message");
  });

  it("订阅者在回调里退订不会破坏本次派发", () => {
    const bus = new EventBus<TestEvents>();
    const second = vi.fn();
    const off = bus.on("tick", () => off());

    bus.on("tick", second);
    bus.emit("tick", { n: 1 });

    expect(second).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("tick")).toBe(1);
  });
});
