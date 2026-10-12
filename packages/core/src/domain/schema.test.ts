import { describe, expect, it } from "vitest";

import {
  employeeSchema,
  messageSchema,
  permissionPolicySchema,
  roomSchema,
  runStateSchema,
} from "./schema";

describe("permissionPolicySchema", () => {
  it("只给 mode 时补全三个数组默认值", () => {
    const policy = permissionPolicySchema.parse({ mode: "read-only" });

    expect(policy).toEqual({
      mode: "read-only",
      allowedTools: [],
      disallowedTools: [],
      requireApprovalFor: [],
    });
  });

  it("拒绝未知的权限模式", () => {
    expect(() => permissionPolicySchema.parse({ mode: "yolo" })).toThrow();
  });
});

describe("employeeSchema", () => {
  const base = {
    id: "emp_1",
    displayName: "小码",
    framework: "codex",
    workspaceDir: "C:/work/a",
    stateDir: "C:/state/a",
    permissions: { mode: "workspace-write" },
    createdAt: "2026-10-12T00:00:00.000Z",
  };

  it("接受最小合法员工并补全 skills", () => {
    const employee = employeeSchema.parse(base);

    expect(employee.skills).toEqual([]);
    expect(employee.model).toBeUndefined();
  });

  it("拒绝未注册的框架", () => {
    expect(() => employeeSchema.parse({ ...base, framework: "cursor" })).toThrow();
  });

  it("拒绝空 displayName", () => {
    expect(() => employeeSchema.parse({ ...base, displayName: "" })).toThrow();
  });
});

describe("messageSchema", () => {
  it("补全 mentions/attachments/kind 默认值", () => {
    const message = messageSchema.parse({
      id: "msg_1",
      roomId: "room_1",
      sender: { kind: "human" },
      body: "帮我看看这个 bug",
      createdAt: "2026-10-12T00:00:00.000Z",
    });

    expect(message.mentions).toEqual([]);
    expect(message.attachments).toEqual([]);
    expect(message.kind).toBe("chat");
  });

  it("区分 @员工 与 @all 两种 mention", () => {
    const message = messageSchema.parse({
      id: "msg_2",
      roomId: "room_1",
      sender: { kind: "employee", employeeId: "emp_1" },
      mentions: [{ kind: "employee", employeeId: "emp_2" }, { kind: "all" }],
      body: "@小测 @all 帮我看下",
      createdAt: "2026-10-12T00:00:00.000Z",
    });

    expect(message.mentions).toHaveLength(2);
    expect(message.sender).toEqual({ kind: "employee", employeeId: "emp_1" });
  });
});

describe("roomSchema", () => {
  it("policy 可省略", () => {
    const room = roomSchema.parse({
      id: "room_1",
      name: "默认房间",
      createdAt: "2026-10-12T00:00:00.000Z",
    });

    expect(room.memberIds).toEqual([]);
    expect(room.policy).toBeUndefined();
  });
});

describe("runStateSchema", () => {
  it("接受 awaiting-approval 变体并携带审批请求", () => {
    const state = runStateSchema.parse({
      status: "awaiting-approval",
      startedAt: "2026-10-12T00:00:00.000Z",
      request: {
        id: "appr_1",
        kind: "shell",
        summary: "执行 rm -rf build",
        createdAt: "2026-10-12T00:00:01.000Z",
      },
    });

    expect(state.status).toBe("awaiting-approval");
  });

  it("拒绝状态与字段不匹配的变体", () => {
    expect(() => runStateSchema.parse({ status: "done" })).toThrow();
  });
});
