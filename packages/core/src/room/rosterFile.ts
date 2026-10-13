import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/** 名册文件里的一条：渐进式披露的第二层，含完整人设。 */
export interface RosterEntry {
  id: string;
  displayName: string;
  framework: string;
  permissionMode: string;
  inThisRoom: boolean;
  isYou: boolean;
  /** 完整人设；提示词里只给截断的一行，需要时来这里读。 */
  role: string;
}

export interface RosterWriter {
  /** 写入并返回相对工作目录的路径（提示词里用它，不暴露绝对路径）。 */
  write(workspaceDir: string, entries: RosterEntry[]): Promise<string>;
}

/**
 * 把员工名册写成一份工作目录内的 JSON 文件。
 *
 * 渐进式披露：提示词里只放名字 + 一行职责摘要，完整人设放在这里，
 * 由员工自己在需要时用文件工具读取——既不占上下文，也不需要额外的协议往返。
 */
export function createRosterFileWriter(fileName = "roster.json"): RosterWriter {
  return {
    async write(workspaceDir: string, entries: RosterEntry[]): Promise<string> {
      const path = join(workspaceDir, ".buddy", fileName);
      await mkdir(dirname(path), { recursive: true });
      const payload = {
        generatedAt: new Date().toISOString(),
        note: "本文件由 Buddy 自动生成，每次运行前刷新；请勿手工编辑。",
        employees: entries,
      };
      await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      return relative(workspaceDir, path).replace(/\\/g, "/");
    },
  };
}
