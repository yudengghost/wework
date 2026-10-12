import type { Employee, Message, Room } from "@buddy/core";
import { useState } from "react";

import { api, type ApprovalEvent } from "./api";

interface RoomViewProps {
  room: Room;
  employees: Employee[];
  messages: Message[];
  streams: Record<string, string>;
  running: Record<string, boolean>;
  notices: string[];
  approvals: ApprovalEvent[];
  onSend: (body: string) => Promise<void>;
  onResolveApproval: (approvalId: string, approved: boolean) => void;
  onToggleMember: (employeeId: string) => Promise<void>;
}

export function RoomView(props: RoomViewProps) {
  const { room, employees, messages, streams, running, notices, approvals } = props;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const members = employees.filter((employee) => room.memberIds.includes(employee.id));
  const nameOf = (employeeId: string): string =>
    employees.find((employee) => employee.id === employeeId)?.displayName ?? employeeId;

  const trailingMention = /@([^\s@]*)$/.exec(draft);
  const suggestions =
    trailingMention === null
      ? []
      : members
          .filter((employee) =>
            employee.displayName
              .toLowerCase()
              .startsWith((trailingMention[1] ?? "").toLowerCase()),
          )
          .slice(0, 6);

  const insertMention = (displayName: string): void => {
    setDraft((prev) => prev.replace(/@([^\s@]*)$/, `@${displayName} `));
  };

  const submit = async (): Promise<void> => {
    const body = draft.trim();
    if (body === "") return;
    setDraft("");
    try {
      await props.onSend(body);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const streamingIds = Object.keys(streams);

  return (
    <>
      <header className="room-header">
        <div className="grow">
          <strong>{room.name}</strong>
          <span className="sub" style={{ color: "var(--muted)", marginLeft: 10 }}>
            {members.length} 名成员
          </span>
        </div>
        {streamingIds.length > 0 && <span className="tag ok">有员工正在工作</span>}
        {members.map((employee) => (
          <span key={employee.id} className="tag" title={employee.workspaceDir}>
            {employee.displayName}
          </span>
        ))}
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            {`还没有消息。用 @ 指派任务，例如 “@${members[0]?.displayName ?? "小码"} 帮我改个 bug”。`}
          </div>
        )}
        {messages.map((message) => {
          const mine = message.sender.kind === "human";
          const who =
            message.sender.kind === "human" ? "你" : nameOf(message.sender.employeeId);
          return (
            <div key={message.id} className={`msg${mine ? " mine" : ""}`}>
              <div className="who">
                {who}
                {running[message.sender.kind === "employee" ? message.sender.employeeId : ""]
                  ? " · 工作中"
                  : ""}
              </div>
              <div className="body">{message.body}</div>
            </div>
          );
        })}

        {streamingIds.map((employeeId) => (
          <div key={employeeId} className="msg stream">
            <div className="who">{nameOf(employeeId)} · 正在输出</div>
            <div className="body">{streams[employeeId] || "正在思考…"}</div>
          </div>
        ))}
      </div>

      {approvals.map((approval) => (
        <div key={approval.approvalId} className="approval">
          <div className="grow">
            <strong>{nameOf(approval.targetId)}</strong> 被 @ 了，需要你确认才继续
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{approval.summary}</div>
          </div>
          <button className="primary" onClick={() => props.onResolveApproval(approval.approvalId, true)}>
            允许
          </button>
          <button onClick={() => props.onResolveApproval(approval.approvalId, false)}>拒绝</button>
        </div>
      ))}

      {notices.map((notice, index) => (
        <div key={`${notice}-${index}`} className="notice">
          {notice}
        </div>
      ))}

      <div className="composer">
        {suggestions.length > 0 && (
          <div className="mentions">
            {suggestions.map((employee) => (
              <div
                key={employee.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(employee.displayName);
                }}
              >
                @{employee.displayName}
              </div>
            ))}
            <div
              onMouseDown={(event) => {
                event.preventDefault();
                setDraft((prev) => prev.replace(/@([^\s@]*)$/, "@all "));
              }}
            >
              @all 全体成员
            </div>
          </div>
        )}
        <div className="composer-row">
          <div className="grow">
            <textarea
              value={draft}
              placeholder="输入消息，@ 员工指派任务；Enter 发送，Shift+Enter 换行"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Tab" && suggestions.length > 0) {
                  event.preventDefault();
                  insertMention((suggestions[0] as Employee).displayName);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          <button className="primary" onClick={() => void submit()} disabled={draft.trim() === ""}>
            发送
          </button>
          <button
            onClick={() => {
              void api.stopAll();
            }}
          >
            停止
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </>
  );
}
