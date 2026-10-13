// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSkillsFromWorkspace } from "./skillInstall";

let root: string;
let dataDir: string;
let workspace: string;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wework-skill-install-"));
  dataDir = join(root, "data");
  workspace = join(root, "workspace");
  await mkdir(dataDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 在 HR 的工作目录里造一个"已下载好"的技能。 */
async function download(id: string, body = "# 技能\n\n正文内容，够长就行。"): Promise<string> {
  const dir = join(workspace, ".wework", "skills", id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${id}\ndescription: ${id} 的说明\n---\n\n${body}\n`,
    "utf8",
  );
  return `.wework/skills/${id}`;
}

describe("安装员工下载好的技能", () => {
  it("把下载目录整份搬进技能目录（连带附属文件）", async () => {
    const source = await download("csv-kit");
    await writeFile(join(workspace, ".wework", "skills", "csv-kit", "helper.ps1"), "# 脚本", "utf8");

    const outcome = await installSkillsFromWorkspace({
      dataDir,
      requesterWorkspaceDir: workspace,
      sources: [source],
    });

    expect(outcome.installed).toEqual(["csv-kit"]);
    expect(outcome.failed).toEqual([]);
    expect(await readFile(join(dataDir, "skills", "csv-kit", "SKILL.md"), "utf8")).toContain(
      "csv-kit 的说明",
    );
    expect(await readFile(join(dataDir, "skills", "csv-kit", "helper.ps1"), "utf8")).toContain("脚本");
  });

  it("装成功之后，工作目录里的下载副本被清掉，不留两份", async () => {
    const source = await download("csv-kit");
    const downloaded = join(workspace, ".wework", "skills", "csv-kit");

    await installSkillsFromWorkspace({
      dataDir,
      requesterWorkspaceDir: workspace,
      sources: [source],
    });

    // 技能目录里有，工作目录里没了——中转站用完就清，避免长期占空间
    expect(await exists(join(dataDir, "skills", "csv-kit", "SKILL.md"))).toBe(true);
    expect(await exists(downloaded)).toBe(false);
  });

  it("没装成功的一次不删文件：沿用现成那份、缺 SKILL.md、路径非法都保持原样", async () => {
    const reusedSource = await download("docx");
    const existing = join(dataDir, "skills", "docx");
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, "SKILL.md"), "---\nname: 现成的\n---\n", "utf8");

    await mkdir(join(workspace, ".wework", "skills", "half-baked"), { recursive: true });

    const outcome = await installSkillsFromWorkspace({
      dataDir,
      requesterWorkspaceDir: workspace,
      sources: [reusedSource, ".wework/skills/half-baked", "../outside"],
    });

    expect(outcome.reused).toEqual(["docx"]);
    expect(outcome.failed).toHaveLength(2);
    // 没有发生拷贝的三种情况都不该动用户的文件
    expect(await exists(join(workspace, ".wework", "skills", "docx"))).toBe(true);
    expect(await exists(join(workspace, ".wework", "skills", "half-baked"))).toBe(true);
  });

  it("同一次申请里重复引用同一个目录，只处理一次", async () => {
    const source = await download("csv-kit");

    const outcome = await installSkillsFromWorkspace({
      dataDir,
      requesterWorkspaceDir: workspace,
      sources: [source, source, `${source}/`],
    });

    // 第一次就把它装好并删掉了；重复项不该变成「目录里没有 SKILL.md」这种假失败
    expect(outcome.installed).toEqual(["csv-kit"]);
    expect(outcome.failed).toEqual([]);
  });

  it("目录里没有 SKILL.md 时装不上，并说明原因", async () => {
    await mkdir(join(workspace, ".wework", "skills", "half-baked"), { recursive: true });

    const outcome = await installSkillsFromWorkspace({
      dataDir,
      requesterWorkspaceDir: workspace,
      sources: [".wework/skills/half-baked"],
    });

    expect(outcome.installed).toEqual([]);
    expect(outcome.failed[0]?.reason).toContain("没有 SKILL.md");
  });

  it("挡掉跑到工作目录外面的路径（'..' 与绝对路径）", async () => {
    const outcome = await installSkillsFromWorkspace({
      dataDir,
      requesterWorkspaceDir: workspace,
      sources: ["../../etc", "C:\\Windows\\System32"],
    });

    expect(outcome.installed).toEqual([]);
    expect(outcome.failed.map((item) => item.source)).toEqual([
      "../../etc",
      "C:\\Windows\\System32",
    ]);
  });

  it("技能目录里已有同名技能时不覆盖，直接沿用", async () => {
    const source = await download("docx");
    const existing = join(dataDir, "skills", "docx");
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, "SKILL.md"), "---\nname: 现成的\ndescription: 老版本\n---\n", "utf8");

    const outcome = await installSkillsFromWorkspace({
      dataDir,
      requesterWorkspaceDir: workspace,
      sources: [source],
    });

    expect(outcome.reused).toEqual(["docx"]);
    expect(outcome.installed).toEqual([]);
    expect(await readFile(join(existing, "SKILL.md"), "utf8")).toContain("老版本");
  });

  it("内容太少或没有 frontmatter 的 SKILL.md 不算技能", async () => {
    const thin = join(workspace, ".wework", "skills", "thin");
    await mkdir(thin, { recursive: true });
    await writeFile(join(thin, "SKILL.md"), "没头没尾", "utf8");

    const noFront = join(workspace, ".wework", "skills", "no-front");
    await mkdir(noFront, { recursive: true });
    await writeFile(
      join(noFront, "SKILL.md"),
      "# 只有正文，没有 frontmatter\n\n这里写了很多内容，长度肯定超过四十个字节了，但仍然缺少 frontmatter。\n",
      "utf8",
    );

    const outcome = await installSkillsFromWorkspace({
      dataDir,
      requesterWorkspaceDir: workspace,
      sources: [".wework/skills/thin", ".wework/skills/no-front"],
    });

    expect(outcome.installed).toEqual([]);
    expect(outcome.failed).toHaveLength(2);
    expect(outcome.failed[1]?.reason).toContain("frontmatter");
  });

  it("拿不到发起人工作目录时，全部记为失败而不是当成没有申请", async () => {
    const outcome = await installSkillsFromWorkspace({
      dataDir,
      sources: [".wework/skills/docx"],
    });

    expect(outcome.installed).toEqual([]);
    expect(outcome.failed[0]?.reason).toContain("找不到发起人的工作目录");
  });
});
