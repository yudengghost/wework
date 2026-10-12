import { join } from "node:path";

import { createId } from "../domain/ids";
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

export interface MemoryEntry {
  id: string;
  /** exchange = 一次对话的浓缩；digest = 若干条整理后的摘要。 */
  kind: "exchange" | "digest";
  scope: "direct" | "group";
  roomId: string;
  text: string;
  createdAt: string;
}

export type NewMemoryEntry = Omit<MemoryEntry, "id" | "createdAt"> &
  Partial<Pick<MemoryEntry, "createdAt">>;

/**
 * 每个员工一份记忆日志：一行一条 JSON。
 * 整理会把最旧的若干条合并成一条 digest，因此需要重写文件而不是追加。
 */
export class MemoryStore {
  constructor(
    private readonly store: TextFileStore,
    private readonly dataDir: string,
  ) {}

  async append(employeeId: string, entry: NewMemoryEntry): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      id: createId("mem"),
      createdAt: entry.createdAt ?? new Date().toISOString(),
      kind: entry.kind,
      scope: entry.scope,
      roomId: entry.roomId,
      text: entry.text,
    };
    await this.store.appendLine(this.filePath(employeeId), JSON.stringify(full));
    return full;
  }

  async list(employeeId: string): Promise<MemoryEntry[]> {
    const path = this.filePath(employeeId);
    const raw = await this.store.read(path);
    if (raw === null) return [];

    const entries: MemoryEntry[] = [];
    for (const [index, rawLine] of raw.split("\n").entries()) {
      const line = rawLine.trim();
      if (line === "") continue;
      try {
        entries.push(JSON.parse(line) as MemoryEntry);
      } catch (error) {
        throw new DataParseError(
          `记忆文件第 ${index + 1} 行不是合法 JSON`,
          `${path}:${index + 1}`,
          error,
        );
      }
    }
    return entries;
  }

  async recent(employeeId: string, limit: number): Promise<MemoryEntry[]> {
    const all = await this.list(employeeId);
    return limit >= all.length ? all : all.slice(all.length - limit);
  }

  async count(employeeId: string): Promise<number> {
    return (await this.list(employeeId)).length;
  }

  /** 保留最新 keepLast 条，其余替换成一条摘要。 */
  async consolidate(employeeId: string, keepLast: number, digestText: string): Promise<number> {
    const all = await this.list(employeeId);
    if (all.length <= keepLast) return 0;
    const kept = all.slice(all.length - keepLast);
    const absorbed = all.length - kept.length;
    const digest: MemoryEntry = {
      id: createId("mem"),
      kind: "digest",
      scope: kept[0]?.scope ?? "group",
      roomId: kept[0]?.roomId ?? "",
      text: digestText,
      createdAt: new Date().toISOString(),
    };
    await this.rewrite(employeeId, [digest, ...kept]);
    return absorbed;
  }

  /** 超过上限时从最旧处丢弃，保证文件不会无限增长。 */
  async trim(employeeId: string, maxEntries: number): Promise<number> {
    const all = await this.list(employeeId);
    if (all.length <= maxEntries) return 0;
    await this.rewrite(employeeId, all.slice(all.length - maxEntries));
    return all.length - maxEntries;
  }

  async clear(employeeId: string): Promise<void> {
    await this.rewrite(employeeId, []);
  }

  private async rewrite(employeeId: string, entries: MemoryEntry[]): Promise<void> {
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
    await this.store.write(this.filePath(employeeId), body === "" ? "" : `${body}\n`);
  }

  private filePath(employeeId: string): string {
    return join(this.dataDir, "memory", `${employeeId}.jsonl`);
  }
}
