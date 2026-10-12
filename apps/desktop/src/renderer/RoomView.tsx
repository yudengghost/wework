import type { Employee, Message, Room } from "@buddy/core";
import { useState } from "react";

import { api, type ApprovalEvent } from "./api";

interface RoomViewProps {
  room: Room;
  employees: Employee[];
  messages: Message[];
  streams: Record<string, string>;
  running: Record<string, boolean>;
  approvals: ApprovalEvent[];
  onSend: (body: string) => Promise<void>;
  onResolveApproval: (approvalId: string, approved: boolean) => void;
  onAddMember: (employeeId: string) => Promise<void>;
  onRemoveMember: (employeeId: string) => Promise<void>;
  onDeleteRoom: () => void;
}

export function RoomView(props: RoomViewProps) {
  const { room, employees, messages, streams, running, approvals } = props;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const members = employees.filter((employee) => room.memberIds.includes(employee.id));
  const isDirect = room.kind === "direct";
  const directPartner = isDirect ? members[0] : undefined;
  const nonMembers = employees.filter((employee) => !room.memberIds.includes(employee.id));
  const nameOf = (employeeId: string): string =>
    employees.find((employee) => employee.id === employeeId)?.displayName ?? employeeId;

  // 单聊只有一个人，@ 是多余的：直接不提供补全。
  const trailingMention = isDirect ? null : /@([^\s@]*)$/.exec(draft);
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
            {isDirect ? nameOf(directPartner?.id ?? "") : `${members.length} 名成员`}
          </span>
        </div>
        {streamingIds.length > 0 && <span className="tag ok">有员工正在工作</span>}
        {!isDirect && (
          <div className="member-add">
            <button onClick={() => setAddOpen((open) => !open)}>添加成员</button>
            {addOpen && (
              <div className="member-pop">
                {nonMembers.length === 0 ? (
                  <div className="sub" style={{ padding: "6px 10px" }}>
                    所有员工都已在房间里
                  </div>
                ) : (
                  nonMembers.map((employee) => (
                    <div
                      key={employee.id}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setAddOpen(false);
                        void props.onAddMember(employee.id);
                      }}
                    >
                      {employee.displayName}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <button className="danger" onClick={props.onDeleteRoom}>
          {isDirect ? "删除会话" : "解散群聊"}
        </button>
      </header>

      {!isDirect && (
        <div className="member-bar">
          {members.length === 0 && (
            <span className="sub">房间里还没有成员，点右上「添加成员」拉人进来。</span>
          )}
          {members.map((employee) => (
            <span key={employee.id} className="chip" title={employee.workspaceDir}>
              {employee.displayName}
              <button
                className="chip-x"
                title="移出房间"
                onClick={() => void props.onRemoveMember(employee.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            {isDirect
              ? `还没有聊过。直接说要 ${directPartner?.displayName ?? "这位员工"} 做什么就行。`
              : `还没有消息。用 @ 指派任务，例如 “@${members[0]?.displayName ?? "小码"} 帮我改个 bug”。`}
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
              placeholder={
                isDirect
                  ? `给 ${directPartner?.displayName ?? "员工"} 发消息…（Enter 发送，Shift+Enter 换行）`
                  : "输入消息，@ 员工指派任务；Enter 发送，Shift+Enter 换行"
              }
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
