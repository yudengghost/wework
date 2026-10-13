// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Employee, Message, Room } from "@buddy/core";

import type { ApprovalEvent } from "./api";
import { RoomView, isNearBottom, type PendingFile } from "./RoomView";
import { installBridge, makeEmployee, makeMessage, makeRoom } from "./tests/support";

// jsdom 没有布局，元素尺寸恒为 0。虚拟列表读的正是 offsetHeight，
// 所以这里给滚动容器一个视口高度、给行一个确定行高，它才会算出真实窗口。
function stubLayout(height: number): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList?.contains("messages")) return height;
      if (this.classList?.contains("message-slot-inner")) return 76;
      if (this.classList?.contains("message-slot")) return 76;
      return descriptor?.get?.call(this) ?? 0;
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
    else delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "buddy");
});

interface RoomOptions {
  employees?: Employee[];
  messages?: Message[];
  approvals?: ApprovalEvent[];
  onSend?: (body: string, files: PendingFile[]) => Promise<void>;
  transcriptError?: string | null;
  onRepairTranscript?: () => Promise<void>;
}

function renderRoom(room: Room, options: RoomOptions = {}): void {
  render(
    <RoomView
      room={room}
      employees={options.employees ?? []}
      messages={options.messages ?? []}
      streams={{}}
      running={{}}
      approvals={options.approvals ?? []}
      onSend={options.onSend ?? (async () => undefined)}
      onResolveApproval={() => undefined}
      onAddMember={async () => undefined}
      onRemoveMember={async () => undefined}
      onDeleteRoom={() => undefined}
      transcriptError={options.transcriptError ?? null}
      onRepairTranscript={options.onRepairTranscript}
    />,
  );
}

describe("RoomView 发送消息", () => {
  it("发送成功后清空输入框并把内容交给上层", async () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ name: "群聊", memberIds: [employee.id] });
    const onSend = vi.fn(async () => undefined);
    renderRoom(room, { employees: [employee], onSend });

    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "@小码 帮我改个 bug" } });
    fireEvent.click(screen.getByTitle("发送（Enter）"));

    await waitFor(() => expect(box.value).toBe(""));
    expect(onSend).toHaveBeenCalledWith("@小码 帮我改个 bug", []);
  });

  it("发送失败时把草稿还给用户，并显示失败原因", async () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ name: "群聊", memberIds: [employee.id] });
    const onSend = vi.fn(async () => {
      throw new Error("附件「大文件.zip」超过上限 25MB");
    });
    renderRoom(room, { employees: [employee], onSend });

    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "@小码 帮我改个 bug" } });
    fireEvent.click(screen.getByTitle("发送（Enter）"));

    await waitFor(() => expect(screen.getByText(/超过上限 25MB/)).toBeTruthy());
    // 草稿不能凭空消失：用户应该能改一改再发一次。
    expect(box.value).toBe("@小码 帮我改个 bug");
  });
});

describe("RoomView 审批与 @ 补全", () => {
  it("招人审批卡片把申请里的工作目录显示出来", () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    const approval: ApprovalEvent = {
      approvalId: "appr_1",
      roomId: room.id,
      employeeId: employee.id,
      targetId: "新人",
      summary: "招人申请：新人（codex）",
      kind: "hire",
      draft: {
        displayName: "新人",
        framework: "codex",
        workspaceDir: "E:\\somewhere\\项目",
      },
    };
    renderRoom(room, { employees: [employee], approvals: [approval] });

    expect(screen.getByText(/拟用工作目录：E:\\somewhere\\项目/)).toBeTruthy();
  });

  it("招人审批卡片标出模型与技能，并点明目录里没有的技能", () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    const approval: ApprovalEvent = {
      approvalId: "appr_2",
      roomId: room.id,
      employeeId: employee.id,
      targetId: "文档专员",
      summary: "招人申请：文档专员（codex · workspace-write）",
      kind: "hire",
      draft: {
        displayName: "文档专员",
        framework: "codex",
        model: "gpt-5-codex",
        skills: ["docx", "跑得快"],
      },
      skillsUnknown: ["跑得快"],
    };
    renderRoom(room, { employees: [employee], approvals: [approval] });

    expect(screen.getByText("模型 gpt-5-codex")).toBeTruthy();
    expect(screen.getByText("技能 docx")).toBeTruthy();
    expect(screen.getByText("技能缺失 跑得快")).toBeTruthy();
  });

  it("同名成员在 @ 补全里补上 id，避免分不清是谁", () => {
    installBridge();
    const first = makeEmployee({ displayName: "小码" });
    const second = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [first.id, second.id] });
    const { container } = render(
      <RoomView
        room={room}
        employees={[first, second]}
        messages={[makeMessage({ roomId: room.id })]}
        streams={{}}
        running={{}}
        approvals={[]}
        onSend={async () => undefined}
        onResolveApproval={() => undefined}
        onAddMember={async () => undefined}
        onRemoveMember={async () => undefined}
        onDeleteRoom={() => undefined}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@" } });

    const suggestions = container.querySelector(".mentions");
    expect(suggestions?.textContent).toContain(first.id);
    expect(suggestions?.textContent).toContain(second.id);
  });

  it("名字不冲突时不显示 id，保持补全干净", () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    const { container } = render(
      <RoomView
        room={room}
        employees={[employee]}
        messages={[]}
        streams={{}}
        running={{}}
        approvals={[]}
        onSend={async () => undefined}
        onResolveApproval={() => undefined}
        onAddMember={async () => undefined}
        onRemoveMember={async () => undefined}
        onDeleteRoom={() => undefined}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@" } });

    expect(container.querySelector(".mentions")?.textContent).not.toContain(employee.id);
  });
});

