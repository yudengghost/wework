# Buddy 基础骨架与核心契约 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 npm workspaces 单仓骨架，并交付 `@wework/core` 的第一层：域模型、事件总线、文件存储、全局配置、员工/房间/消息存储，全部有单测覆盖、可无头运行。

**Architecture:** `packages/core` 是纯 Node TypeScript 包，不依赖 Electron、不依赖 UI。依赖方向单向向下：`domain`（叶子）← `storage` ← `config` ← `employee`/`room` ← `index`。所有跨层通信通过接口或事件，不允许反向 import。

**Tech Stack:** Node 20+ / TypeScript 5 / npm workspaces / vitest / zod。本计划零原生模块、零 Electron 依赖。

**依赖版本说明：** 下面的版本号是已知可用版本，不要改成 `latest`。装完后如果 npm 提示有更高版本，保持现有版本不变。

---

## 文件结构（本计划结束时的形态）

```
Buddy/
  package.json                          # workspace 根，脚本聚合
  tsconfig.base.json                    # 共享编译选项
  .gitignore
  .editorconfig
  packages/core/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts                          # 公共入口，唯一对外出口
      domain/schema.ts                  # 域模型 zod schema + 派生类型
      domain/ids.ts                     # 带前缀的 id 生成
      events/eventBus.ts                # 类型化事件总线
      storage/errors.ts                 # DataParseError 等共享错误
      storage/fileStore.ts              # TextFileStore 接口 + 文件实现
      config/schema.ts                  # 全局配置 schema + defaultConfig()
      config/merge.ts                   # deepMerge
      config/configStore.ts             # 加载/校验/合并/持久化
      employee/employeeStore.ts         # 员工 CRUD + 名字唯一
      room/roomStore.ts                 # 房间 CRUD
      room/messageLog.ts                # 每房间 JSONL 消息日志
    test/
      integration.test.ts               # 跨模块集成
      boundaries.test.ts                # 包边界守卫
```

单元测试与被测文件同目录、命名 `<name>.test.ts`；跨模块集成测试放 `test/`。

---

### Task 1: 仓库与 workspace 骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/index.test.ts`

- [ ] **Step 1: 写下第一个测试**

`packages/core/src/index.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { CORE_PACKAGE_NAME } from "./index";

describe("@wework/core", () => {
  it("对外暴露包名常量", () => {
    expect(CORE_PACKAGE_NAME).toBe("@wework/core");
  });
});
```

- [ ] **Step 2: 建仓库骨架文件**

`package.json`（仓库根）

```json
{
  "name": "buddy",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": {
    "node": ">=20.11"
  },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

`.gitignore`

```
node_modules/
dist/
out/
coverage/
*.log
.DS_Store
.env
.env.local
```

`.editorconfig`

```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```

`packages/core/package.json`

```json
{
  "name": "@wework/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "vitest.config.ts"]
}
```

`packages/core/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
```

`packages/core/src/index.ts`

```ts
export const CORE_PACKAGE_NAME = "@wework/core";
```

- [ ] **Step 3: 安装依赖**

Run（在 `E:\AIWorkSpace\Buddy`）：

```powershell
npm install
```

Expected: 退出码 0，根目录出现 `node_modules` 与 `package-lock.json`。

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected:

```text
 ✓ src/index.test.ts (1 test)
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] **Step 5: 类型检查**

Run：

```powershell
npm run typecheck -w @wework/core
```

Expected: 退出码 0，无输出。

- [ ] **Step 6: 提交**

```powershell
git add package.json tsconfig.base.json .gitignore .editorconfig packages/core
git commit -m "chore: scaffold npm workspaces and @wework/core with vitest"
```

---

### Task 2: 域模型与 ID 生成

**Files:**
- Create: `packages/core/src/domain/schema.ts`
- Create: `packages/core/src/domain/ids.ts`
- Test: `packages/core/src/domain/schema.test.ts`
- Test: `packages/core/src/domain/ids.test.ts`

说明：`runStateSchema` / `approvalRequestSchema` 在本计划里还没有消费者，但它们是 Plan 3/Plan 4 的接口契约，属于「一次定义、避免反复改动」的域模型整体，因此在此一次写完。

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/domain/schema.test.ts`

```ts
import { describe, expect, it } from "vitest";

import {
  employeeSchema,
  messageSchema,
  permissionPolicySchema,
  roomSchema,
  runStateSchema,
} from "./schema";

describe("permissionPolicySchema", () => {
  it("只给 mode 时补全三个数组默认值", () => {
    const policy = permissionPolicySchema.parse({ mode: "read-only" });

    expect(policy).toEqual({
      mode: "read-only",
      allowedTools: [],
      disallowedTools: [],
      requireApprovalFor: [],
    });
  });

  it("拒绝未知的权限模式", () => {
    expect(() => permissionPolicySchema.parse({ mode: "yolo" })).toThrow();
  });
});

describe("employeeSchema", () => {
  const base = {
    id: "emp_1",
    displayName: "小码",
    framework: "codex",
    workspaceDir: "C:/work/a",
    stateDir: "C:/state/a",
    permissions: { mode: "workspace-write" },
    createdAt: "2026-10-12T00:00:00.000Z",
  };

  it("接受最小合法员工并补全 skills", () => {
    const employee = employeeSchema.parse(base);

    expect(employee.skills).toEqual([]);
    expect(employee.model).toBeUndefined();
  });

  it("拒绝未注册的框架", () => {
    expect(() => employeeSchema.parse({ ...base, framework: "cursor" })).toThrow();
  });

  it("拒绝空 displayName", () => {
    expect(() => employeeSchema.parse({ ...base, displayName: "" })).toThrow();
  });
});

describe("messageSchema", () => {
  it("补全 mentions/attachments/kind 默认值", () => {
    const message = messageSchema.parse({
      id: "msg_1",
      roomId: "room_1",
      sender: { kind: "human" },
      body: "帮我看看这个 bug",
      createdAt: "2026-10-12T00:00:00.000Z",
    });

    expect(message.mentions).toEqual([]);
    expect(message.attachments).toEqual([]);
    expect(message.kind).toBe("chat");
  });

  it("区分 @员工 与 @all 两种 mention", () => {
    const message = messageSchema.parse({
      id: "msg_2",
      roomId: "room_1",
      sender: { kind: "employee", employeeId: "emp_1" },
      mentions: [{ kind: "employee", employeeId: "emp_2" }, { kind: "all" }],
      body: "@小测 @all 帮我看下",
      createdAt: "2026-10-12T00:00:00.000Z",
    });

    expect(message.mentions).toHaveLength(2);
    expect(message.sender).toEqual({ kind: "employee", employeeId: "emp_1" });
  });
});

