import type {
  BuddyConfig,
  DeepPartial,
  Employee,
  Message,
  PermissionMode,
  Room,
  SkillInfo,
} from "@buddy/core";

export interface FrameworkStatus {
  status: "found" | "not-found";
  detail: string;
}

export interface Bootstrap {
  dataDir: string;
  bootstrapDir: string;
  config: BuddyConfig;
  employees: Employee[];
  removedEmployees: Employee[];
  rooms: Room[];
  frameworks: Record<string, FrameworkStatus>;
  skills: SkillInfo[];
}

export interface MemorySnapshot {
  count: number;
  pendingCount: number;
  facts: { id: string; kind: string; text: string; createdAt: string }[];
  pending: { id: string; text: string; createdAt: string; scope: string }[];
}

export interface RunEvent {
  kind: "started" | "text" | "finished" | "skipped";
  roomId: string;
  employeeId: string;
  runId?: string;
  delta?: string;
  ok?: boolean;
  error?: string;
  reason?: string;
}

export interface ApprovalEvent {
  approvalId: string;
  roomId: string;
  employeeId: string;
  targetId: string;
  summary: string;
}

export interface CreateEmployeePayload {
  displayName: string;
  framework: Employee["framework"];
  model?: string;
  systemPrompt?: string;
  skills?: string[];
  permissionMode: PermissionMode;
}

interface BuddyBridge {
  invoke<TResult>(channel: string, payload?: unknown): Promise<TResult>;
  onMessage(handler: (message: Message) => void): () => void;
  onRun(handler: (event: RunEvent) => void): () => void;
  onApproval(handler: (event: ApprovalEvent) => void): () => void;
}

declare global {
  interface Window {
    buddy: BuddyBridge;
  }
}

export const api = {
  bootstrap: () => window.buddy.invoke<Bootstrap>("app:bootstrap"),
  updateSettings: (patch: DeepPartial<BuddyConfig>) =>
    window.buddy.invoke<BuddyConfig>("settings:update", patch),
  probeLaunchers: () =>
    window.buddy.invoke<Record<string, FrameworkStatus>>("launcher:probe"),
  createEmployee: (payload: CreateEmployeePayload) =>
    window.buddy.invoke<Employee>("employee:create", payload),
  updateEmployee: (id: string, patch: Partial<CreateEmployeePayload>) =>
    window.buddy.invoke<Employee>("employee:update", { id, patch }),
  removeEmployee: (id: string) => window.buddy.invoke<boolean>("employee:remove", { id }),
  createRoom: (name: string, memberIds: string[], kind: "group" | "direct" = "group") =>
    window.buddy.invoke<Room>("room:create", { name, memberIds, kind }),
  directRoom: (employeeId: string) =>
    window.buddy.invoke<Room>("room:direct", { employeeId }),
  updateRoom: (id: string, patch: { name?: string; memberIds?: string[] }) =>
    window.buddy.invoke<Room>("room:update", { id, patch }),
  removeRoom: (id: string) => window.buddy.invoke<boolean>("room:remove", { id }),
  setRoomMember: (roomId: string, employeeId: string, member: boolean) =>
    window.buddy.invoke<Room>("room:member", { roomId, employeeId, member }),
  messages: (roomId: string) => window.buddy.invoke<Message[]>("room:messages", { roomId }),
  send: (roomId: string, body: string) =>
    window.buddy.invoke<Message>("room:send", { roomId, body }),
  stopAll: () => window.buddy.invoke<{ cancelled: number }>("run:stopAll"),
  resolveApproval: (approvalId: string, approved: boolean) =>
    window.buddy.invoke<boolean>("approval:resolve", { approvalId, approved }),
  skillsCatalog: () => window.buddy.invoke<SkillInfo[]>("skills:catalog"),
  memoryList: (employeeId: string) =>
    window.buddy.invoke<MemorySnapshot>("memory:list", { employeeId }),
  memoryClear: (employeeId: string) =>
    window.buddy.invoke<boolean>("memory:clear", { employeeId }),
  forgetFact: (employeeId: string, factId: string) =>
    window.buddy.invoke<boolean>("memory:forget", { employeeId, factId }),
  restoreEmployee: (id: string) => window.buddy.invoke<Employee>("employee:restore", { id }),
  purgeEmployee: (id: string) =>
    window.buddy.invoke<{ workspaceDir: string }>("employee:purge", { id }),
  relaunch: () => window.buddy.invoke<boolean>("app:relaunch"),
};
