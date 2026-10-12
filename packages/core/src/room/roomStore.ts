import { z } from "zod";

import { createId } from "../domain/ids";
import { roomSchema, type Room } from "../domain/schema";
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

export class RoomNotFoundError extends Error {
  constructor(roomId: string) {
    super(`房间不存在: ${roomId}`);
    this.name = "RoomNotFoundError";
  }
}

/** 同 NewEmployeeInput：memberIds 等带默认值的字段在输入侧可选。 */
export type NewRoomInput = Omit<z.input<typeof roomSchema>, "id" | "createdAt">;

const roomListSchema = z.array(roomSchema);

export class RoomStore {
  private rooms: Room[] = [];

  constructor(
    private readonly store: TextFileStore,
    private readonly filePath: string,
  ) {}

  async load(): Promise<Room[]> {
    const raw = await this.store.read(this.filePath);
    if (raw === null) {
      this.rooms = [];
      return this.list();
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new DataParseError("房间文件不是合法 JSON", this.filePath, error);
    }

    const parsed = roomListSchema.safeParse(json);
    if (!parsed.success) {
      throw new DataParseError(`房间文件校验失败: ${parsed.error.message}`, this.filePath);
    }

    this.rooms = parsed.data;
    return this.list();
  }

  list(): Room[] {
    return [...this.rooms];
  }

  get(roomId: string): Room | undefined {
    return this.rooms.find((room) => room.id === roomId);
  }

  async create(input: NewRoomInput): Promise<Room> {
    const room = roomSchema.parse({
      ...input,
      id: createId("room"),
      createdAt: new Date().toISOString(),
    });
    this.rooms.push(room);
    await this.persist();
    return room;
  }

  async update(roomId: string, patch: Partial<NewRoomInput>): Promise<Room> {
    const index = this.rooms.findIndex((room) => room.id === roomId);
    if (index === -1) throw new RoomNotFoundError(roomId);

    const updated = roomSchema.parse({ ...(this.rooms[index] as Room), ...patch });
    this.rooms[index] = updated;
    await this.persist();
    return updated;
  }

  async remove(roomId: string): Promise<void> {
    const index = this.rooms.findIndex((room) => room.id === roomId);
    if (index === -1) throw new RoomNotFoundError(roomId);
    this.rooms.splice(index, 1);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.store.write(this.filePath, `${JSON.stringify(this.rooms, null, 2)}\n`);
  }
}