describe("roomSchema", () => {
  it("policy 可省略", () => {
    const room = roomSchema.parse({
      id: "room_1",
      name: "默认房间",
      createdAt: "2026-10-12T00:00:00.000Z",
    });

    expect(room.memberIds).toEqual([]);
    expect(room.policy).toBeUndefined();
  });
});

describe("runStateSchema", () => {
  it("接受 awaiting-approval 变体并携带审批请求", () => {
    const state = runStateSchema.parse({
      status: "awaiting-approval",
      startedAt: "2026-10-12T00:00:00.000Z",
      request: {
        id: "appr_1",
        kind: "shell",
        summary: "执行 rm -rf build",
        createdAt: "2026-10-12T00:00:01.000Z",
      },
    });

    expect(state.status).toBe("awaiting-approval");
  });

  it("拒绝状态与字段不匹配的变体", () => {
    expect(() => runStateSchema.parse({ status: "done" })).toThrow();
  });
});
```

`packages/core/src/domain/ids.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { createId } from "./ids";

describe("createId", () => {
  it("带前缀且形态稳定", () => {
    expect(createId("emp")).toMatch(/^emp_[0-9a-f]{12}$/);
    expect(createId("room")).toMatch(/^room_[0-9a-f]{12}$/);
  });

  it("连续生成不重复", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId("msg")));

    expect(ids.size).toBe(1000);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— 报 `Cannot find module './schema'` 与 `Cannot find module './ids'`。

- [ ] **Step 3: 写实现**

`packages/core/src/domain/schema.ts`

```ts
import { z } from "zod";

export const frameworkSchema = z.enum(["codex", "claude-code", "builtin"]);
export type Framework = z.infer<typeof frameworkSchema>;

export const permissionModeSchema = z.enum(["read-only", "workspace-write", "full"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const mentionPolicySchema = z.enum(["auto", "confirm"]);
export type MentionPolicy = z.infer<typeof mentionPolicySchema>;

export const isoDateTimeSchema = z.string().min(1);

export const permissionPolicySchema = z.object({
  mode: permissionModeSchema,
  allowedTools: z.array(z.string()).default([]),
  disallowedTools: z.array(z.string()).default([]),
  requireApprovalFor: z.array(z.string()).default([]),
});
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const employeeSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  framework: frameworkSchema,
  workspaceDir: z.string().min(1),
  stateDir: z.string().min(1),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  skills: z.array(z.string()).default([]),
  permissions: permissionPolicySchema,
  sessionRef: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
});
export type Employee = z.infer<typeof employeeSchema>;

export const mentionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("employee"), employeeId: z.string().min(1) }),
  z.object({ kind: z.literal("all") }),
]);
export type Mention = z.infer<typeof mentionSchema>;

export const attachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const messageSenderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human") }),
  z.object({ kind: z.literal("employee"), employeeId: z.string().min(1) }),
]);
export type MessageSender = z.infer<typeof messageSenderSchema>;

export const messageKindSchema = z.enum(["chat", "system", "run-event"]);
export type MessageKind = z.infer<typeof messageKindSchema>;

export const messageSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  sender: messageSenderSchema,
  mentions: z.array(mentionSchema).default([]),
  replyTo: z.string().min(1).optional(),
  body: z.string(),
  attachments: z.array(attachmentSchema).default([]),
  kind: messageKindSchema.default("chat"),
  createdAt: isoDateTimeSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const roomPolicySchema = z.object({
  maxConcurrentRuns: z.number().int().positive().optional(),
  maxMentionDepth: z.number().int().nonnegative().optional(),
  employeeMentionsEmployee: mentionPolicySchema.optional(),
  employeeMentionsAll: mentionPolicySchema.optional(),
});
export type RoomPolicy = z.infer<typeof roomPolicySchema>;

export const roomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  memberIds: z.array(z.string().min(1)).default([]),
  policy: roomPolicySchema.optional(),
  createdAt: isoDateTimeSchema,
});
export type Room = z.infer<typeof roomSchema>;

export const approvalRequestSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1),
  details: z.string().optional(),
  createdAt: isoDateTimeSchema,
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const runStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("queued") }),
  z.object({ status: z.literal("running"), startedAt: isoDateTimeSchema }),
  z.object({
    status: z.literal("awaiting-approval"),
    startedAt: isoDateTimeSchema,
    request: approvalRequestSchema,
  }),
  z.object({
    status: z.literal("done"),
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema,
  }),
  z.object({
    status: z.literal("failed"),
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema,
    error: z.string(),
  }),
  z.object({
    status: z.literal("cancelled"),
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema,
  }),
]);
export type RunState = z.infer<typeof runStateSchema>;
```

`packages/core/src/domain/ids.ts`

```ts
import { randomUUID } from "node:crypto";

export const idPrefixes = ["emp", "room", "msg", "run", "appr", "att"] as const;
export type IdPrefix = (typeof idPrefixes)[number];

/** 生成形如 `emp_9f2c1a0b3d4e` 的短 id：前缀 + 12 位十六进制。 */
export function createId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected: PASS，`Test Files 3 passed`。

- [ ] **Step 5: 类型检查**

Run：

```powershell
npm run typecheck -w @wework/core
```

Expected: 退出码 0。

- [ ] **Step 6: 提交**

```powershell
git add packages/core/src/domain
git commit -m "feat(core): add domain schemas and prefixed id generation"
```

---

### Task 3: 类型化事件总线

**Files:**
- Create: `packages/core/src/events/eventBus.ts`
- Test: `packages/core/src/events/eventBus.test.ts`

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/events/eventBus.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";

import { EventBus } from "./eventBus";

interface TestEvents extends Record<string, unknown> {
  message: { id: string };
  tick: { n: number };
}

describe("EventBus", () => {
  it("把载荷投递给订阅者", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on("message", handler);
    bus.emit("message", { id: "msg_1" });

    expect(handler).toHaveBeenCalledWith({ id: "msg_1" });
  });

  it("on 返回的取消函数能退订", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    const off = bus.on("tick", handler);
    off();
    bus.emit("tick", { n: 1 });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount("tick")).toBe(0);
  });

  it("某个订阅者抛错不影响其它订阅者", () => {
    const onHandlerError = vi.fn();
    const bus = new EventBus<TestEvents>({ onHandlerError });
    const second = vi.fn();

    bus.on("message", () => {
      throw new Error("boom");
    });
    bus.on("message", second);

    bus.emit("message", { id: "msg_1" });

    expect(second).toHaveBeenCalledTimes(1);
    expect(onHandlerError).toHaveBeenCalledTimes(1);
    expect(onHandlerError.mock.calls[0]?.[1]).toBe("message");
  });

  it("订阅者在回调里退订不会破坏本次派发", () => {
    const bus = new EventBus<TestEvents>();
    const second = vi.fn();
    const off = bus.on("tick", () => off());

    bus.on("tick", second);
    bus.emit("tick", { n: 1 });

    expect(second).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("tick")).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— `Cannot find module './eventBus'`。

- [ ] **Step 3: 写实现**

`packages/core/src/events/eventBus.ts`

```ts
export type EventMap = Record<string, unknown>;

export interface EventBusOptions {
  /** 订阅者抛错时的回调；用于记录日志，避免错误被静默吞掉。 */
  onHandlerError?: (error: unknown, event: string) => void;
}

type AnyHandler = (payload: unknown) => void;

export class EventBus<E extends EventMap> {
  private readonly handlers = new Map<keyof E, Set<AnyHandler>>();

  constructor(private readonly options: EventBusOptions = {}) {}

  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set<AnyHandler>();
      this.handlers.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => this.off(event, handler);
  }

  off<K extends keyof E>(event: K, handler: (payload: E[K]) => void): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as AnyHandler);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // 快照派发：允许订阅者在回调中退订而不影响本轮。
    for (const handler of [...set]) {
      try {
        (handler as (value: E[K]) => void)(payload);
      } catch (error) {
        this.options.onHandlerError?.(error, String(event));
      }
    }
  }

  listenerCount<K extends keyof E>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected: PASS，`Test Files 4 passed`。

