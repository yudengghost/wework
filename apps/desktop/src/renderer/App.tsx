import type { Employee, Message } from "@buddy/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ApprovalEvent, type Bootstrap } from "./api";
import {
  ConfirmDialog,
  CreateRoomDialog,
  EmployeesPanel,
  SettingsPanel,
} from "./Panels";
import { RoomView } from "./RoomView";
import {
  AlertIcon,
  Avatar,
  EmptyState,
  GearIcon,
  PlusIcon,
  SparkIcon,
  StopIcon,
  UsersIcon,
} from "./ui";

type Panel = "none" | "employees" | "settings";

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [notices, setNotices] = useState<string[]>([]);
  const [approvals, setApprovals] = useState<ApprovalEvent[]>([]);
  const [panel, setPanel] = useState<Panel>("none");
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const roomRef = useRef<string | null>(null);
  const employeesRef = useRef<Employee[]>([]);
  employeesRef.current = boot?.employees ?? [];

  const labelOf = useCallback((employeeId: string): string => {
    return employeesRef.current.find((item) => item.id === employeeId)?.displayName ?? employeeId;
  }, []);

  const pushNotice = useCallback((text: string) => {
    setNotices((prev) => [...prev, text]);
    setTimeout(() => setNotices((prev) => prev.slice(1)), 6000);
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await api.bootstrap();
      setBoot(next);
      setSelectedRoomId((current) => current ?? next.rooms[0]?.id ?? null);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 主题：把配置里的偏好解析成实际主题并落到 <html data-theme>，CSS 据此换肤。
  const themePreference = boot?.config.ui.theme ?? "dark";
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = (): void => {
      const resolved =
        themePreference === "system" ? (media.matches ? "light" : "dark") : themePreference;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (themePreference !== "system") return undefined;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themePreference]);

  useEffect(() => {
    roomRef.current = selectedRoomId;
    if (!selectedRoomId) {
      setMessages([]);
      return;
    }
    void api
      .messages(selectedRoomId)
      .then(setMessages)
      .catch((cause) => setError(String(cause)));
  }, [selectedRoomId]);

  useEffect(() => {
    const offMessage = window.buddy.onMessage((message) => {
      if (message.roomId !== roomRef.current) return;
      setMessages((prev) =>
        prev.some((item) => item.id === message.id) ? prev : [...prev, message],
      );
    });

    const offRun = window.buddy.onRun((event) => {
      if (event.kind === "started") {
        setRunning((prev) => ({ ...prev, [event.employeeId]: true }));
        return;
      }
      if (event.kind === "text") {
        if (event.roomId !== roomRef.current) return;
        setStreams((prev) => ({
          ...prev,
          [event.employeeId]: `${prev[event.employeeId] ?? ""}${event.delta ?? ""}`,
        }));
        return;
      }
      if (event.kind === "finished") {
        setRunning((prev) => ({ ...prev, [event.employeeId]: false }));
        setStreams((prev) => {
          const next = { ...prev };
          delete next[event.employeeId];
          return next;
        });
        if (!event.ok) {
          pushNotice(`${labelOf(event.employeeId)} 运行失败：${event.error ?? "未知原因"}`);
        }
        if (event.roomId === roomRef.current) {
          void api.messages(event.roomId).then(setMessages);
        }
        return;
      }
      if (event.kind === "skipped") {
        pushNotice(`已跳过 ${labelOf(event.employeeId)}：${event.reason ?? ""}`);
      }
    });

    const offApproval = window.buddy.onApproval((event) => {
      setApprovals((prev) => [...prev, event]);
    });

    return () => {
      offMessage();
      offRun();
      offApproval();
    };
  }, [labelOf, pushNotice]);

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
  const streamingIds = Object.keys(streams);

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
            <SparkIcon size={16} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1>Buddy</h1>
            <div className="meta">
              {boot.employees.length} 名员工
              {streamingIds.length > 0 ? " · 有员工在工作中" : ""}
            </div>
          </div>
        </div>
        <div className="list">
          <section className="nav-section">
            <div className="nav-section-head">
              群聊
              <span className="count-pill">{groupRooms.length}</span>
            </div>
            {groupRooms.map((room) => (
              <div
                key={room.id}
                className={`list-item${room.id === selectedRoomId ? " active" : ""}`}
                onClick={() => setSelectedRoomId(room.id)}
              >
                <Avatar name={room.name} seed={room.id} small />
                <div className="row-main">
                  <div className="row-title">{room.name}</div>
                  <div className="row-sub">{room.memberIds.length} 名成员</div>
                </div>
              </div>
            ))}
            {groupRooms.length === 0 && (
              <div className="row-sub" style={{ padding: "4px 9px" }}>
                还没有群聊，点左下角 + 新建
              </div>
            )}
          </section>

          <section className="nav-section">
            <div className="nav-section-head">
              单聊
              <span className="count-pill">{boot.employees.length}</span>
            </div>
            {boot.employees.map((employee) => {
              const room = directRoomOf(employee.id);
              return (
                <div
                  key={employee.id}
                  className={`list-item${room && room.id === selectedRoomId ? " active" : ""}`}
                  onClick={() => openDirect(employee.id)}
                >
                  <Avatar name={employee.displayName} seed={employee.id} small />
                  <div className="row-main">
                    <div className="row-title">{employee.displayName}</div>
                    <div className="row-sub">
                      {employee.framework}
                      {room ? " · 有历史" : ""}
                    </div>
                  </div>
                </div>
              );
            })}
            {boot.employees.length === 0 && (
              <div className="row-sub" style={{ padding: "4px 9px" }}>
                先去「员工管理」创建一名员工
              </div>
            )}
          </section>
          {orphanRooms.length > 0 && (
            <section className="nav-section">
              <div className="nav-section-head">
                已离开
                <span className="count-pill">{orphanRooms.length}</span>
              </div>
              {orphanRooms.map(({ room, label }) => (
                <div
                  key={room.id}
                  className={`list-item${room.id === selectedRoomId ? " active" : ""}`}
                  onClick={() => setSelectedRoomId(room.id)}
                >
                  <Avatar name={label} seed={room.memberIds[0] ?? room.id} small />
                  <div className="row-main">
                    <div className="row-title">{label}</div>
                    <div className="row-sub">已离开名册 · 记录可查看</div>
                  </div>
                </div>
              ))}
            </section>
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
            streams={streams}
            running={running}
            approvals={approvals.filter((item) => item.roomId === selectedRoom.id)}
            onSend={async (body) => {
              await api.send(selectedRoom.id, body);
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
              setConfirmDelete({ id: selectedRoom.id, name: selectedRoom.name })
            }
            readOnly={!selectedRoom.memberIds.some((id) =>
              boot.employees.some((item) => item.id === id),
            )}
          />
        ) : (
          <EmptyState
            icon={<SparkIcon size={22} />}
            title={boot.employees.length === 0 ? "先创建一名员工" : "选一个会话开始"}
          >
            {boot.employees.length === 0 ? (
              <>
                员工是真正会干活的 agent——它能读写文件、执行命令。
                <br />
                左下角 <UsersIcon size={13} /> 进入员工管理，创建一名即可。
              </>
            ) : (
              <>
                点左侧「单聊」里的员工直接私聊，不需要 @；
                <br />
                或点左下角 <PlusIcon size={13} /> 建一个群聊，把多位员工拉进来协作。
              </>
            )}
          </EmptyState>
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
          {notices.map((notice, index) => (
            <div key={`${index}-${notice}`} className="toast">
              <AlertIcon size={15} />
              {notice}
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`确定要解散「${confirmDelete.name}」？`}
          body="房间与它的消息记录会被删除。员工本身、它们的工作目录与记忆都不受影响。"
          confirmLabel="解散"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            void api
              .removeRoom(target.id)
              .then(async () => {
                if (selectedRoomId === target.id) setSelectedRoomId(null);
                await reload();
                pushNotice(`已解散「${target.name}」`);
              })
              .catch((cause: unknown) => setError(String(cause)));
          }}
        />
      )}
    </div>
  );
}
