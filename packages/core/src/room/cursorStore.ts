import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

/**
 * 记录每位员工在每个房间里「已经看到哪条消息」。
 *
 * 上下文靠这个游标只投递增量，而不是每次重灌一整段历史：员工的框架原生会话
 * 本身已经带着对话历史，重复灌注既浪费上下文又容易让它混乱。
 */
export class CursorStore {
  private cursors: Record<string, string> = {};

  constructor(
    private readonly store: TextFileStore,
    private readonly filePath: string,
  ) {}

  async load(): Promise<void> {
    const raw = await this.store.read(this.filePath);
    if (raw === null) {
      this.cursors = {};
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      this.cursors =
        typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
    } catch (error) {
      throw new DataParseError("上下文游标文件不是合法 JSON", this.filePath, error);
    }
  }

  get(employeeId: string, roomId: string): string | undefined {
    return this.cursors[key(employeeId, roomId)];
  }

  async set(employeeId: string, roomId: string, messageId: string): Promise<void> {
    this.cursors[key(employeeId, roomId)] = messageId;
    await this.store.write(this.filePath, `${JSON.stringify(this.cursors, null, 2)}\n`);
  }
}

function key(employeeId: string, roomId: string): string {
  return `${employeeId}:${roomId}`;
}