- [ ] **Step 5: 提交**

```powershell
git add packages/core/src/events
git commit -m "feat(core): add typed event bus with error isolation"
```

---

### Task 4: 文件存储

**Files:**
- Create: `packages/core/src/storage/errors.ts`
- Create: `packages/core/src/storage/fileStore.ts`
- Test: `packages/core/src/storage/fileStore.test.ts`

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/storage/fileStore.test.ts`

```ts
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileStore } from "./fileStore";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FileStore", () => {
  it("写入后能读回", async () => {
    const store = new FileStore();
    const file = join(root, "nested", "config.json");

    await store.write(file, "hello");

    expect(await store.read(file)).toBe("hello");
  });

  it("读取不存在的文件返回 null", async () => {
    const store = new FileStore();

    expect(await store.read(join(root, "missing.json"))).toBeNull();
  });

  it("重复写入覆盖旧内容且不留下临时文件", async () => {
    const store = new FileStore();
    const file = join(root, "a.json");

    await store.write(file, "v1");
    await store.write(file, "v2");

    expect(await store.read(file)).toBe("v2");
    expect(await readdir(root)).toEqual(["a.json"]);
  });

  it("appendLine 自动补换行并追加", async () => {
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");

    await store.appendLine(file, "one");
    await store.appendLine(file, "two\n");

    expect(await store.read(file)).toBe("one\ntwo\n");
  });

  it("listFiles 返回文件名并排序，目录不存在返回空数组", async () => {
    const store = new FileStore();
    await store.write(join(root, "dir", "b.txt"), "b");
    await store.write(join(root, "dir", "a.txt"), "a");

    expect(await store.listFiles(join(root, "dir"))).toEqual(["a.txt", "b.txt"]);
    expect(await store.listFiles(join(root, "nope"))).toEqual([]);
  });

  it("exists 与 remove 行为正确", async () => {
    const store = new FileStore();
    const file = join(root, "x.txt");

    expect(await store.exists(file)).toBe(false);
    await store.write(file, "x");
    expect(await store.exists(file)).toBe(true);
    await store.remove(file);
    expect(await store.exists(file)).toBe(false);
    await expect(store.remove(file)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— `Cannot find module './fileStore'`。

- [ ] **Step 3: 写实现**

`packages/core/src/storage/errors.ts`

```ts
export class DataParseError extends Error {
  constructor(message: string, readonly sourcePath?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataParseError";
  }
}
```

`packages/core/src/storage/fileStore.ts`

```ts
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface TextFileStore {
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  appendLine(path: string, line: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listFiles(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  ensureDir(dir: string): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export class FileStore implements TextFileStore {
  async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async read(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** 先写临时文件再 rename，避免进程中断留下半截文件。 */
  async write(path: string, contents: string): Promise<void> {
    await this.ensureDir(dirname(path));
    const tmpPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, contents, "utf8");
    await rename(tmpPath, path);
  }

  async appendLine(path: string, line: string): Promise<void> {
    await this.ensureDir(dirname(path));
    const normalized = line.endsWith("\n") ? line : `${line}\n`;
    await appendFile(path, normalized, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected: PASS，`Test Files 5 passed`。

- [ ] **Step 5: 提交**

```powershell
git add packages/core/src/storage
git commit -m "feat(core): add atomic file store behind TextFileStore interface"
```

---

### Task 5: 全局配置 schema 与默认值

**Files:**
- Create: `packages/core/src/config/schema.ts`
- Test: `packages/core/src/config/schema.test.ts`

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/config/schema.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { buddyConfigSchema, defaultConfig } from "./schema";

describe("defaultConfig", () => {
  it("给出完整的默认配置", () => {
    expect(defaultConfig()).toEqual({
      version: 1,
      launchers: {
        codex: { executablePath: null, detectWsl: false },
        "claude-code": { executablePath: null, detectWsl: false },
      },
      scheduler: {
        maxConcurrentRuns: 3,
        maxRunsPerTurn: 5,
        maxTotalRunsPerRoom: 50,
        maxMentionDepth: 3,
        dedupeWindowMs: 5000,
        wallClockBudgetMs: 600000,
        contextWindowMessages: 50,
      },
      policy: {
        employeeMentionsEmployee: "auto",
        employeeMentionsAll: "confirm",
        humanMentionsEmployee: "auto",
        defaultPermissionMode: "workspace-write",
      },
      builtinAgent: { baseUrl: null, apiKey: null, model: null },
      ui: { language: "zh-CN", showEmployeeThinking: false },
    });
  });

  it("每次调用返回互不共享的对象", () => {
    const first = defaultConfig();
    first.scheduler.maxConcurrentRuns = 99;

    expect(defaultConfig().scheduler.maxConcurrentRuns).toBe(3);
  });
});

describe("buddyConfigSchema", () => {
  it("部分输入被补全为完整配置", () => {
    const config = buddyConfigSchema.parse({
      policy: { employeeMentionsAll: "auto" },
    });

    expect(config.policy.employeeMentionsAll).toBe("auto");
    expect(config.policy.employeeMentionsEmployee).toBe("auto");
    expect(config.scheduler.maxConcurrentRuns).toBe(3);
  });

  it("拒绝非法的策略枚举值", () => {
    expect(() =>
      buddyConfigSchema.parse({ policy: { employeeMentionsEmployee: "maybe" } }),
    ).toThrow();
  });

  it("丢弃未知字段", () => {
    const config: unknown = buddyConfigSchema.parse({ unknownField: 1 });

    expect((config as Record<string, unknown>).unknownField).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— `Cannot find module './schema'`。

- [ ] **Step 3: 写实现**

`packages/core/src/config/schema.ts`

```ts
import { z } from "zod";

import { mentionPolicySchema, permissionModeSchema } from "../domain/schema";

export const launcherSettingsSchema = z.object({
  executablePath: z.string().min(1).nullable().default(null),
  detectWsl: z.boolean().default(false),
});
export type LauncherSettings = z.infer<typeof launcherSettingsSchema>;

export const schedulerSettingsSchema = z.object({
  maxConcurrentRuns: z.number().int().positive().default(3),
  maxRunsPerTurn: z.number().int().positive().default(5),
  maxTotalRunsPerRoom: z.number().int().positive().default(50),
  maxMentionDepth: z.number().int().nonnegative().default(3),
  dedupeWindowMs: z.number().int().nonnegative().default(5000),
  wallClockBudgetMs: z.number().int().positive().default(600000),
  contextWindowMessages: z.number().int().positive().default(50),
});
export type SchedulerSettings = z.infer<typeof schedulerSettingsSchema>;

export const policySettingsSchema = z.object({
  employeeMentionsEmployee: mentionPolicySchema.default("auto"),
  employeeMentionsAll: mentionPolicySchema.default("confirm"),
  humanMentionsEmployee: mentionPolicySchema.default("auto"),
  defaultPermissionMode: permissionModeSchema.default("workspace-write"),
});
export type PolicySettings = z.infer<typeof policySettingsSchema>;

export const builtinAgentSettingsSchema = z.object({
  baseUrl: z.string().min(1).nullable().default(null),
  apiKey: z.string().min(1).nullable().default(null),
  model: z.string().min(1).nullable().default(null),
});
export type BuiltinAgentSettings = z.infer<typeof builtinAgentSettingsSchema>;

export const uiSettingsSchema = z.object({
  language: z.string().min(1).default("zh-CN"),
  showEmployeeThinking: z.boolean().default(false),
});
export type UiSettings = z.infer<typeof uiSettingsSchema>;

export const buddyConfigSchema = z.object({
  version: z.literal(1).default(1),
  launchers: z
    .object({
      codex: launcherSettingsSchema.default({}),
      "claude-code": launcherSettingsSchema.default({}),
    })
    .default({}),
  scheduler: schedulerSettingsSchema.default({}),
  policy: policySettingsSchema.default({}),
  builtinAgent: builtinAgentSettingsSchema.default({}),
  ui: uiSettingsSchema.default({}),
});
export type WeworkConfig = z.infer<typeof buddyConfigSchema>;

export function defaultConfig(): WeworkConfig {
  return buddyConfigSchema.parse({});
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected: PASS，`Test Files 6 passed`。

- [ ] **Step 5: 提交**

```powershell
git add packages/core/src/config
git commit -m "feat(core): add global config schema with defaults"
```

---

### Task 6: 配置合并与 ConfigStore

**Files:**
- Create: `packages/core/src/config/merge.ts`
- Create: `packages/core/src/config/configStore.ts`
- Test: `packages/core/src/config/merge.test.ts`
- Test: `packages/core/src/config/configStore.test.ts`

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/config/merge.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { deepMerge } from "./merge";

describe("deepMerge", () => {
  it("递归合并嵌套对象", () => {
    const base = { a: { x: 1, y: 2 }, b: 1 };

    expect(deepMerge(base, { a: { y: 9 } })).toEqual({ a: { x: 1, y: 9 }, b: 1 });
  });

  it("数组整体替换而不是拼接", () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] });
  });

  it("忽略 undefined 值，不覆盖既有配置", () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: undefined })).toEqual({ a: 1, b: 2 });
  });

  it("patch 为 null 时整体替换", () => {
    expect(deepMerge({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
  });

  it("不修改传入对象", () => {
    const base = { a: { x: 1 } };

    deepMerge(base, { a: { x: 2 } });

    expect(base.a.x).toBe(1);
  });
});
```

`packages/core/src/config/configStore.test.ts`

```ts
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileStore } from "../storage/fileStore";
import { DataParseError } from "../storage/errors";
import { ConfigNotLoadedError, ConfigStore } from "./configStore";
import { defaultConfig } from "./schema";

