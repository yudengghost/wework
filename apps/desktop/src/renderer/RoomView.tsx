import type { Employee, Message, Room } from "@wework/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useRef, useState } from "react";

import { api, type ApprovalEvent } from "./api";
import {
  AlertIcon,
  Avatar,
  DragHandle,
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

/** 离底部 60px 以内算「贴着底」：只有贴着底时才让新内容把视图拽下去。 */
export function isNearBottom(
  element: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 60,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

/**
 * 一次滚动事件之后还要不要「跟随底部」。
 *
 * 我们自己的贴底滚动也会触发 scroll 事件——那时候视图在底部，绝不能被当成
 * 「用户往上翻了」而关掉跟随（虚拟列表挂载时的内部滚动尤其容易踩这个坑）。
 */
export function followAfterScroll(
  element: { scrollHeight: number; scrollTop: number; clientHeight: number },
  programmaticTop: number,
): boolean {
  if (programmaticTop >= 0 && Math.abs(element.scrollTop - programmaticTop) < 2) return true;
  return isNearBottom(element);
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
  /** 消息记录读不出来时的原因；有值时给出「隔离坏行」的修复入口。 */
  transcriptError?: string | null;
  /** 修复动作本身；抛错会在界面里显示。 */
  onRepairTranscript?: () => Promise<void>;
}

const StreamRow = memo(function StreamRow({
  employeeId,
  name,
  text,
}: {
  employeeId: string;
  name: string;
  text: string;
}) {
  return (
    <div className="msg-row stream">
      <Avatar name={name} seed={employeeId} small />
      <div className="msg-col">
        <div className="msg-head">
          <span className="who">{name}</span>
          <span className="stream-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="bubble">{text || "正在思考…"}</div>
      </div>
    </div>
  );
});

interface MessageRowProps {
  mine: boolean;
  who: string;
  seed: string;
  createdAt: string;
  body: string;
  attachments: Message["attachments"];
  working: boolean;
}

/**
 * 单条消息。
 *
 * 用 memo 包起来是有意的：流式输出每来一小段都会让 RoomView 重渲染一次，
 * 而历史消息本身没变。不隔离的话，几百条历史会被反复重画。
 */
const MessageRow = memo(function MessageRow({
  mine,
  who,
  seed,
  createdAt,
  body,
  attachments,
  working,
}: MessageRowProps) {
  return (
    <div className={`msg-row${mine ? " mine" : ""}`}>
      <DragHandle />
      <Avatar name={mine ? "你" : who} seed={seed} small />
      <div className="msg-col">
        <div className="msg-head">
          <span className="who">{who}</span>
          <span>{createdAt.slice(11, 16)}</span>
          {working && <span className="tag ok">工作中</span>}
        </div>
        <div className="bubble">
          {body}
          {attachments.length > 0 && (
            <div className="bubble-files">
              {attachments.map((attachment) =>
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
});

export function RoomView(props: RoomViewProps) {
  const { room, employees, messages, streams, running, approvals } = props;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * 有新消息或流式增量时滚到底部，但只在用户本来就贴着底部时才滚——
   * 否则用户往回翻历史会被不断拽回去。
   */
  const streamLength = Object.values(streams).reduce((total, text) => total + text.length, 0);
  const streamingIds = Object.keys(streams);
  const rowCount = messages.length + streamingIds.length;

  // 长会话只把可见的几行放进 DOM：几千条历史全量挂载时，滚动与流式刷新都会发卡。
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => listRef.current,
    // 76 = 单行气泡 62 + 行距 14：先按这间房最常见的行高估，量到之后库会逐行修正。
    estimateSize: () => 76,
    overscan: 10,
  });

  const followBottomRef = useRef(true);
  const programmaticTopRef = useRef(-1);

  /**
   * 贴底：直接按 scrollHeight 落到底。
   *
   * 不使用虚拟列表的 scrollToIndex——它要求行已经量过，而挂载、切房间、流式首帧
   * 这些时刻都还没有；scrollHeight 则一直是本文的真实高度（定位层是全高的）。
   */
  const scrollToLatest = (): void => {
    const element = listRef.current;
    if (!element) return;
    // behavior: instant —— 流式每来一小段都做一次平滑滚动动画，又卡又飘。
    const before = element.scrollTop;
    element.scrollTo({ top: element.scrollHeight, behavior: "instant" });
    programmaticTopRef.current = element.scrollTop;
    // 虚拟列表只在 scroll 事件里重新读位置、重算窗口，而 programmatic 滚动不一定触发它
    // （窗口被遮挡时 Chromium 会扣下滚动事件）。位置真的变了就补一次通知，语义同浏览器。
    if (element.scrollTop !== before) element.dispatchEvent(new Event("scroll"));
  };

  // 换房间就重新贴底（组件会被复用，所以必须显式重置）。
  useEffect(() => {
    followBottomRef.current = true;
    scrollToLatest();
  }, [room.id]);

  useEffect(() => {
    if (!followBottomRef.current || rowCount === 0) return;
    scrollToLatest();
  }, [rowCount, streamLength]);

  const members = employees.filter((employee) => room.memberIds.includes(employee.id));
  const isDirect = room.kind === "direct";
  const directPartner = isDirect ? members[0] : undefined;
  const nonMembers = employees.filter((employee) => !room.memberIds.includes(employee.id));
  /** 房间里撞了名字的那些显示名：光看名字分不出谁是谁，补上 id 才选得对。 */
  const duplicateNames = new Set(
    members
      .map((employee) => employee.displayName)
      .filter((name, index, all) => all.indexOf(name) !== index),
  );
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
    const typed = draft;
    setDraft("");
    setPending([]);
    try {
      await props.onSend(body, files);
      setError(null);
    } catch (cause) {
      // 发送失败要把敲过的内容还回去，否则用户的话就凭空没了。
      setDraft(typed);
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

  const repairTranscript = async (): Promise<void> => {
    if (props.onRepairTranscript === undefined) return;
    try {
      await props.onRepairTranscript();
      setError(null);
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

      {props.transcriptError ? (
        <div className="transcript-error">
          <div className="grow">
            这个房间的消息记录读不出来：{props.transcriptError}
            <div className="sub">
              多半是某一行坏掉了。隔离这一行之后房间可以继续用，坏行会原样备份在数据目录里。
            </div>
          </div>
          {props.onRepairTranscript ? (
            <button className="primary" onClick={() => void repairTranscript()}>
              隔离坏行并重新加载
            </button>
          ) : null}
        </div>
      ) : null}

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
          followBottomRef.current = followAfterScroll(event.currentTarget, programmaticTopRef.current);
        }}
      >
        {rowCount === 0 && (
          <div className="empty">
            {isDirect
              ? `还没有聊过。直接说要 ${directPartner?.displayName ?? "这位员工"} 做什么就行。`
              : `还没有消息。用 @ 指派任务，例如 “@${members[0]?.displayName ?? "小码"} 帮我改个 bug”。`}
          </div>
        )}
        <div
          className="message-flow"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index;
            const message = messages[index];
            const employeeId = message ? "" : (streamingIds[index - messages.length] ?? "");
            return (
              <div
                key={message ? message.id : `stream:${employeeId}`}
                className="message-slot"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {/* 量高度的节点必须和 transform 分开：虚拟列表量的是元素自身，
                    而 transform 会污染它读到的位置，那样子项尺寸永远更新不了。 */}
                <div className="message-slot-inner" data-index={index} ref={virtualizer.measureElement}>
                {message ? (
                  <MessageRow
                    mine={message.sender.kind === "human"}
                    who={
                      message.sender.kind === "human"
                        ? "你"
                        : nameOf(message.sender.employeeId)
                    }
                    seed={
                      message.sender.kind === "human" ? "human" : message.sender.employeeId
                    }
                    createdAt={message.createdAt}
                    body={message.body}
                    attachments={message.attachments}
                    working={
                      message.sender.kind === "employee" &&
                      running[message.sender.employeeId] === true
                    }
                  />
                ) : (
                  <StreamRow
                    employeeId={employeeId}
                    name={nameOf(employeeId)}
                    text={streams[employeeId] ?? ""}
                  />
                )}
                </div>
              </div>
            );
          })}
        </div>
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
            {/* 招人申请里真正决定「招来的人能不能干活」的是模型与技能，单独摆出来给审批的人看。 */}
            {approval.kind === "hire" &&
              (approval.draft?.model || (approval.draft?.skills?.length ?? 0) > 0) && (
                <div className="hire-meta">
                  {approval.draft?.model && (
                    <span className="tag">模型 {approval.draft.model}</span>
                  )}
                  {(approval.draft?.skills ?? []).map((skill) => {
                    const missing = (approval.skillsUnknown ?? []).includes(skill);
                    return (
                      <span key={skill} className={missing ? "tag bad" : "tag"}>
                        {missing ? `技能缺失 ${skill}` : `技能 ${skill}`}
                      </span>
                    );
                  })}
                </div>
              )}
            {approval.kind === "hire" && approval.draft?.systemPrompt && (
              <div className="why">拟任职责：{approval.draft.systemPrompt}</div>
            )}
            {approval.kind === "hire" && (approval.draft?.installSkills?.length ?? 0) > 0 && (
              <div className="why">
                要安装的技能：{approval.draft?.installSkills?.join("、")}
                （批准后由应用装进技能目录，并给新同事启用）
              </div>
            )}
            {approval.kind === "hire" && approval.draft?.workspaceDir && (
              <div className="why">拟用工作目录：{approval.draft.workspaceDir}</div>
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
                {duplicateNames.has(employee.displayName) && (
                  <span className="sub"> · {employee.id}</span>
                )}
              </div>
            ))}
            <div
              onMouseDown={(event) => {
                event.preventDefault();
                setDraft((prev) => prev.replace(/@([^\s@]*)$/, "@all "));
              }}
            >
              <span className="avatar sm">全</span>
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