describe("RoomView 消息记录修复", () => {
  it("记录读不出来时给出修复入口，点击后交给上层处理", async () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    const onRepairTranscript = vi.fn(async () => undefined);
    renderRoom(room, {
      employees: [employee],
      transcriptError: "消息日志第 2 行不是合法 JSON",
      onRepairTranscript,
    });

    expect(screen.getByText(/第 2 行不是合法 JSON/)).toBeTruthy();
    fireEvent.click(screen.getByText("隔离坏行并重新加载"));

    await waitFor(() => expect(onRepairTranscript).toHaveBeenCalledTimes(1));
  });

  it("修复失败时显示原因，而不是静默留在原地", async () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    const onRepairTranscript = vi.fn(async () => {
      throw new Error("没有权限写入数据目录");
    });
    renderRoom(room, {
      employees: [employee],
      transcriptError: "消息日志第 2 行不是合法 JSON",
      onRepairTranscript,
    });

    fireEvent.click(screen.getByText("隔离坏行并重新加载"));

    await waitFor(() => expect(screen.getByText(/没有权限写入数据目录/)).toBeTruthy());
  });

  it("记录正常时不显示修复入口", () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    renderRoom(room, { employees: [employee], transcriptError: null });

    expect(screen.queryByText("隔离坏行并重新加载")).toBeNull();
  });
});

describe("RoomView 消息列表", () => {
  it("isNearBottom 只在贴着底部时为真", () => {
    // 距离底部 20px：算贴着底
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 580 })).toBe(true);
    // 距离底部 220px：用户正在往回翻，不该被拽回去
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 200, clientHeight: 580 })).toBe(false);
    // 恰好 60px：不算贴着底
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 640 })).toBe(false);
  });

  it("长会话只把可见的少数几行放进 DOM", () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    const messages = Array.from({ length: 300 }, (_, index) =>
      makeMessage({ id: `msg_${index}`, roomId: room.id, body: `第 ${index} 条` }),
    );
    const restoreViewport = stubLayout(600);
    try {
      const { container } = render(
        <RoomView
          room={room}
          employees={[employee]}
          messages={messages}
          streams={{}}
          running={{}}
          approvals={[]}
          onSend={async () => undefined}
          onResolveApproval={() => undefined}
          onAddMember={async () => undefined}
          onRemoveMember={async () => undefined}
          onDeleteRoom={() => undefined}
        />,
      );

      const rows = container.querySelectorAll(".msg-row");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(60);
    } finally {
      restoreViewport();
    }
  });

  it("正在工作的员工以流式行出现在列表里", () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    const restoreViewport = stubLayout(600);
    try {
      const { container } = render(
        <RoomView
          room={room}
          employees={[employee]}
          messages={[makeMessage({ roomId: room.id, body: "开始吧" })]}
          streams={{ [employee.id]: "正在写的字" }}
          running={{ [employee.id]: true }}
          approvals={[]}
          onSend={async () => undefined}
          onResolveApproval={() => undefined}
          onAddMember={async () => undefined}
          onRemoveMember={async () => undefined}
          onDeleteRoom={() => undefined}
        />,
      );

      const streamRow = container.querySelector(".msg-row.stream");
      expect(streamRow?.textContent).toContain("正在写的字");
      expect(streamRow?.textContent).toContain("小码");
    } finally {
      restoreViewport();
    }
  });

  it("滚动之后渲染的窗口跟着走，而不是一直停在开头", () => {
    installBridge();
    const employee = makeEmployee({ displayName: "小码" });
    const room = makeRoom({ memberIds: [employee.id] });
    const messages = Array.from({ length: 300 }, (_, index) =>
      makeMessage({ id: `msg_${index}`, roomId: room.id, body: `第 ${index} 条` }),
    );
    const restoreLayout = stubLayout(600);
    try {
      const { container } = render(
        <RoomView
          room={room}
          employees={[employee]}
          messages={messages}
          streams={{}}
          running={{}}
          approvals={[]}
          onSend={async () => undefined}
          onResolveApproval={() => undefined}
          onAddMember={async () => undefined}
          onRemoveMember={async () => undefined}
          onDeleteRoom={() => undefined}
        />,
      );
      const textsOf = (): string[] =>
        [...container.querySelectorAll(".msg-row")].map((row) => row.textContent ?? "");
      expect(textsOf().some((text) => text.includes("第 0 条"))).toBe(true);

      const scroller = container.querySelector(".messages") as HTMLElement;
      scroller.scrollTop = 10000;
      fireEvent.scroll(scroller);

      const after = textsOf();
      expect(after.some((text) => text.includes("第 0 条"))).toBe(false);
      expect(after.some((text) => text.includes("第 121 条"))).toBe(true);
    } finally {
      restoreLayout();
    }
  });
});
