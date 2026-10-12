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

  it("remove 是软删除：离开名册但档案保留，历史仍能解析出姓名", async () => {
    const store = await makeLoadedStore();
    const created = await store.create(input());

    await store.remove(created.id);

    expect(store.list()).toEqual([]);
    expect(store.get(created.id)?.displayName).toBe("小码");
    expect(store.listRemoved().map((item) => item.id)).toEqual([created.id]);
    expect((await makeLoadedStore()).list()).toEqual([]);
    expect((await makeLoadedStore()).get(created.id)?.displayName).toBe("小码");
  });

  it("remove 后名字可以重新使用，restore 可以放回名册", async () => {
    const store = await makeLoadedStore();
    const created = await store.create(input({ displayName: "小码" }));

    await store.remove(created.id);
    const reused = await store.create(input({ displayName: "小码" }));
    expect(reused.id).not.toBe(created.id);

    await store.restore(created.id);
    expect(store.list()).toHaveLength(2);
  });

  it("remove 不存在的员工抛 EmployeeNotFoundError", async () => {
    const store = await makeLoadedStore();

    await expect(store.remove("emp_missing")).rejects.toBeInstanceOf(EmployeeNotFoundError);
  });

  it("purge 彻底移除档案", async () => {
    const store = await makeLoadedStore();
    const created = await store.create(input());

    await store.purge(created.id);

    expect(store.get(created.id)).toBeUndefined();
    expect(store.listAll()).toEqual([]);
  });

  it("损坏的员工文件抛 DataParseError", async () => {
    const file = new FileStore();
    await file.write(filePath, '[{"id":"emp_1"}]');

    await expect(makeLoadedStore()).rejects.toBeInstanceOf(DataParseError);
  });
});
