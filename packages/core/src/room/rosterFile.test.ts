import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRosterFileWriter, type RosterEntry } from "./rosterFile";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-roster-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const entries: RosterEntry[] = [
  {
    id: "emp_a",
    displayName: "小码",
    framework: "codex",
    permissionMode: "workspace-write",
    inThisRoom: true,
    isYou: true,
    role: "你是资深后端工程师，只关注正确性与性能。",
  },
  {
    id: "emp_b",
    displayName: "外部同事",
    framework: "claude-code",
    permissionMode: "read-only",
    inThisRoom: false,
    isYou: false,
    role: "负责数据迁移与清洗，只读分析。",
  },
];

describe("createRosterFileWriter", () => {
  it("把完整人设写进工作目录内的名册文件，并返回相对路径", async () => {
    const writer = createRosterFileWriter();

    const relativePath = await writer.write(root, entries);

    expect(relativePath).toBe(".wework/roster.json");
    const parsed = JSON.parse(await readFile(join(root, ".wework", "roster.json"), "utf8"));
    expect(parsed.employees).toHaveLength(2);
    expect(parsed.employees[1]).toMatchObject({
      displayName: "外部同事",
      role: "负责数据迁移与清洗，只读分析。",
      inThisRoom: false,
    });
    expect(parsed.note).toContain("自动生成");
    // 自我忽略：不污染员工工作目录所在的 git 仓库
    expect(await readFile(join(root, ".wework", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("重复写入是覆盖刷新，不会堆积", async () => {
    const writer = createRosterFileWriter();
    await writer.write(root, entries);

    await writer.write(root, entries.slice(0, 1));

    const parsed = JSON.parse(await readFile(join(root, ".wework", "roster.json"), "utf8"));
    expect(parsed.employees).toHaveLength(1);
  });
});