let root: string;
let filePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-config-"));
  filePath = join(root, "config.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeStore(): ConfigStore {
  return new ConfigStore(new FileStore(), filePath);
}

describe("ConfigStore.load", () => {
  it("文件不存在时返回默认配置", async () => {
    const store = makeStore();

    expect(await store.load()).toEqual(defaultConfig());
  });

  it("文件缺字段时与默认值合并", async () => {
    await writeFile(filePath, JSON.stringify({ policy: { employeeMentionsAll: "auto" } }), "utf8");
    const store = makeStore();

    const config = await store.load();

    expect(config.policy.employeeMentionsAll).toBe("auto");
    expect(config.scheduler.maxConcurrentRuns).toBe(3);
  });

  it("非法 JSON 抛出 DataParseError 而不是静默重置", async () => {
    await writeFile(filePath, "{ not json", "utf8");

    await expect(makeStore().load()).rejects.toBeInstanceOf(DataParseError);
  });

  it("字段校验失败抛出 DataParseError", async () => {
    await writeFile(filePath, JSON.stringify({ scheduler: { maxConcurrentRuns: -1 } }), "utf8");

    await expect(makeStore().load()).rejects.toBeInstanceOf(DataParseError);
  });
});

describe("ConfigStore.get / update", () => {
  it("未加载就 get 会抛 ConfigNotLoadedError", () => {
    expect(() => makeStore().get()).toThrow(ConfigNotLoadedError);
  });

  it("update 合并、校验并落盘", async () => {
    const store = makeStore();
    await store.load();

    await store.update({ policy: { employeeMentionsEmployee: "confirm" } });

    const reloaded = await makeStore().load();
    expect(reloaded.policy.employeeMentionsEmployee).toBe("confirm");
    expect(reloaded.policy.employeeMentionsAll).toBe("confirm");
  });

  it("update 传入的 undefined 不覆盖既有值", async () => {
    const store = makeStore();
    await store.load();
    await store.update({ ui: { language: "en-US" } });

    await store.update({ ui: { language: undefined } });

    expect(store.get().ui.language).toBe("en-US");
  });

  it("update 非法值被拒绝且不落盘", async () => {
    const store = makeStore();
    await store.load();

    await expect(
      store.update({ scheduler: { maxConcurrentRuns: 0 as unknown as number } }),
    ).rejects.toBeTruthy();

    expect(store.get().scheduler.maxConcurrentRuns).toBe(3);
  });

  it("落盘后目录里没有残留临时文件", async () => {
    const store = makeStore();
    await store.load();
    await store.update({ ui: { language: "en-US" } });

    expect(await readdir(root)).toEqual(["config.json"]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— `Cannot find module './merge'` / `Cannot find module './configStore'`。

- [ ] **Step 3: 写实现**

`packages/core/src/config/merge.ts`

```ts
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * 递归合并：对象逐层合并，数组与其它类型整体替换，`undefined` 视为「不修改」。
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result as T;
}
```

`packages/core/src/config/configStore.ts`

```ts
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";
import { deepMerge } from "./merge";
import { buddyConfigSchema, defaultConfig, type WeworkConfig } from "./schema";

export class ConfigNotLoadedError extends Error {
  constructor(message = "配置尚未加载，请先调用 load()") {
    super(message);
    this.name = "ConfigNotLoadedError";
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export class ConfigStore {
  private current: WeworkConfig | null = null;

  constructor(
    private readonly store: TextFileStore,
    private readonly filePath: string,
  ) {}

  async load(): Promise<WeworkConfig> {
    const raw = await this.store.read(this.filePath);
    if (raw === null) {
      this.current = defaultConfig();
      return this.current;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new DataParseError("配置文件不是合法 JSON", this.filePath, error);
    }

    const parsed = buddyConfigSchema.safeParse(deepMerge(defaultConfig(), json));
    if (!parsed.success) {
      throw new DataParseError(`配置校验失败: ${parsed.error.message}`, this.filePath);
    }

    this.current = parsed.data;
    return this.current;
  }

  get(): WeworkConfig {
    if (!this.current) throw new ConfigNotLoadedError();
    return this.current;
  }

  async update(patch: DeepPartial<WeworkConfig>): Promise<WeworkConfig> {
    if (!this.current) throw new ConfigNotLoadedError();
    const merged = buddyConfigSchema.parse(deepMerge(this.current, patch));
    this.current = merged;
    await this.persist();
    return merged;
  }

  async persist(): Promise<void> {
    if (!this.current) throw new ConfigNotLoadedError();
    await this.store.write(this.filePath, `${JSON.stringify(this.current, null, 2)}\n`);
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected: PASS，`Test Files 8 passed`。

- [ ] **Step 5: 类型检查**

Run：

```powershell
npm run typecheck -w @wework/core
```

Expected: 退出码 0。

- [ ] **Step 6: 提交**

```powershell
git add packages/core/src/config
git commit -m "feat(core): add deep merge and ConfigStore with atomic persistence"
```

---

### Task 7: 员工存储

**Files:**
- Create: `packages/core/src/employee/employeeStore.ts`
- Test: `packages/core/src/employee/employeeStore.test.ts`

说明：`displayName` 唯一性（大小写不敏感）是 @ 解析的前提条件，因此校验放在这一层。

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/employee/employeeStore.test.ts`

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DataParseError } from "../storage/errors";
import { FileStore } from "../storage/fileStore";
import {
  EmployeeNameConflictError,
  EmployeeNotFoundError,
  EmployeeStore,
  type NewEmployeeInput,
} from "./employeeStore";

let root: string;
let filePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-employee-"));
  filePath = join(root, "employees.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function input(overrides: Partial<NewEmployeeInput> = {}): NewEmployeeInput {
  return {
    displayName: "小码",
    framework: "codex",
    workspaceDir: "C:/work/xiaoma",
    stateDir: "C:/state/xiaoma",
    permissions: { mode: "workspace-write" },
    skills: [],
    ...overrides,
  };
}

async function makeLoadedStore(): Promise<EmployeeStore> {
  const store = new EmployeeStore(new FileStore(), filePath);
  await store.load();
  return store;
}

describe("EmployeeStore", () => {
  it("文件不存在时是空名单", async () => {
    const store = await makeLoadedStore();

    expect(store.list()).toEqual([]);
  });

  it("创建的员工带 id 与 createdAt，并落盘", async () => {
    const store = await makeLoadedStore();

    const created = await store.create(input());

    expect(created.id).toMatch(/^emp_[0-9a-f]{12}$/);
    expect(created.createdAt).toBeTruthy();
    expect((await makeLoadedStore()).list()).toHaveLength(1);
  });

  it("同框架可以创建多个互相独立的员工", async () => {
    const store = await makeLoadedStore();

    const a = await store.create(input({ displayName: "小码" }));
    const b = await store.create(input({ displayName: "小码二号" }));

    expect(a.id).not.toBe(b.id);
    expect(store.list()).toHaveLength(2);
  });

  it("displayName 大小写不敏感地唯一", async () => {
    const store = await makeLoadedStore();
    await store.create(input({ displayName: "Reviewer" }));

    await expect(store.create(input({ displayName: "reviewer" }))).rejects.toBeInstanceOf(
      EmployeeNameConflictError,
    );
  });

  it("getByName 大小写不敏感", async () => {
    const store = await makeLoadedStore();
    const created = await store.create(input({ displayName: "Reviewer" }));

    expect(store.getByName("REVIEWER")?.id).toBe(created.id);
    expect(store.getByName("nobody")).toBeUndefined();
  });

  it("update 改名字时仍做唯一性校验", async () => {
    const store = await makeLoadedStore();
    await store.create(input({ displayName: "甲" }));
    const second = await store.create(input({ displayName: "乙" }));

    await expect(store.update(second.id, { displayName: "甲" })).rejects.toBeInstanceOf(
      EmployeeNameConflictError,
    );
  });

  it("update 自己保持原名不报冲突", async () => {
    const store = await makeLoadedStore();
    const created = await store.create(input({ displayName: "甲" }));

    const updated = await store.update(created.id, { displayName: "甲", model: "gpt-5" });

    expect(updated.model).toBe("gpt-5");
  });

  it("update 不存在的员工抛 EmployeeNotFoundError", async () => {
    const store = await makeLoadedStore();

    await expect(store.update("emp_missing", { displayName: "x" })).rejects.toBeInstanceOf(
      EmployeeNotFoundError,
    );
  });

  it("remove 后从名单与磁盘消失", async () => {
    const store = await makeLoadedStore();
    const created = await store.create(input());

    await store.remove(created.id);

    expect(store.get(created.id)).toBeUndefined();
    expect((await makeLoadedStore()).list()).toEqual([]);
  });

  it("remove 不存在的员工抛 EmployeeNotFoundError", async () => {
    const store = await makeLoadedStore();

    await expect(store.remove("emp_missing")).rejects.toBeInstanceOf(EmployeeNotFoundError);
  });

  it("损坏的员工文件抛 DataParseError", async () => {
    const store = new EmployeeStore(new FileStore(), filePath);
    await store.load();
    await store.create(input());
    const file = new FileStore();
    await file.write(filePath, "[{\"id\":\"emp_1\"}]");

    await expect(makeLoadedStore()).rejects.toBeInstanceOf(DataParseError);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— `Cannot find module './employeeStore'`。

- [ ] **Step 3: 写实现**

`packages/core/src/employee/employeeStore.ts`

```ts
import { z } from "zod";

import { createId } from "../domain/ids";
import { employeeSchema, type Employee } from "../domain/schema";
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

export class EmployeeNameConflictError extends Error {
  constructor(displayName: string) {
    super(`员工名已被占用: ${displayName}`);
    this.name = "EmployeeNameConflictError";
  }
}

export class EmployeeNotFoundError extends Error {
  constructor(employeeId: string) {
    super(`员工不存在: ${employeeId}`);
    this.name = "EmployeeNotFoundError";
  }
}

/**
 * 用 z.input 而不是派生后的输出类型：默认值字段（如 permissions.allowedTools、skills）
 * 在输入侧是可选的，这样调用方不必把默认值全部写一遍。
 */
export type NewEmployeeInput = Omit<z.input<typeof employeeSchema>, "id" | "createdAt">;

const employeeListSchema = z.array(employeeSchema);

export class EmployeeStore {
  private employees: Employee[] = [];

  constructor(
    private readonly store: TextFileStore,
    private readonly filePath: string,
  ) {}

  async load(): Promise<Employee[]> {
    const raw = await this.store.read(this.filePath);
    if (raw === null) {
      this.employees = [];
      return this.list();
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new DataParseError("员工文件不是合法 JSON", this.filePath, error);
    }

    const parsed = employeeListSchema.safeParse(json);
    if (!parsed.success) {
      throw new DataParseError(`员工文件校验失败: ${parsed.error.message}`, this.filePath);
    }

    this.employees = parsed.data;
    return this.list();
  }

  list(): Employee[] {
    return [...this.employees];
  }

  get(employeeId: string): Employee | undefined {
    return this.employees.find((employee) => employee.id === employeeId);
  }

  getByName(displayName: string): Employee | undefined {
    const needle = displayName.trim().toLowerCase();
    return this.employees.find((employee) => employee.displayName.toLowerCase() === needle);
  }

  async create(input: NewEmployeeInput): Promise<Employee> {
    this.assertNameAvailable(input.displayName);
    const employee = employeeSchema.parse({
      ...input,
      id: createId("emp"),
      createdAt: new Date().toISOString(),
    });
    this.employees.push(employee);
    await this.persist();
    return employee;
  }

  async update(employeeId: string, patch: Partial<NewEmployeeInput>): Promise<Employee> {
    const index = this.employees.findIndex((employee) => employee.id === employeeId);
    if (index === -1) throw new EmployeeNotFoundError(employeeId);

    const current = this.employees[index] as Employee;
    if (patch.displayName !== undefined && patch.displayName !== current.displayName) {
      this.assertNameAvailable(patch.displayName, employeeId);
    }

    const updated = employeeSchema.parse({ ...current, ...patch });
    this.employees[index] = updated;
    await this.persist();
    return updated;
  }

  async remove(employeeId: string): Promise<void> {
    const index = this.employees.findIndex((employee) => employee.id === employeeId);
    if (index === -1) throw new EmployeeNotFoundError(employeeId);
    this.employees.splice(index, 1);
    await this.persist();
  }

  private assertNameAvailable(displayName: string, exceptEmployeeId?: string): void {
    const existing = this.getByName(displayName);
    if (existing && existing.id !== exceptEmployeeId) {
      throw new EmployeeNameConflictError(displayName);
    }
  }

  private async persist(): Promise<void> {
    await this.store.write(this.filePath, `${JSON.stringify(this.employees, null, 2)}\n`);
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected: PASS，`Test Files 9 passed`。

- [ ] **Step 5: 提交**

```powershell
git add packages/core/src/employee
git commit -m "feat(core): add employee store with unique display names"
```

---

### Task 8: 房间存储

**Files:**
- Create: `packages/core/src/room/roomStore.ts`
- Test: `packages/core/src/room/roomStore.test.ts`

说明：`memberIds` 的引用完整性（成员必须存在）不在这一层校验，它属于 Plan 4 的房间服务职责；这一层只管形状与持久化。

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/room/roomStore.test.ts`

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileStore } from "../storage/fileStore";
import { RoomNotFoundError, RoomStore } from "./roomStore";

let root: string;
let filePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-room-"));
  filePath = join(root, "rooms.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeLoadedStore(): Promise<RoomStore> {
  const store = new RoomStore(new FileStore(), filePath);
  await store.load();
  return store;
}

describe("RoomStore", () => {
  it("创建房间并落盘", async () => {
    const store = await makeLoadedStore();

    const room = await store.create({ name: "产品讨论" });

    expect(room.id).toMatch(/^room_[0-9a-f]{12}$/);
    expect(room.memberIds).toEqual([]);
    expect((await makeLoadedStore()).list()).toHaveLength(1);
  });

  it("创建时可指定成员与房间级策略覆盖", async () => {
    const store = await makeLoadedStore();

    const room = await store.create({
      name: "攻坚",
      memberIds: ["emp_1", "emp_2"],
      policy: { maxMentionDepth: 1 },
    });

    expect(room.memberIds).toEqual(["emp_1", "emp_2"]);
    expect(room.policy?.maxMentionDepth).toBe(1);
  });

  it("update 可改成员与策略", async () => {
    const store = await makeLoadedStore();
    const room = await store.create({ name: "攻坚" });

    const updated = await store.update(room.id, {
      name: "攻坚二期",
      memberIds: ["emp_1"],
      policy: { employeeMentionsAll: "auto" },
    });

    expect(updated.name).toBe("攻坚二期");
    expect(updated.memberIds).toEqual(["emp_1"]);
    expect(updated.policy?.employeeMentionsAll).toBe("auto");
  });

  it("update 不存在的房间抛 RoomNotFoundError", async () => {
    const store = await makeLoadedStore();

    await expect(store.update("room_missing", { name: "x" })).rejects.toBeInstanceOf(
      RoomNotFoundError,
    );
  });

  it("remove 后消失", async () => {
    const store = await makeLoadedStore();
    const room = await store.create({ name: "临时" });

    await store.remove(room.id);

    expect(store.get(room.id)).toBeUndefined();
    await expect(store.remove(room.id)).rejects.toBeInstanceOf(RoomNotFoundError);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— `Cannot find module './roomStore'`。

- [ ] **Step 3: 写实现**

`packages/core/src/room/roomStore.ts`

```ts
import { z } from "zod";

import { createId } from "../domain/ids";
import { roomSchema, type Room } from "../domain/schema";
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

export class RoomNotFoundError extends Error {
  constructor(roomId: string) {
    super(`房间不存在: ${roomId}`);
    this.name = "RoomNotFoundError";
  }
}

/** 同 NewEmployeeInput：memberIds 等带默认值的字段在输入侧可选。 */
export type NewRoomInput = Omit<z.input<typeof roomSchema>, "id" | "createdAt">;

const roomListSchema = z.array(roomSchema);

export class RoomStore {
  private rooms: Room[] = [];

  constructor(
    private readonly store: TextFileStore,
    private readonly filePath: string,
  ) {}

  async load(): Promise<Room[]> {
    const raw = await this.store.read(this.filePath);
    if (raw === null) {
      this.rooms = [];
      return this.list();
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new DataParseError("房间文件不是合法 JSON", this.filePath, error);
    }

    const parsed = roomListSchema.safeParse(json);
    if (!parsed.success) {
      throw new DataParseError(`房间文件校验失败: ${parsed.error.message}`, this.filePath);
    }

    this.rooms = parsed.data;
    return this.list();
  }

  list(): Room[] {
    return [...this.rooms];
  }

  get(roomId: string): Room | undefined {
    return this.rooms.find((room) => room.id === roomId);
  }

  async create(input: NewRoomInput): Promise<Room> {
    const room = roomSchema.parse({
      ...input,
      id: createId("room"),
      createdAt: new Date().toISOString(),
    });
    this.rooms.push(room);
    await this.persist();
    return room;
  }

  async update(roomId: string, patch: Partial<NewRoomInput>): Promise<Room> {
    const index = this.rooms.findIndex((room) => room.id === roomId);
    if (index === -1) throw new RoomNotFoundError(roomId);

    const updated = roomSchema.parse({ ...(this.rooms[index] as Room), ...patch });
    this.rooms[index] = updated;
    await this.persist();
    return updated;
  }

  async remove(roomId: string): Promise<void> {
    const index = this.rooms.findIndex((room) => room.id === roomId);
    if (index === -1) throw new RoomNotFoundError(roomId);
    this.rooms.splice(index, 1);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.store.write(this.filePath, `${JSON.stringify(this.rooms, null, 2)}\n`);
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected: PASS，`Test Files 10 passed`。

- [ ] **Step 5: 提交**

```powershell
git add packages/core/src/room
git commit -m "feat(core): add room store"
```

---

### Task 9: 消息日志

**Files:**
- Create: `packages/core/src/room/messageLog.ts`
- Test: `packages/core/src/room/messageLog.test.ts`

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/room/messageLog.test.ts`

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Message } from "../domain/schema";
import { DataParseError } from "../storage/errors";
import { FileStore } from "../storage/fileStore";
import { MessageLog } from "./messageLog";

let root: string;
let log: MessageLog;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-messages-"));
  log = new MessageLog(new FileStore(), root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    roomId: "room_1",
    sender: { kind: "human" },
    mentions: [],
    body: "你好",
    attachments: [],
    kind: "chat",
    createdAt: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("MessageLog", () => {
  it("没有日志时读出空数组", async () => {
    expect(await log.readAll("room_1")).toEqual([]);
  });

  it("追加后按写入顺序读回", async () => {
    await log.append(message({ id: "msg_1", body: "第一条" }));
    await log.append(message({ id: "msg_2", body: "第二条" }));

    const all = await log.readAll("room_1");

    expect(all.map((item) => item.id)).toEqual(["msg_1", "msg_2"]);
    expect(await log.count("room_1")).toBe(2);
  });

  it("readRecent 只取最后 N 条", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await log.append(message({ id: `msg_${index}` }));
    }

    expect((await log.readRecent("room_1", 2)).map((item) => item.id)).toEqual([
      "msg_4",
      "msg_5",
    ]);
  });

  it("房间之间互不干扰", async () => {
    await log.append(message({ id: "msg_1", roomId: "room_1" }));
    await log.append(message({ id: "msg_2", roomId: "room_2" }));

    expect(await log.count("room_1")).toBe(1);
    expect((await log.readAll("room_2")).map((item) => item.id)).toEqual(["msg_2"]);
  });

  it("写入前校验消息，非法消息不落盘", async () => {
    const invalid = message({ mentions: [{ kind: "employee", employeeId: "" }] as Message["mentions"] });

    await expect(log.append(invalid)).rejects.toBeTruthy();
    expect(await log.count("room_1")).toBe(0);
  });

  it("日志中混入坏行时抛 DataParseError 并指出行号", async () => {
    await log.append(message({ id: "msg_1" }));
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");
    await store.write(file, `${JSON.stringify(message({ id: "msg_1" }))}\n{bad json\n`);

    await expect(log.readAll("room_1")).rejects.toBeInstanceOf(DataParseError);
    await expect(log.readAll("room_1")).rejects.toThrow(/第 2 行/);
  });

  it("忽略文件末尾的空行", async () => {
    const store = new FileStore();
    const file = join(root, "rooms", "room_1", "messages.jsonl");
    await store.write(file, `${JSON.stringify(message({ id: "msg_1" }))}\n\n\n`);

    expect(await log.count("room_1")).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— `Cannot find module './messageLog'`。

- [ ] **Step 3: 写实现**

`packages/core/src/room/messageLog.ts`

```ts
import { join } from "node:path";

import { messageSchema, type Message } from "../domain/schema";
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

export class MessageLog {
  constructor(
    private readonly store: TextFileStore,
    private readonly dataDir: string,
  ) {}

  async append(message: Message): Promise<void> {
    const parsed = messageSchema.parse(message);
    await this.store.appendLine(this.filePath(parsed.roomId), JSON.stringify(parsed));
  }

  async readAll(roomId: string): Promise<Message[]> {
    const path = this.filePath(roomId);
    const raw = await this.store.read(path);
    if (raw === null) return [];

    const messages: Message[] = [];
    for (const [index, rawLine] of raw.split("\n").entries()) {
      const line = rawLine.trim();
      if (line === "") continue;

      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (error) {
        throw new DataParseError(`消息日志第 ${index + 1} 行不是合法 JSON`, `${path}:${index + 1}`, error);
      }

      const parsed = messageSchema.safeParse(json);
      if (!parsed.success) {
        throw new DataParseError(
          `消息日志第 ${index + 1} 行校验失败: ${parsed.error.message}`,
          `${path}:${index + 1}`,
        );
      }
      messages.push(parsed.data);
    }
    return messages;
  }

  async readRecent(roomId: string, limit: number): Promise<Message[]> {
    const all = await this.readAll(roomId);
    return limit >= all.length ? all : all.slice(all.length - limit);
  }

  async count(roomId: string): Promise<number> {
    return (await this.readAll(roomId)).length;
  }

  private filePath(roomId: string): string {
    return join(this.dataDir, "rooms", roomId, "messages.jsonl");
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected: PASS，`Test Files 11 passed`。

- [ ] **Step 5: 提交**

```powershell
git add packages/core/src/room/messageLog.ts packages/core/src/room/messageLog.test.ts
git commit -m "feat(core): add per-room JSONL message log"
```

---

### Task 10: 公共入口、集成测试与包边界守卫

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Create: `packages/core/test/integration.test.ts`
- Create: `packages/core/test/boundaries.test.ts`

- [ ] **Step 1: 写下失败的测试**

`packages/core/src/index.test.ts`（整体替换）

```ts
import { describe, expect, it } from "vitest";

import {
  CORE_PACKAGE_NAME,
  ConfigStore,
  EmployeeStore,
  FileStore,
  MessageLog,
  RoomStore,
  createId,
  defaultConfig,
} from "./index";

describe("@wework/core", () => {
  it("对外暴露包名常量", () => {
    expect(CORE_PACKAGE_NAME).toBe("@wework/core");
  });

  it("通过公共入口暴露全部核心构件", () => {
    expect(typeof createId).toBe("function");
    expect(typeof defaultConfig).toBe("function");
    for (const ctor of [ConfigStore, EmployeeStore, RoomStore, MessageLog, FileStore]) {
      expect(typeof ctor).toBe("function");
    }
  });
});
```

`packages/core/test/integration.test.ts`

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigStore,
  EmployeeStore,
  FileStore,
  MessageLog,
  RoomStore,
  type Message,
} from "../src/index";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "buddy-integration-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("核心存储层协同", () => {
  it("配置 + 员工 + 房间 + 消息端到端可用", async () => {
    const store = new FileStore();

    const configStore = new ConfigStore(store, join(dataDir, "config.json"));
    const config = await configStore.load();
    expect(config.scheduler.maxConcurrentRuns).toBe(3);
    await configStore.update({ policy: { employeeMentionsEmployee: "confirm" } });

    const employeeStore = new EmployeeStore(store, join(dataDir, "employees.json"));
    await employeeStore.load();
    const reviewer = await employeeStore.create({
      displayName: "评审员",
      framework: "claude-code",
      workspaceDir: join(dataDir, "workspaces", "reviewer"),
      stateDir: join(dataDir, "state", "reviewer"),
      permissions: { mode: "read-only" },
      skills: [],
    });
    const coder = await employeeStore.create({
      displayName: "码农",
      framework: "codex",
      workspaceDir: join(dataDir, "workspaces", "coder"),
      stateDir: join(dataDir, "state", "coder"),
      permissions: { mode: "workspace-write" },
      skills: [],
    });

    const roomStore = new RoomStore(store, join(dataDir, "rooms.json"));
    await roomStore.load();
    const room = await roomStore.create({
      name: "发布前检查",
      memberIds: [coder.id, reviewer.id],
    });

    const messageLog = new MessageLog(store, dataDir);
    const now = new Date().toISOString();
    const humanMessage: Message = {
      id: "msg_human_1",
      roomId: room.id,
      sender: { kind: "human" },
      mentions: [{ kind: "employee", employeeId: reviewer.id }],
      body: "@评审员 看下这次改动",
      attachments: [],
      kind: "chat",
      createdAt: now,
    };
    await messageLog.append(humanMessage);
    await messageLog.append({
      id: "msg_employee_1",
      roomId: room.id,
      sender: { kind: "employee", employeeId: reviewer.id },
      mentions: [],
      body: "看过了，没问题",
      attachments: [],
      kind: "chat",
      createdAt: new Date().toISOString(),
    });

    const recent = await messageLog.readRecent(room.id, 10);
    expect(recent).toHaveLength(2);
    expect(recent[1]?.body).toBe("看过了，没问题");
    expect(await messageLog.count(room.id)).toBe(2);

    const reloadedEmployees = new EmployeeStore(store, join(dataDir, "employees.json"));
    await reloadedEmployees.load();
    expect(reloadedEmployees.getByName("码农")?.id).toBe(coder.id);

    const reloadedConfig = new ConfigStore(store, join(dataDir, "config.json"));
    await reloadedConfig.load();
    expect(reloadedConfig.get().policy.employeeMentionsEmployee).toBe("confirm");
  });
});
```

`packages/core/test/boundaries.test.ts`

```ts
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "..", "src");

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("包边界", () => {
  it("core 不依赖 electron", async () => {
    const files = await collectSourceFiles(sourceRoot);
    const offenders: string[] = [];

    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (/from\s+["']electron["']|require\(\s*["']electron["']\s*\)/.test(content)) {
        offenders.push(relative(sourceRoot, file));
      }
    }

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run：

```powershell
npm run test -w @wework/core
```

Expected: FAIL —— `./index` 未导出 `ConfigStore` 等符号（`SyntaxError`/`does not provide an export named`）。

- [ ] **Step 3: 写实现**

`packages/core/src/index.ts`（整体替换）

```ts
export const CORE_PACKAGE_NAME = "@wework/core";

export * from "./domain/ids";
export * from "./domain/schema";
export * from "./events/eventBus";
export * from "./storage/errors";
export * from "./storage/fileStore";
export * from "./config/schema";
export * from "./config/merge";
export * from "./config/configStore";
export * from "./employee/employeeStore";
export * from "./room/roomStore";
export * from "./room/messageLog";
```

- [ ] **Step 4: 运行测试，确认通过**

Run：

```powershell
npm run test -w @wework/core
```

Expected:

```text
 Test Files  13 passed (13)
      Tests  passed
```

- [ ] **Step 5: 类型检查与整体校验**

Run：

```powershell
npm run typecheck -w @wework/core
npm run test
```

Expected: 两条命令退出码均为 0。

- [ ] **Step 6: 提交**

```powershell
git add packages/core/src/index.ts packages/core/src/index.test.ts packages/core/test
git commit -m "feat(core): expose public API with integration and boundary tests"
```

---

## 完成标准

- `npm run test` 在仓库根目录通过，13 个测试文件全绿。
- `npm run typecheck` 无错误。
- `packages/core/src` 下任何文件都不 import `electron`，由 `test/boundaries.test.ts` 强制。
- 全局配置的默认值在 `defaultConfig()` 里唯一维护，`policy.employeeMentionsEmployee` / `employeeMentionsAll` 已就位，Plan 4 直接消费。
- 员工名唯一性、消息日志损坏检测、配置文件损坏检测都有测试覆盖，不依赖人工验证。
