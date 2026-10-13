import { join } from "node:path";

import { messageSchema, type Message } from "../domain/schema";
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

export interface MessageLogRepair {
  roomId: string;
  /** 修好之后还剩下多少条可读消息。 */
  kept: number;
  /** 被隔离出来的坏行数。 */
  quarantined: number;
  /** 坏行存到了哪个文件；没有坏行时为 null。 */
  backupPath: string | null;
}

export class MessageLog {
  /**
   * 已解析消息的进程内缓存。
   *
   * 消息日志是只追加的 JSONL，但每次读取都要把整份文件 JSON.parse 一遍；
   * 取上下文、算条数、界面刷新都走这里，长会话下这会成为主要开销。
   * 因此解析一次之后按增量维护；只有缓存不存在时才回落到读文件。
   */
  private readonly cache = new Map<string, Message[]>();

  constructor(
    private readonly store: TextFileStore,
    private readonly dataDir: string,
  ) {}

  async append(message: Message): Promise<void> {
    const parsed = messageSchema.parse(message);
    await this.store.appendLine(this.filePath(parsed.roomId), JSON.stringify(parsed));
    // 只更新已存在的缓存：缓存不存在时不能凭空新建，否则会丢掉文件里已有的历史。
    const cached = this.cache.get(parsed.roomId);
    if (cached) cached.push(parsed);
  }

  async readAll(roomId: string): Promise<Message[]> {
    const cached = this.cache.get(roomId);
    if (cached) return [...cached];

    const path = this.filePath(roomId);
    const raw = await this.store.read(path);
    if (raw === null) {
      this.cache.set(roomId, []);
      return [];
    }

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
    this.cache.set(roomId, messages);
    return [...messages];
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
    this.cache.delete(roomId);
    await this.store.remove(join(this.dataDir, "rooms", roomId));
  }

  /**
   * 修复「一行坏数据让整个房间打不开」。
   *
   * 能解析的行原样留下，读不出来的行**不静默丢弃**：原样写进
   * `<messages.jsonl>.bad-<时间戳>`，人可以去看、可以手工救。
   * 请在房间没有运行时调用：这次重写会覆盖期间新追加的消息。
   */
  async repair(roomId: string): Promise<MessageLogRepair> {
    const path = this.filePath(roomId);
    const raw = await this.store.read(path);
    if (raw === null) return { roomId, kept: 0, quarantined: 0, backupPath: null };

    const kept: Message[] = [];
    const quarantined: string[] = [];
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.trim();
      if (line === "") continue;

      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        quarantined.push(line);
        continue;
      }

      const parsed = messageSchema.safeParse(json);
      if (parsed.success) kept.push(parsed.data);
      else quarantined.push(line);
    }

    if (quarantined.length === 0) {
      return { roomId, kept: kept.length, quarantined: 0, backupPath: null };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${path}.bad-${stamp}`;
    await this.store.write(backupPath, `${quarantined.join("\n")}\n`);
    await this.store.write(
      path,
      kept.length === 0 ? "" : `${kept.map((message) => JSON.stringify(message)).join("\n")}\n`,
    );
    this.cache.set(roomId, kept);

    return { roomId, kept: kept.length, quarantined: quarantined.length, backupPath };
  }

  private filePath(roomId: string): string {
    return join(this.dataDir, "rooms", roomId, "messages.jsonl");
  }
}
