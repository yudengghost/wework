import { join } from "node:path";

import { createId } from "../domain/ids";
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

/**
 * 长期记忆：归纳后的事实与摘要，跨会话存续。
 * 与「上下文」（对话历史）是两回事——上下文由原生会话 + 增量消息负责，不落在这里。
 */
export interface MemoryFact {
  id: string;
  kind: "fact" | "digest";
  text: string;
  /** 这条记忆是从哪个房间学到的，用于「不跨房间回忆」的过滤。 */
  roomId?: string;
  createdAt: string;
}

/** 短期暂存：一次往来，等待归纳。归纳完成后清空，不会直接当记忆用。 */
export interface PendingExchange {
  id: string;
  roomId: string;
  scope: "direct" | "group";
  text: string;
  createdAt: string;
}

export class MemoryStore {
  constructor(
    private readonly store: TextFileStore,
    private readonly dataDir: string,
  ) {}

  async listFacts(employeeId: string): Promise<MemoryFact[]> {
    return this.readAll<MemoryFact>(this.factsPath(employeeId));
  }

  async countFacts(employeeId: string): Promise<number> {
    return (await this.listFacts(employeeId)).length;
  }

  async recentFacts(employeeId: string, limit: number): Promise<MemoryFact[]> {
    const all = await this.listFacts(employeeId);
    return limit >= all.length ? all : all.slice(all.length - limit);
  }

  async appendFact(
    employeeId: string,
    text: string,
    kind: MemoryFact["kind"] = "fact",
    roomId?: string,
  ): Promise<MemoryFact> {
    const fact: MemoryFact = {
      id: createId("mem"),
      kind,
      text,
      roomId,
      createdAt: new Date().toISOString(),
    };
    await this.store.appendLine(this.factsPath(employeeId), JSON.stringify(fact));
    return fact;
  }

  async writeFacts(employeeId: string, facts: MemoryFact[]): Promise<void> {
    await this.writeLines(
      this.factsPath(employeeId),
      facts.map((fact) => JSON.stringify(fact)),
    );
  }

  async listPending(employeeId: string): Promise<PendingExchange[]> {
    return this.readAll<PendingExchange>(this.pendingPath(employeeId));
  }

  async countPending(employeeId: string): Promise<number> {
    return (await this.listPending(employeeId)).length;
  }

  async appendPending(
    employeeId: string,
    exchange: Omit<PendingExchange, "id" | "createdAt">,
  ): Promise<PendingExchange> {
    const entry: PendingExchange = {
      id: createId("mem"),
      createdAt: new Date().toISOString(),
      roomId: exchange.roomId,
      scope: exchange.scope,
      text: exchange.text,
    };
    await this.store.appendLine(this.pendingPath(employeeId), JSON.stringify(entry));
    return entry;
  }

  async clearPending(employeeId: string): Promise<void> {
    await this.store.write(this.pendingPath(employeeId), "");
  }

  /** 忘掉某一条长期记忆。 */
  async forgetFact(employeeId: string, factId: string): Promise<boolean> {
    const all = await this.listFacts(employeeId);
    const kept = all.filter((fact) => fact.id !== factId);
    if (kept.length === all.length) return false;
    await this.writeFacts(employeeId, kept);
    return true;
  }

  /** 清空该员工的全部记忆（长期 + 待归纳）。 */
  async clear(employeeId: string): Promise<void> {
    await this.store.write(this.factsPath(employeeId), "");
    await this.clearPending(employeeId);
  }

  private async readAll<T>(path: string): Promise<T[]> {
    const raw = await this.store.read(path);
    if (raw === null) return [];

    const items: T[] = [];
    for (const [index, rawLine] of raw.split("\n").entries()) {
      const line = rawLine.trim();
      if (line === "") continue;
      try {
        items.push(JSON.parse(line) as T);
      } catch (error) {
        throw new DataParseError(
          `记忆文件第 ${index + 1} 行不是合法 JSON`,
          `${path}:${index + 1}`,
          error,
        );
      }
    }
    return items;
  }

  private async writeLines(path: string, lines: string[]): Promise<void> {
    await this.store.write(path, lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  }

  private factsPath(employeeId: string): string {
    return join(this.dataDir, "memory", `${employeeId}.jsonl`);
  }

  private pendingPath(employeeId: string): string {
    return join(this.dataDir, "memory", `${employeeId}.pending.jsonl`);
  }
}
