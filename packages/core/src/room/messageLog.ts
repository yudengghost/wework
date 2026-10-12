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

  /**
   * 读游标之后的消息（增量上下文）。
   * 游标为空表示该员工第一次在这个房间干活，退化成最近 limit 条作为起步上下文；
   * 游标指向的消息已经不存在（房间被清空等）时同样退化，避免整段历史丢失。
   */
  async readAfter(
    roomId: string,
    afterMessageId: string | null,
    limit: number,
  ): Promise<Message[]> {
    const all = await this.readAll(roomId);
    if (afterMessageId === null) return all.slice(Math.max(0, all.length - limit));

    const index = all.findIndex((message) => message.id === afterMessageId);
    if (index === -1) return all.slice(Math.max(0, all.length - limit));

    const delta = all.slice(index + 1);
    return delta.length > limit ? delta.slice(delta.length - limit) : delta;
  }

  async count(roomId: string): Promise<number> {
    return (await this.readAll(roomId)).length;
  }

  /** 解散房间时连同该房间的消息一起删除。 */
  async removeRoom(roomId: string): Promise<void> {
    await this.store.remove(join(this.dataDir, "rooms", roomId));
  }

  private filePath(roomId: string): string {
    return join(this.dataDir, "rooms", roomId, "messages.jsonl");
  }
}
