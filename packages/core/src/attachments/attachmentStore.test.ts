import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AttachmentError,
  AttachmentStore,
  AttachmentTooLargeError,
  isImage,
  mimeOf,
  safeFileName,
} from "./attachmentStore";

let root: string;
let incoming: string;
let workspace: string;
let store: AttachmentStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buddy-attach-"));
  incoming = join(root, "incoming");
  workspace = join(root, "workspace");
  store = new AttachmentStore({ dataDir: root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function sourceFile(name: string, contents: string): Promise<string> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(incoming, { recursive: true });
  const path = join(incoming, name);
  await writeFile(path, contents, "utf8");
  return path;
}

describe("safeFileName", () => {
  it("剥掉目录成分，避免写到预期之外的位置", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\secret.txt")).toBe("secret.txt");
    expect(safeFileName("..\\..\\windows\\system32\\x.dll")).toBe("x.dll");
  });

  it("替换非法字符并去掉前导点", () => {
    expect(safeFileName('a<b>c:d"e|f?g*h.txt')).toBe("a_b_c_d_e_f_g_h.txt");
    expect(safeFileName(".hidden")).toBe("hidden");
  });

  it("空名字与超长名字都有兜底", () => {
    expect(safeFileName("   ")).toBe("file");
    const long = `${"x".repeat(200)}.png`;
    const safe = safeFileName(long);
    expect(safe.length).toBeLessThanOrEqual(80);
    expect(safe.endsWith(".png")).toBe(true);
  });

  it("绕开 Windows 保留设备名", () => {
    expect(safeFileName("CON")).not.toBe("CON");
    expect(safeFileName("nul.txt")).not.toBe("nul.txt");
    expect(safeFileName("COM1")).not.toBe("COM1");
    // 普通名字不受影响
    expect(safeFileName("正常文件.txt")).toBe("正常文件.txt");
  });
});

describe("mimeOf / isImage", () => {
  it("按扩展名判断类型", () => {
    expect(mimeOf("a.PNG")).toBe("image/png");
    expect(mimeOf("a.pdf")).toBe("application/pdf");
    expect(mimeOf("a.unknown")).toBe("application/octet-stream");
    expect(isImage({ name: "shot.png" })).toBe(true);
    expect(isImage({ name: "doc.pdf" })).toBe(false);
  });
});

describe("AttachmentStore.stageIncoming", () => {
  it("把用户文件复制进房间级目录，原文件之后被删也不影响", async () => {
    const source = await sourceFile("note.txt", "hello attachment");

    const staged = await store.stageIncoming("room_1", "msg_1", [
      { name: "note.txt", sourcePath: source },
    ]);

    expect(staged).toHaveLength(1);
    expect(staged[0]?.name).toBe("note.txt");
    expect(staged[0]?.mimeType).toBe("text/plain");
    expect(staged[0]?.sizeBytes).toBe(16);

    await rm(source, { force: true });
    expect(await readFile(staged[0]?.path ?? "", "utf8")).toBe("hello attachment");
  });

  it("同名文件自动改名，不互相覆盖", async () => {
    const first = await sourceFile("a.txt", "1");
    const second = await sourceFile("b.txt", "2");

    const staged = await store.stageIncoming("room_1", "msg_1", [
      { name: "same.txt", sourcePath: first },
      { name: "same.txt", sourcePath: second },
    ]);

    expect(staged.map((item) => item.name)).toEqual(["same.txt", "same-2.txt"]);
    expect(await readFile(staged[1]?.path ?? "", "utf8")).toBe("2");
  });

  it("恶意文件名不会逃出目标目录", async () => {
    const source = await sourceFile("evil.txt", "x");

    const staged = await store.stageIncoming("room_1", "msg_1", [
      { name: "../../../pwned.txt", sourcePath: source },
    ]);

    expect(staged[0]?.name).toBe("pwned.txt");
    expect(staged[0]?.path).toContain(join("attachments", "room_1", "msg_1"));
  });

  it("超过上限拒绝并给出明确原因", async () => {
    const small = new AttachmentStore({ dataDir: root, maxBytes: 4 });
    const source = await sourceFile("big.txt", "1234567890");

    await expect(
      small.stageIncoming("room_1", "msg_1", [{ name: "big.txt", sourcePath: source }]),
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  });

  it("源文件不存在时报错而不是静默成功", async () => {
    await expect(
      store.stageIncoming("room_1", "msg_1", [
        { name: "ghost.txt", sourcePath: join(incoming, "ghost.txt") },
      ]),
    ).rejects.toBeInstanceOf(AttachmentError);
  });
});

describe("AttachmentStore.stageIntoWorkspace", () => {
  it("复制进员工工作目录并给出相对路径", async () => {
    const source = await sourceFile("data.csv", "a,b\n1,2\n");
    const [attachment] = await store.stageIncoming("room_1", "msg_1", [
      { name: "data.csv", sourcePath: source },
    ]);

    const staged = await store.stageIntoWorkspace(
      workspace,
      "msg_1",
      attachment ? [attachment] : [],
    );

    expect(staged).toHaveLength(1);
    expect(staged[0]?.relativePath).toBe("attachments/msg_1/data.csv");
    expect(await readFile(staged[0]?.absolutePath ?? "", "utf8")).toBe("a,b\n1,2\n");
    // 附件目录同样自我忽略
    expect(await readFile(join(workspace, "attachments", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("重复运行不会重复复制（幂等）", async () => {
    const source = await sourceFile("x.txt", "once");
    const [attachment] = await store.stageIncoming("room_1", "msg_1", [
      { name: "x.txt", sourcePath: source },
    ]);
    const input = attachment ? [attachment] : [];

    const first = await store.stageIntoWorkspace(workspace, "msg_1", input);
    // 人为把工作目录里的副本改掉：如果第二次是幂等的，改动会被保留
    await writeFile(first[0]?.absolutePath ?? "", "edited", "utf8");
    const second = await store.stageIntoWorkspace(workspace, "msg_1", input);

    expect(second[0]?.absolutePath).toBe(first[0]?.absolutePath);
    expect(await readFile(second[0]?.absolutePath ?? "", "utf8")).toBe("edited");
  });

  it("没有附件时返回空", async () => {
    expect(await store.stageIntoWorkspace(workspace, "msg_1", [])).toEqual([]);
  });
});
