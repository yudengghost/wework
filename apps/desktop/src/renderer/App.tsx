import type { Employee, Message, RunTrace } from "@wework/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ApprovalEvent, type Bootstrap } from "./api";
import {
  AdoptDialog,
  ConfirmDialog,
  CreateRoomDialog,
  EmployeesPanel,
  SettingsPanel,
} from "./Panels";
import { RoomView } from "./RoomView";
import { isActive } from "./runActivity";
import {
  AlertIcon,
  Avatar,
  DragHandle,
  EmptyState,
  GearIcon,
  PlusIcon,
  Section,
  SparkIcon,
  StopIcon,
  UsersIcon,
  WeworkMark,
} from "./ui";

type Panel = "none" | "employees" | "settings";

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  /**
   * 运行轨迹是「员工在不在干活」唯一的真相来源。
   * 主进程持有它，这里只做展示——切换房间、重读界面都不会丢。
   */
  const [runs, setRuns] = useState<RunTrace[]>([]);
  /** 本地时钟：给轨迹计时用。只在有运行在跑时才走，闲时不产生任何重渲染。 */
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const noticeSeq = useRef(0);
  const noticeTimers = useRef<number[]>([]);
  const [approvals, setApprovals] = useState<ApprovalEvent[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("none");
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    name: string;
    kind: "group" | "direct";
  } | null>(null);
  const [adoptRoom, setAdoptRoom] = useState<{ id: string; name: string } | null>(null);

  const roomRef = useRef<string | null>(null);
  const employeesRef = useRef<Employee[]>([]);
  employeesRef.current = boot?.employees ?? [];

  const labelOf = useCallback((employeeId: string): string => {
    return employeesRef.current.find((item) => item.id === employeeId)?.displayName ?? employeeId;
  }, []);

  const pushNotice = useCallback((text: string) => {
    const id = (noticeSeq.current += 1);
    // 只保留最近几条；按 id 删除，确保移除的是超时的那一条而不是队首。
    setNotices((prev) => [...prev.slice(-3), { id, text }]);
    const timer = window.setTimeout(() => {
      setNotices((prev) => prev.filter((item) => item.id !== id));
      noticeTimers.current = noticeTimers.current.filter((entry) => entry !== timer);
    }, 6000);
    noticeTimers.current = [...noticeTimers.current, timer];
  }, []);

  // 卸载时清掉所有提示定时器，避免残留的 setTimeout 继续持有闭包。
  useEffect(
    () => () => {
      noticeTimers.current.forEach((timer) => window.clearTimeout(timer));
      noticeTimers.current = [];
    },
    [],
  );

  const reload = useCallback(async () => {
    try {
      const next = await api.bootstrap();
      setBoot(next);
      // 只在「当前选中的房间仍然存在」时保留选择，否则回到主页。
      // 之前会兜底选中 rooms[0]，导致没有员工时一进来就停在某个历史会话上。
      setSelectedRoomId((current) =>
        current && next.rooms.some((room) => room.id === current) ? current : null,
      );
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runsTimer = useRef<number | null>(null);

  /** 主进程是轨迹的唯一持有者，这里只负责把它取回来。 */
  const refreshRuns = useCallback(async () => {
    try {
      const next = await api.runs();
      setRuns(Array.isArray(next) ? next : []);
    } catch {
      // 轨迹取不到不该影响主流程：下一次运行事件会再试一遍。
    }
  }, []);

  /** 一个命令密集的员工可能连续发很多步，合并到 120ms 一次。 */
  const scheduleRunsRefresh = useCallback(() => {
    if (runsTimer.current !== null) return;
    runsTimer.current = window.setTimeout(() => {
      runsTimer.current = null;
      void refreshRuns();
    }, 120);
  }, [refreshRuns]);

  useEffect(() => {
    void refreshRuns();
    return () => {
      if (runsTimer.current !== null) window.clearTimeout(runsTimer.current);
    };
  }, [refreshRuns]);

  useEffect(() => {
    roomRef.current = selectedRoomId;
    if (!selectedRoomId) {
      setMessages([]);
      setTranscriptError(null);
      return;
    }
    void api
      .messages(selectedRoomId)
      .then((next) => {
        setMessages(next);
        setTranscriptError(null);
      })
      .catch((cause) => setTranscriptError(String(cause)));
  }, [selectedRoomId]);

  /** 隔离坏行后立刻重读，房间当场恢复可用。 */
  const repairTranscript = async (): Promise<void> => {
    const roomId = selectedRoomId;
    if (!roomId) return;
    const result = await api.repairRoom(roomId);
    setMessages(await api.messages(roomId));
    setTranscriptError(null);
    pushNotice(
      result.quarantined === 0
        ? "没有发现坏行，已重新读取"
        : `已隔离 ${result.quarantined} 行坏记录，保留 ${result.kept} 条消息；坏行备份在 ${result.backupPath ?? ""}`,
    );
  };

  useEffect(() => {
    const offMessage = window.wework.onMessage((message) => {
      if (message.roomId !== roomRef.current) return;
      setMessages((prev) =>
        prev.some((item) => item.id === message.id) ? prev : [...prev, message],
      );
    });

    const offRun = window.wework.onRun((event) => {
      // 任何一次运行状态变化都重取快照：排队、开跑、调工具、结束。
      // 合并到下一帧，避免一个命令密集的员工把 IPC 打满。
      if (event.kind !== "skipped") scheduleRunsRefresh();
      if (event.kind === "finished") {
        // 用户自己按的停止不算「失败」：房间与运行条都已经如实写了「已停止」，
        // 再弹一条红色警报只会让人以为程序出了问题。
        if (!event.ok && event.status !== "stopped") {
          pushNotice(`${labelOf(event.employeeId)} 运行失败：${event.error ?? "未知原因"}`);
        }
        return;
      }
      if (event.kind === "skipped") {
        pushNotice(`已跳过 ${labelOf(event.employeeId)}：${event.reason ?? ""}`);
      }
    });

    const offApproval = window.wework.onApproval((event) => {
      setApprovals((prev) => [...prev, event]);
    });

    return () => {
      offMessage();
      offRun();
      offApproval();
    };
  }, [labelOf, pushNotice, scheduleRunsRefresh]);

  const activeRuns = runs.filter(isActive);

  /**
   * 秒表只在真的有运行在跑时走。
   * 常量级开销，但避免闲时每秒白重渲染一次整个界面。
   */
  useEffect(() => {
    if (activeRuns.length === 0) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRuns.length]);

  const createRoom = (): void => setCreateRoomOpen(true);

  /** 点员工名即进入单聊；已存在则复用同一个房间。 */
  const openDirect = (employeeId: string): void => {
    void api
      .directRoom(employeeId)
      .then(async (room) => {
        await reload();
        setSelectedRoomId(room.id);
      })
      .catch((cause: unknown) => setError(String(cause)));
  };

  const resolveApproval = async (approvalId: string, approved: boolean) => {
    await api.resolveApproval(approvalId, approved);
    setApprovals((prev) => prev.filter((item) => item.approvalId !== approvalId));
  };

  const selectedRoom = boot?.rooms.find((room) => room.id === selectedRoomId) ?? null;
  const directRooms = boot?.rooms.filter((room) => room.kind === "direct") ?? [];
  const groupRooms = boot?.rooms.filter((room) => room.kind !== "direct") ?? [];
  const directRoomOf = (employeeId: string) =>
    directRooms.find((room) => room.memberIds[0] === employeeId);
  /** 有运行在跑的房间：侧栏据此显示一个小圆点，一眼看出谁在干活。 */
  const busyRoomIds = new Set(activeRuns.map((trace) => trace.roomId));

  const stopRun = (runId: string): void => {
    void api
      .stopRun(runId)
      .then(() => scheduleRunsRefresh())
      .catch((cause: unknown) => setError(String(cause)));
  };

  if (!boot) {
    return (
      <div className="app">
        <div className="main">
          <EmptyState icon={<SparkIcon size={22} />} title={error ?? "正在加载…"} />
        </div>
      </div>
    );
  }

  // 员工被移除后，它的一对一房间仍留在磁盘上；这里把它们列出来，
  // 否则会出现「房间能打开、但侧栏里找不到」的幽灵会话。
  const knownIds = new Set([...boot.employees, ...boot.removedEmployees].map((item) => item.id));
  const orphanRooms = directRooms
    .filter((room) => !room.memberIds.some((id) => knownIds.has(id)))
    .map((room) => ({
      room,
      label:
        boot.removedEmployees.find((item) => item.id === room.memberIds[0])?.displayName ??
        "已删除的员工",
    }));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="app-header">
          <div className="mark">
            <WeworkMark size={19} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1>Wework</h1>
            <div className="meta">
              {boot.employees.length} 名员工
              {activeRuns.length > 0 ? ` · ${activeRuns.length} 个运行进行中` : ""}
            </div>
          </div>
        </div>
        <div className="list">
          <Section title="群聊" count={groupRooms.length} storageKey="wework.section.groups">
            {groupRooms.map((room) => (
              <div
                key={room.id}
                className={`list-item${room.id === selectedRoomId ? " active" : ""}`}
                onClick={() => setSelectedRoomId(room.id)}
              >
                <DragHandle />
                <Avatar name={room.name} seed={room.id} small />
                <div className="row-main">
                  <div className="row-title">{room.name}</div>
                  <div className="row-sub">{room.memberIds.length} 名成员</div>
                </div>
                {busyRoomIds.has(room.id) && <span className="busy-dot" title="有员工正在干活" />}
              </div>
            ))}
            {groupRooms.length === 0 && (
              <div className="row-sub" style={{ padding: "4px 9px" }}>
                还没有群聊，点左下角 + 新建
              </div>
            )}
          </Section>

          <Section
            title="单聊"
            count={boot.employees.length}
            storageKey="wework.section.direct"
          >
            {boot.employees.map((employee) => {
              const room = directRoomOf(employee.id);
              return (
                <div
                  key={employee.id}
                  className={`list-item${room && room.id === selectedRoomId ? " active" : ""}`}
                  onClick={() => openDirect(employee.id)}
                >
                  <DragHandle />
                  <Avatar name={employee.displayName} seed={employee.id} small />
                  <div className="row-main">
                    <div className="row-title">{employee.displayName}</div>
                    <div className="row-sub">
                      {employee.framework}
                      {room ? " · 有历史" : ""}
                    </div>
                  </div>
                  {room !== undefined && busyRoomIds.has(room.id) && (
                    <span className="busy-dot" title="这位员工正在干活" />
                  )}
                </div>
              );
            })}
            {boot.employees.length === 0 && (
              <div className="row-sub" style={{ padding: "4px 9px" }}>
                先去「员工管理」创建一名员工
              </div>
            )}
          </Section>
          {orphanRooms.length > 0 && (
            <Section
              title="已离开"
              count={orphanRooms.length}
              storageKey="wework.section.archived"
            >
              {orphanRooms.map(({ room, label }) => (
                <div
                  key={room.id}
                  className={`list-item${room.id === selectedRoomId ? " active" : ""}`}
                  onClick={() => setSelectedRoomId(room.id)}
                >
                  <DragHandle />
                  <Avatar name={label} seed={room.memberIds[0] ?? room.id} small />
                  <div className="row-main">
                    <div className="row-title">{label}</div>
                    <div className="row-sub">已离开名册 · 记录可查看</div>
                  </div>
                </div>
              ))}
            </Section>
          )}
        </div>
        <div className="sidebar-footer">
          <button
            className="icon-btn accent"
            title="新建群聊"
            onClick={createRoom}
          >
            <PlusIcon />
          </button>
          <button
            className="icon-btn"
            title="员工管理"
            onClick={() => setPanel("employees")}
          >
            <UsersIcon />
          </button>
          <button className="icon-btn" title="设置" onClick={() => setPanel("settings")}>
            <GearIcon />
          </button>
          <div className="spacer" />
          <button
            className="icon-btn danger"
            title="停止全部运行"
            onClick={() => {
              void api.stopAll().then((result) => pushNotice(`已停止 ${result.cancelled} 个运行`));
            }}
          >
            <StopIcon />
          </button>
        </div>
      </aside>

      <main className="main">
        {selectedRoom ? (
          <RoomView
            room={selectedRoom}
            employees={boot.employees}
            messages={messages}
            runs={runs}
            nowMs={nowMs}
            onStopRun={stopRun}
            approvals={approvals.filter((item) => item.roomId === selectedRoom.id)}
            onSend={async (body, files) => {
              await api.send(selectedRoom.id, body, files);
            }}
            onResolveApproval={(id, approved) => void resolveApproval(id, approved)}
            onAddMember={async (employeeId) => {
              await api.setRoomMember(selectedRoom.id, employeeId, true);
              await reload();
            }}
            onRemoveMember={async (employeeId) => {
              await api.setRoomMember(selectedRoom.id, employeeId, false);
              await reload();
            }}
            onDeleteRoom={() =>
              setConfirmDelete({
                id: selectedRoom.id,
                name: selectedRoom.name,
                kind: selectedRoom.kind,
              })
            }
            readOnly={!selectedRoom.memberIds.some((id) =>
              boot.employees.some((item) => item.id === id),
            )}
            transcriptError={transcriptError}
            onRepairTranscript={repairTranscript}
            onAdopt={
              selectedRoom.memberIds.some((id) =>
                boot.employees.some((item) => item.id === id),
              )
                ? undefined
                : () => setAdoptRoom({ id: selectedRoom.id, name: selectedRoom.name })
            }
          />
        ) : (
          <div className="home">
            <div className="home-hero">
              <div className="mark lg">
                <WeworkMark size={28} />
              </div>
              <h2>Wework</h2>
              <p>
                本地多 Agent 协作。这里的员工是真正会干活的 agent——能读写文件、执行命令，
                各有一位独立的长期记忆。
              </p>
            </div>

            <div className="home-actions">
              <button className="primary" onClick={() => setPanel("employees")}>
                <UsersIcon size={16} />
                {boot.employees.length === 0 ? "创建第一名员工" : "员工管理"}
              </button>
              <button onClick={createRoom} disabled={boot.employees.length === 0}>
                <PlusIcon size={16} />
                新建群聊
              </button>
              <button onClick={() => setPanel("settings")}>
                <GearIcon size={16} />
                设置与主题
              </button>
            </div>

            <div className="home-stats">
              {(
                [
                  ["员工", boot.employees.length],
                  ["群聊", groupRooms.length],
                  ["单聊", directRooms.length],
                  ["技能", boot.skills.length],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="home-stat">
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <div className="home-row">
              {Object.entries(boot.frameworks).map(([name, status]) => (
                <span
                  key={name}
                  className={`tag ${status.status === "found" ? "ok" : "bad"}`}
                  title={status.detail}
                >
                  {name} {status.status === "found" ? "已就绪" : "未找到"}
                </span>
              ))}
            </div>

            <p className="home-hint">
              {boot.employees.length === 0
                ? "还没有员工。先创建一名：填个名字、选框架（下拉里会显示是否已就绪）就能开始。"
                : "单聊直接说需求就行，不需要 @；群聊里用 @名字 指派任务，员工之间也能互相 @ 接力。"}
            </p>
          </div>
        )}
        {error && <div className="notice">{error}</div>}
      </main>

      {panel === "employees" && (
        <EmployeesPanel
          boot={boot}
          onClose={() => setPanel("none")}
          onChanged={reload}
        />
      )}
      {panel === "settings" && (
        <SettingsPanel
          boot={boot}
          onClose={() => setPanel("none")}
          onChanged={reload}
        />
      )}
      {createRoomOpen && (
        <CreateRoomDialog
          employees={boot.employees}
          onCancel={() => setCreateRoomOpen(false)}
          onSubmit={(name, memberIds) => {
            setCreateRoomOpen(false);
            void api
              .createRoom(name, memberIds)
              .then(async (room) => {
                await reload();
                setSelectedRoomId(room.id);
              })
              .catch((cause: unknown) => setError(String(cause)));
          }}
        />
      )}

      {notices.length > 0 && (
        <div className="toasts">
          {notices.map((notice) => (
            <div key={notice.id} className="toast">
              <AlertIcon size={15} />
              {notice.text}
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          // 单聊房间的名字就是员工的名字，写「解散」会让人以为要删掉这个人——必须按类型分开措辞。
          title={
            confirmDelete.kind === "direct"
              ? `删除与「${confirmDelete.name}」的聊天记录？`
              : `确定要解散「${confirmDelete.name}」？`
          }
          body={
            confirmDelete.kind === "direct"
              ? "只会删掉这个会话的消息记录。员工本身、它的工作目录与长期记忆都不会动。"
              : "房间与它的消息记录会被删除。员工本身、它们的工作目录与记忆都不受影响。"
          }
          confirmLabel={confirmDelete.kind === "direct" ? "删除记录" : "解散"}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            void api
              .removeRoom(target.id)
              .then(async () => {
                if (selectedRoomId === target.id) setSelectedRoomId(null);
                await reload();
                pushNotice(
                  target.kind === "direct"
                    ? `已删除与「${target.name}」的聊天记录`
                    : `已解散「${target.name}」`,
                );
              })
              .catch((cause: unknown) => setError(String(cause)));
          }}
        />
      )}

      {adoptRoom && (
        <AdoptDialog
          roomName={adoptRoom.name}
          onCancel={() => setAdoptRoom(null)}
          onSubmit={(name, framework, mode) => {
            const target = adoptRoom;
            setAdoptRoom(null);
            void (async () => {
              const employee = await api.createEmployee({
                displayName: name,
                framework,
                permissionMode: mode,
              });
              await api.updateRoom(target.id, { memberIds: [employee.id] });
              await reload();
              pushNotice(`已创建「${name}」并接续这段历史`);
            })().catch((cause: unknown) => setError(String(cause)));
          }}
        />
      )}
    </div>
  );
}
