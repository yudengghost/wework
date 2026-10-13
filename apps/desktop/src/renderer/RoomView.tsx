import type { Employee, Message, Room } from "@buddy/core";
import { useEffect, useRef, useState } from "react";

import { api, type ApprovalEvent } from "./api";
import {
  AlertIcon,
  Avatar,
  FileIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  StopIcon,
  TrashIcon,
} from "./ui";

export interface PendingFile {
  name: string;
  sourcePath: string;
}

/** 附件图片要用 file:// 显示；路径里的空格与 # ? 必须编码，否则链接会断。 */
function toFileUrl(path: string): string {
  return `file:///${encodeURI(path.replace(/\\/g, "/"))
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F")}`;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

interface RoomViewProps {
  room: Room;
  employees: Employee[];
  messages: Message[];
  streams: Record<string, string>;
  running: Record<string, boolean>;
  approvals: ApprovalEvent[];
  onSend: (body: string, files: PendingFile[]) => Promise<void>;
  onResolveApproval: (approvalId: string, approved: boolean) => void;
  onAddMember: (employeeId: string) => Promise<void>;
  onRemoveMember: (employeeId: string) => Promise<void>;
  onDeleteRoom: () => void;
  /** 房间里已经没有在册员工（例如员工已被移除）：只读，保留历史。 */
  readOnly?: boolean;
  /** 只读时提供的补救入口：新建员工并接续这段历史。 */
  onAdopt?: () => void;
}

export function RoomView(props: RoomViewProps) {
  const { room, employees, messages, streams, running, approvals } = props;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  /**
   * 有新消息或流式增量时滚到底部，但只在用户本来就贴着底部时才滚——
   * 否则用户往回翻历史会被不断拽回去。
   */
  const streamLength = Object.values(streams).reduce((total, text) => total + text.length, 0);
  useEffect(() => {
    const element = listRef.current;
    if (element && atBottomRef.current) element.scrollTop = element.scrollHeight;
  }, [messages.length, streamLength]);

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
    // 只带附件、不写字也应该能发出去。
    if (body === "" && pending.length === 0) return;
    const files = pending;
    setDraft("");
    setPending([]);
    try {
      await props.onSend(body, files);
      setError(null);
    } catch (cause) {
      setPending(files);
      setError(String(cause));
    }
  };

  const addPickedFiles = async (): Promise<void> => {
    try {
      const picked = await api.pickFiles();
      if (picked.length > 0) setPending((prev) => [...prev, ...picked]);
    } catch (cause) {
      setError(String(cause));
    }
  };

  /** 拖拽进来的文件只能靠 preload 的 webUtils 拿真实路径；拿不到就明确报错。 */
  const handleDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    setDragOver(false);
    const resolved = [...event.dataTransfer.files]
      .map((file) => {
        const sourcePath = api.pathForFile(file);
        return sourcePath === "" ? null : { name: file.name, sourcePath };
      })
      .filter((item): item is PendingFile => item !== null);

    if (resolved.length === 0) {
      setError("没能读到拖入文件的路径，请改用输入框左侧的回形针按钮选择文件。");
      return;
    }
    setPending((prev) => [...prev, ...resolved]);
  };

  const streamingIds = Object.keys(streams);

  return (
    <>
      <header className="room-header">
        <div className="grow">
          <div className="room-title">{room.name}</div>
          <div className="room-sub">
            {isDirect
              ? `${nameOf(directPartner?.id ?? "")} · ${directPartner?.framework ?? ""}`
              : `群聊 · ${members.length} 名成员`}
          </div>
        </div>
        {streamingIds.length > 0 && (
          <span className="live-badge">
            <span className="pulse" />
            正在工作
          </span>
        )}
        {!isDirect && (
          <div className="member-add">
            <button
              className="icon-btn"
              title="添加成员"
              onClick={() => setAddOpen((open) => !open)}
            >
              <PlusIcon size={17} />
            </button>
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
        <button
          className="icon-btn danger"
          title={isDirect ? "删除会话" : "解散群聊"}
          onClick={props.onDeleteRoom}
        >
          <TrashIcon size={17} />
        </button>
      </header>

      {!isDirect && (
        <div className="member-bar">
          {members.length === 0 && (
            <span className="sub">房间里还没有成员，点右上「添加成员」拉人进来。</span>
          )}
          {members.map((employee) => (
            <span key={employee.id} className="chip" title={employee.workspaceDir}>
              <Avatar name={employee.displayName} seed={employee.id} small />
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

      <div
        className="messages"
        ref={listRef}
        onDragOver={(event) => {
          if (props.readOnly) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={props.readOnly ? undefined : handleDrop}
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}
      >
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
          const seed =
            message.sender.kind === "human" ? "human" : message.sender.employeeId;
          const working =
            message.sender.kind === "employee" && running[message.sender.employeeId];
          return (
            <div key={message.id} className={`msg-row${mine ? " mine" : ""}`}>
              <Avatar name={mine ? "你" : who} seed={seed} small />
              <div className="msg-col">
                <div className="msg-head">
                  <span className="who">{who}</span>
                  <span>{message.createdAt.slice(11, 16)}</span>
                  {working && <span className="tag ok">工作中</span>}
                </div>
                <div className="bubble">
                  {message.body}
                  {message.attachments.length > 0 && (
                    <div className="bubble-files">
                      {message.attachments.map((attachment) =>
                        (attachment.mimeType ?? "").startsWith("image/") ? (
                          <img
                            key={attachment.id}
                            className="bubble-image"
                            src={toFileUrl(attachment.path)}
                            alt={attachment.name}
                            title={attachment.name}
                          />
                        ) : (
                          <span key={attachment.id} className="chip" title={attachment.path}>
                            <FileIcon />
                            {attachment.name}
                            <span className="tag">{formatSize(attachment.sizeBytes)}</span>
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {streamingIds.map((employeeId) => (
          <div key={employeeId} className="msg-row stream">
            <Avatar name={nameOf(employeeId)} seed={employeeId} small />
            <div className="msg-col">
              <div className="msg-head">
                <span className="who">{nameOf(employeeId)}</span>
                <span className="stream-dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div className="bubble">{streams[employeeId] || "正在思考…"}</div>
            </div>
          </div>
        ))}
      </div>

      {approvals.map((approval) => (
        <div key={approval.approvalId} className="approval">
          <AlertIcon size={17} />
          <div className="grow">
            {approval.kind === "hire" ? (
              <>
                <strong>{nameOf(approval.employeeId)}</strong> 申请招人：
                <strong>{approval.targetId}</strong>
              </>
            ) : (
              <>
                <strong>{nameOf(approval.targetId)}</strong> 被 @ 了，需要你确认才继续
              </>
            )}
            <div className="why">{approval.summary}</div>
            {approval.kind === "hire" && approval.draft?.systemPrompt && (
              <div className="why">拟任职责：{approval.draft.systemPrompt}</div>
            )}
          </div>
          <button className="primary" onClick={() => props.onResolveApproval(approval.approvalId, true)}>
            {approval.kind === "hire" ? "批准招人" : "允许"}
          </button>
          <button onClick={() => props.onResolveApproval(approval.approvalId, false)}>拒绝</button>
        </div>
      ))}

      <div className="composer">
        {props.readOnly && (
          <div className="readonly-hint">
            <div>
              房间里已经没有在册员工，这里只保留历史记录。
              {props.onAdopt
                ? "可以新建一名员工接续这段历史，也可以去「员工管理」恢复已移除的员工。"
                : ""}
            </div>
            {props.onAdopt && (
              <button className="primary" onClick={props.onAdopt}>
                新建员工并接续这段历史
              </button>
            )}
          </div>
        )}
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
                <Avatar name={employee.displayName} seed={employee.id} small />
                @{employee.displayName}
              </div>
            ))}
            <div
              onMouseDown={(event) => {
                event.preventDefault();
                setDraft((prev) => prev.replace(/@([^\s@]*)$/, "@all "));
              }}
            >
              <span className="avatar sm" style={{ background: "var(--surface-3)" }}>
                全
              </span>
              @all 全体成员
            </div>
          </div>
        )}
        {dragOver && (
          <div className="drop-hint">松开鼠标即可把这些文件加为附件</div>
        )}
        {pending.length > 0 && (
          <div className="pending-files">
            {pending.map((file, index) => (
              <span key={`${file.sourcePath}-${index}`} className="chip" title={file.sourcePath}>
                <FileIcon />
                {file.name}
                <button
                  className="chip-x"
                  title="移除"
                  onClick={() => setPending((prev) => prev.filter((_, at) => at !== index))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <div className="grow">
            <textarea
              value={draft}
              disabled={props.readOnly === true}
              placeholder={
                props.readOnly
                  ? "该员工已离开名册，无法继续对话"
                  : isDirect
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
          <button
            className="icon-btn"
            title="添加附件"
            disabled={props.readOnly === true}
            onClick={() => void addPickedFiles()}
          >
            <PaperclipIcon />
          </button>
          <button
            className="primary send-btn"
            title="发送（Enter）"
            onClick={() => void submit()}
            disabled={props.readOnly === true || draft.trim() === ""}
          >
            <SendIcon />
          </button>
          <button
            className="icon-btn"
            title="停止全部运行"
            onClick={() => {
              void api.stopAll();
            }}
          >
            <StopIcon size={17} />
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </>
  );
}
