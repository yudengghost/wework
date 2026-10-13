import type { WeworkConfig, Employee, Message, Room, RunTrace } from "@wework/core";
import { defaultConfig } from "@wework/core";
import { act } from "@testing-library/react";

import type { ApprovalEvent, Bootstrap, RunEvent } from "../api";

// jsdom 没有 ResizeObserver，而虚拟列表用它观察视口与行高。给个最小替身就够了：
// jsdom 本来也没有真实布局，行高会一直用估算值。
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {
      // 不需要真的观察
    }
    unobserve(): void {
      // 不需要真的取消观察
    }
    disconnect(): void {
      // 不需要真的断开
    }
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// jsdom 也没有 Element.scrollTo。按浏览器语义补上：改位置并派发 scroll 事件。
if (typeof Element.prototype.scrollTo !== "function") {
  (Element.prototype as unknown as { scrollTo: (options?: ScrollToOptions) => void }).scrollTo =
    function (this: Element, options?: ScrollToOptions): void {
      const top = options?.top;
      if (typeof top === "number") (this as HTMLElement).scrollTop = top;
      this.dispatchEvent(new Event("scroll"));
    };
}

/** 一次渲染层 → 主进程的调用记录，用来断言「界面到底发了什么」。 */
export interface BridgeCall {
  channel: string;
  payload: unknown;
}

export interface FakeBridge {
  calls: BridgeCall[];
  /** 按通道准备返回值；返回 rejected promise 即模拟主进程报错。 */
  handlers: Map<string, (payload: unknown) => unknown>;
  /** 回放一条主进程 → 渲染层的推送（运行事件 / 消息），用来验证界面反应。 */
  emitRun(event: RunEvent): void;
  emitMessage(message: Message): void;
  emitApproval(approval: ApprovalEvent): void;
}

/**
 * 装上一个假的 window.wework。
 *
 * 渲染层的测试不该真的起 Electron：这里只要求「通道收发的形状」与 preload 一致，
 * 领域逻辑由 packages/core 的测试负责。
 */
export function installBridge(): FakeBridge {
  const calls: BridgeCall[] = [];
  const handlers = new Map<string, (payload: unknown) => unknown>();

  // 主进程对这些通道的返回形状是固定的（都是数组）。没准备 handler 时按真实形状
  // 给一个空值，而不是 undefined——否则界面会在「拿到 undefined 的列表」上崩掉，
  // 那测的是替身而不是被测代码。
  const defaults: Record<string, () => unknown> = {
    "room:messages": () => [],
    "runs:snapshot": () => [],
    "files:pick": () => [],
    "skills:catalog": () => [],
  };

  const runHandlers: ((event: RunEvent) => void)[] = [];
  const messageHandlers: ((message: Message) => void)[] = [];
  const approvalHandlers: ((approval: ApprovalEvent) => void)[] = [];

  function listen<T>(bucket: ((payload: T) => void)[]) {
    return (handler: (payload: T) => void): (() => void) => {
      bucket.push(handler);
      return () => {
        const index = bucket.indexOf(handler);
        if (index >= 0) bucket.splice(index, 1);
      };
    };
  }

  window.wework = {
    invoke: <TResult>(channel: string, payload?: unknown): Promise<TResult> => {
      calls.push({ channel, payload });
      const handler = handlers.get(channel) ?? defaults[channel];
      if (!handler) return Promise.resolve(undefined as TResult);
      return Promise.resolve(handler(payload) as TResult);
    },
    onMessage: listen(messageHandlers),
    onRun: listen(runHandlers),
    onApproval: listen(approvalHandlers),
    pathForFile: () => "",
  };

  return {
    calls,
    handlers,
    emitRun: (event) => {
      act(() => {
        for (const handler of [...runHandlers]) handler(event);
      });
    },
    emitMessage: (message) => {
      act(() => {
        for (const handler of [...messageHandlers]) handler(message);
      });
    },
    emitApproval: (approval) => {
      act(() => {
        for (const handler of [...approvalHandlers]) handler(approval);
      });
    },
  };
}

let sequence = 0;

export function makeEmployee(patch: Partial<Employee> = {}): Employee {
  sequence += 1;
  return {
    id: `emp_${sequence}`,
    displayName: `员工${sequence}`,
    framework: "codex",
    workspaceDir: `E:/tmp/ws/${sequence}`,
    stateDir: `E:/tmp/state/${sequence}`,
    skills: [],
    canHire: false,
    permissions: {
      mode: "workspace-write",
      network: false,
      allowedTools: [],
      disallowedTools: [],
      requireApprovalFor: [],
    },
    createdAt: "2026-10-13T00:00:00.000Z",
    ...patch,
  };
}

export function makeRoom(patch: Partial<Room> = {}): Room {
  sequence += 1;
  return {
    id: `room_${sequence}`,
    name: `房间${sequence}`,
    kind: "group",
    memberIds: [],
    createdAt: "2026-10-13T00:00:00.000Z",
    ...patch,
  };
}

export function makeMessage(patch: Partial<Message> = {}): Message {
  sequence += 1;
  return {
    id: `msg_${sequence}`,
    roomId: "room_x",
    sender: { kind: "human" },
    mentions: [],
    body: `消息${sequence}`,
    attachments: [],
    kind: "chat",
    createdAt: "2026-10-13T10:00:00.000Z",
    ...patch,
  };
}

export function makeConfig(): WeworkConfig {
  return defaultConfig();
}

export function makeTrace(patch: Partial<RunTrace> = {}): RunTrace {
  sequence += 1;
  return {
    runId: `run_${sequence}`,
    roomId: "room_x",
    employeeId: "emp_1",
    trigger: "帮我干活",
    status: "running",
    queuedAt: "2026-10-13T10:00:00.000Z",
    startedAt: "2026-10-13T10:00:02.000Z",
    steps: [],
    text: "",
    textTruncated: false,
    ...patch,
  };
}

export function makeBootstrap(patch: Partial<Bootstrap> = {}): Bootstrap {
  return {
    dataDir: "E:/tmp/data",
    bootstrapDir: "E:/tmp/data",
    config: makeConfig(),
    builtinApiKeySet: false,
    employees: [],
    removedEmployees: [],
    rooms: [],
    frameworks: {
      codex: { status: "found", detail: "codex.exe" },
      "claude-code": { status: "not-found", detail: "未找到" },
    },
    skills: [],
    ...patch,
  };
}
