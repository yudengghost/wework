// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Employee, Message, Room } from "@buddy/core";

import type { ApprovalEvent } from "./api";
import { RoomView, type PendingFile } from "./RoomView";
import { installBridge, makeEmployee, makeMessage, makeRoom } from "./tests/support";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "buddy");
});

interface RoomOptions {
  employees?: Employee[];
  messages?: Message[];
  approvals?: ApprovalEvent[];
  onSend?: (body: string, files: PendingFile[]) => Promise<void>;
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
