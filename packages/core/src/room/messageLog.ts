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
        throw new DataParseError(
          `消息日志第 ${index + 1} 行不是合法 JSON`,
          `${path}:${index + 1}`,
          error,
        );
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
