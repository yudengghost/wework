import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type SkillSource = "wework" | "framework";

export interface SkillInfo {
  /** 目录名，作为员工档案里 skills 数组的取值。 */
  id: string;
  name: string;
  description?: string;
  source: SkillSource;
  /** SKILL.md 的绝对路径，运行时把它告诉员工，由员工按需读取。 */
  entryPath: string;
}

export interface SkillFileSystem {
  listDirs(dir: string): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
  isFile(path: string): Promise<boolean>;
}

export function createSystemSkillFileSystem(): SkillFileSystem {
  return {
    async listDirs(dir) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    async readFile(path) {
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async isFile(path) {
      try {
        return (await stat(path)).isFile();
      } catch {
        return false;
      }
    },
  };
}

/** 各框架自带的技能目录；复用它们就能免去「再抄一份」的麻烦。 */
export function frameworkSkillRoots(env: Record<string, string | undefined>): string[] {
  const home = env.USERPROFILE ?? env.HOME;
  if (!home) return [];
  return [
    join(home, ".codex", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
  ];
}

/** 读 SKILL.md 头部的 frontmatter（name / description）。装技能时也用它做校验。 */
export function readSkillFrontmatter(raw: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  const body = match?.[1];
  if (body === undefined) return {};
  const read = (key: string): string | undefined => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(body);
    return found?.[1]?.trim().replace(/^["']|["']$/g, "");
  };
  return { name: read("name"), description: read("description") };
}

export interface CatalogSkillsOptions {
  dataDir: string;
  extraRoots?: string[];
  includeFrameworkSkills?: boolean;
  env?: Record<string, string | undefined>;
  fs?: SkillFileSystem;
}

/**
 * 扫描所有技能根目录，每个含 SKILL.md 的子目录算一个技能。
 * 同名技能以 Wework 自己的目录为准，避免被框架里的同名技能覆盖。
 */
export async function catalogSkills(options: CatalogSkillsOptions): Promise<SkillInfo[]> {
  const fs = options.fs ?? createSystemSkillFileSystem();
  const roots: { dir: string; source: SkillSource }[] = [
    { dir: join(options.dataDir, "skills"), source: "wework" },
  ];

  for (const dir of options.extraRoots ?? []) {
    if (dir.trim() !== "") roots.push({ dir: join(dir), source: "wework" });
  }
  if (options.includeFrameworkSkills !== false) {
    for (const dir of frameworkSkillRoots(options.env ?? {})) {
      roots.push({ dir, source: "framework" });
    }
  }

  const byId = new Map<string, SkillInfo>();
  for (const root of roots) {
    for (const id of await fs.listDirs(root.dir)) {
      const entryPath = join(root.dir, id, "SKILL.md");
      if (!(await fs.isFile(entryPath))) continue;
      if (byId.has(id)) continue;

      const raw = (await fs.readFile(entryPath)) ?? "";
      const front = readSkillFrontmatter(raw);
      byId.set(id, {
        id,
        name: front.name ?? id,
        description: front.description,
        source: root.source,
        entryPath,
      });
    }
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
