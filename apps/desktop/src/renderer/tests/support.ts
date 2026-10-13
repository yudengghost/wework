import type { BuddyConfig, Employee, Message, Room } from "@buddy/core";
import { defaultConfig } from "@buddy/core";

import type { Bootstrap } from "../api";

/** 一次渲染层 → 主进程的调用记录，用来断言「界面到底发了什么」。 */
export interface BridgeCall {
  channel: string;
  payload: unknown;
}

export interface FakeBridge {
  calls: BridgeCall[];
  /** 按通道准备返回值；返回 rejected promise 即模拟主进程报错。 */
  handlers: Map<string, (payload: unknown) => unknown>;
}

/**
 * 装上一个假的 window.buddy。
 *
 * 渲染层的测试不该真的起 Electron：这里只要求「通道收发的形状」与 preload 一致，
 * 领域逻辑由 packages/core 的测试负责。
 */
export function installBridge(): FakeBridge {
  const calls: BridgeCall[] = [];
  const handlers = new Map<string, (payload: unknown) => unknown>();

  window.buddy = {
    invoke: <TResult>(channel: string, payload?: unknown): Promise<TResult> => {
      calls.push({ channel, payload });
      const handler = handlers.get(channel);
      if (!handler) return Promise.resolve(undefined as TResult);
      return Promise.resolve(handler(payload) as TResult);
    },
    onMessage: () => () => undefined,
    onRun: () => () => undefined,
    onApproval: () => () => undefined,
    pathForFile: () => "",
  };

  return { calls, handlers };
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

export function makeConfig(): BuddyConfig {
  return defaultConfig();
}

export function makeBootstrap(patch: Partial<Bootstrap> = {}): Bootstrap {
  return {
    dataDir: "E:/tmp/data",
    bootstrapDir: "E:/tmp/data",
    config: makeConfig(),
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
