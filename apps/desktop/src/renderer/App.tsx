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

  if (!boot) {
    return (
      <div className="app">
        <div className="main">
          <div className="empty">{error ?? "正在加载…"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Buddy</h1>
        <p className="hint">
          {boot.employees.length} 名员工 · {groupRooms.length} 个群聊 · {directRooms.length} 个单聊
        </p>
        <div className="list">
          <div className="section-title">群聊</div>
          {groupRooms.map((room) => (
            <div
              key={room.id}
              className={`list-item${room.id === selectedRoomId ? " active" : ""}`}
              onClick={() => setSelectedRoomId(room.id)}
            >
              <div>{room.name}</div>
              <div className="sub">{room.memberIds.length} 名成员</div>
            </div>
          ))}
          {groupRooms.length === 0 && <p className="hint">还没有群聊，点下面「新建群聊」。</p>}

          <div className="section-title">单聊</div>
          {boot.employees.map((employee) => {
            const room = directRoomOf(employee.id);
            return (
              <div
                key={employee.id}
                className={`list-item${room && room.id === selectedRoomId ? " active" : ""}`}
                onClick={() => openDirect(employee.id)}
              >
                <div>{employee.displayName}</div>
                <div className="sub">
                  {employee.framework}
                  {room ? " · 有历史" : ""}
                </div>
              </div>
            );
          })}
          {boot.employees.length === 0 && (
            <p className="hint">先去「员工管理」创建一名员工。</p>
          )}
        </div>
        <div className="sidebar-footer">
          <button onClick={createRoom}>新建群聊</button>
          <button onClick={() => setPanel("employees")}>员工管理</button>
          <button onClick={() => setPanel("settings")}>设置</button>
          <button
            className="danger"
            onClick={() => {
              void api.stopAll().then((result) => pushNotice(`已停止 ${result.cancelled} 个运行`));
            }}
          >
            停止全部
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
          />
        ) : (
          <div className="empty">
            {boot.employees.length === 0
              ? "先在「员工管理」里创建一名员工，再新建房间开始对话。"
              : "左侧新建一个房间开始对话。"}
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
          {notices.map((notice, index) => (
            <div key={`${index}-${notice}`} className="toast">
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
