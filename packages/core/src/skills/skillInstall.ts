import { cp, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { readSkillFrontmatter } from "./skillCatalog";

/** 技能 id 的合法形状：它就是技能目录名。 */
const skillIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** SKILL.md 至少要有点内容，避免把空文件当成技能装进去。 */
const minSkillBytes = 40;

export interface SkillInstallOutcome {
  /** 新装好的技能 id。 */
  installed: string[];
  /** 技能目录里已经有同名技能，直接沿用了现成的那份（不覆盖）。 */
  reused: string[];
  failed: { source: string; reason: string }[];
}

const EMPTY: SkillInstallOutcome = { installed: [], reused: [], failed: [] };

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把员工（通常是 HR）下载到自己工作目录里的技能装进技能目录。
 *
 * 为什么由应用来装而不是让员工自己写：员工跑在沙箱里，只能写自己的工作目录；
 * 技能目录是应用的地盘。所以约定「下载到工作目录 → 申请里写相对路径 → 应用搬进技能目录」，
 * 每一步都摆在用户眼前，而且批准之前谁都不会被执行。
 *
 * 安全边界：只接受工作目录内的相对路径（挡掉绝对路径与 `..` 逃逸）；
 * 只搬走含 SKILL.md 的目录；技能 id 已存在时不覆盖，直接沿用现成的那份。
 */
export async function installSkillsFromWorkspace(options: {
  dataDir: string;
  requesterWorkspaceDir?: string;
  sources: string[];
}): Promise<SkillInstallOutcome> {
  const { dataDir, requesterWorkspaceDir, sources } = options;
  if (sources.length === 0) return EMPTY;
  if (!requesterWorkspaceDir) {
    return {
      installed: [],
      reused: [],
      failed: sources.map((source) => ({ source, reason: "找不到发起人的工作目录" })),
    };
  }

  const root = resolve(requesterWorkspaceDir);
  const skillsDir = join(dataDir, "skills");
  const outcome: SkillInstallOutcome = { installed: [], reused: [], failed: [] };

  for (const source of sources) {
    try {
      if (isAbsolute(source)) throw new Error("只接受工作目录内的相对路径");
      const from = resolve(root, source);
      const relativePath = relative(root, from);
      if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throw new Error("路径跑到工作目录外面去了");
      }

      const id = basename(from);
      if (!skillIdPattern.test(id)) {
        throw new Error(`技能目录名「${id}」不合法（只允许字母、数字、点、下划线和短横线）`);
      }

      const entry = join(from, "SKILL.md");
      if (!(await exists(entry))) throw new Error("目录里没有 SKILL.md");
      const raw = await readFile(entry, "utf8");
      if (Buffer.byteLength(raw, "utf8") < minSkillBytes) {
        throw new Error("SKILL.md 内容太少，像是没下全");
      }
      const front = readSkillFrontmatter(raw);
      if (!front.name && !front.description) {
        throw new Error("SKILL.md 缺少 frontmatter（至少要 name 或 description）");
      }

      const target = join(skillsDir, id);
      if (await exists(join(target, "SKILL.md"))) {
        outcome.reused.push(id);
        continue;
      }

      // 别把下载目录里的版本库与依赖一起搬进来。
      await cp(from, target, {
        recursive: true,
        force: false,
        filter: (path) =>
          !path.includes(`${sep}.git${sep}`) && !path.includes(`${sep}node_modules${sep}`),
      });
      if (!(await exists(join(target, "SKILL.md")))) throw new Error("拷贝后没找到 SKILL.md");
      outcome.installed.push(id);
    } catch (error) {
      outcome.failed.push({
        source,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcome;
}
