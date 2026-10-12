import type { Employee, Message } from "@buddy/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ApprovalEvent, type Bootstrap } from "./api";
import { EmployeesPanel, SettingsPanel } from "./Panels";
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

  const createRoom = async () => {
    if (!boot) return;
    const name = window.prompt("房间名称", "新房间");
    if (!name) return;
    const room = await api.createRoom(name, boot.employees.map((employee) => employee.id));
    await reload();
    setSelectedRoomId(room.id);
  };

  const resolveApproval = async (approvalId: string, approved: boolean) => {
    await api.resolveApproval(approvalId, approved);
    setApprovals((prev) => prev.filter((item) => item.approvalId !== approvalId));
  };

  const selectedRoom = boot?.rooms.find((room) => room.id === selectedRoomId) ?? null;

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
          {boot.employees.length} 名员工 · {boot.rooms.length} 个房间
        </p>
        <div className="list">
          {boot.rooms.map((room) => (
            <div
              key={room.id}
              className={`list-item${room.id === selectedRoomId ? " active" : ""}`}
              onClick={() => setSelectedRoomId(room.id)}
            >
              <div>{room.name}</div>
              <div className="sub">{room.memberIds.length} 名成员</div>
            </div>
          ))}
          {boot.rooms.length === 0 && <p className="hint">还没有房间，先建一个。</p>}
        </div>
        <div className="sidebar-footer">
          <button onClick={() => void createRoom()}>新建房间</button>
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
            notices={notices}
            approvals={approvals.filter((item) => item.roomId === selectedRoom.id)}
            onSend={async (body) => {
              await api.send(selectedRoom.id, body);
            }}
            onResolveApproval={(id, approved) => void resolveApproval(id, approved)}
            onToggleMember={async (employeeId) => {
              const memberIds = selectedRoom.memberIds.includes(employeeId)
                ? selectedRoom.memberIds.filter((id) => id !== employeeId)
                : [...selectedRoom.memberIds, employeeId];
              await api.updateRoom(selectedRoom.id, { memberIds });
              await reload();
            }}
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
    </div>
  );
}
