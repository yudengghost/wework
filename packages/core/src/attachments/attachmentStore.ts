import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

import type { Attachment } from "../domain/schema";

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

export class AttachmentTooLargeError extends AttachmentError {
  constructor(name: string, sizeBytes: number, limitBytes: number) {
    super(
      `附件「${name}」为 ${(sizeBytes / 1024 / 1024).toFixed(1)}MB，超过上限 ${(
        limitBytes /
        1024 /
        1024
      ).toFixed(0)}MB`,
    );
    this.name = "AttachmentTooLargeError";
  }
}

/** 员工工作目录内的附件（提示词与原生图片入参都用它）。 */
export interface WorkspaceAttachment {
  name: string;
  /** 相对员工工作目录的路径，写进提示词用，避免暴露机器上的绝对路径。 */
  relativePath: string;
  absolutePath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AttachmentStoreOptions {
  /** 房间级持久存放的根目录（通常就是数据目录）。 */
  dataDir: string;
  maxBytes?: number;
}

const defaultMaxBytes = 25 * 1024 * 1024;

const mimeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip",
};

export function mimeOf(fileName: string): string {
  return mimeByExtension[extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

export function isImage(attachment: { mimeType?: string; name: string }): boolean {
  return (attachment.mimeType ?? mimeOf(attachment.name)).startsWith("image/");
}

/** Windows 把 CON/NUL/COM1 这类名字当作设备；带扩展名（nul.txt）同样被占用。 */
const reservedDeviceName = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * 把用户给的文件名收敛成一个安全的文件名。
 *
 * 只保留 base 名并替换掉 Windows 非法字符：附件会被复制进目录，一旦名字里带上
 * `../` 或分隔符，就会写到预期之外的位置。
 */
export function safeFileName(raw: string): string {
  const base = basename(raw.replace(/\\/g, "/")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  const trimmed = base.replace(/^\.+/, "").trim();
  const fallback = trimmed === "" ? "file" : trimmed;
  // 保留设备名加下划线前缀绕开：直接拿它当路径会复制失败。
  const stemEnd = fallback.indexOf(".");
  const stem = stemEnd === -1 ? fallback : fallback.slice(0, stemEnd);
  const safe = reservedDeviceName.test(stem) ? `_${fallback}` : fallback;
  if (safe.length <= 80) return safe;

  const extension = extname(safe);
  const truncated = safe
    .slice(0, safe.length - extension.length)
    .slice(0, 80 - extension.length);
  return `${truncated}${extension}`;
}

/** 目标已存在时依次尝试 `名字-2.ext`、`名字-3.ext`…… */
async function uniqueName(dir: string, fileName: string): Promise<string> {
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = index === 1 ? fileName : `${stem}-${index}${extension}`;
    try {
      await stat(join(dir, candidate));
    } catch {
      return candidate;
    }
  }
  throw new AttachmentError(`同名文件过多：${fileName}`);
}

export class AttachmentStore {
  private readonly maxBytes: number;

  constructor(private readonly options: AttachmentStoreOptions) {
    this.maxBytes = options.maxBytes ?? defaultMaxBytes;
  }

  /**
   * 人类发消息时调用：把用户选中的文件复制到房间级的持久位置。
   * 不直接引用用户原始路径——那份文件随时可能被移动或删除，而消息要长期可读。
   */
  async stageIncoming(
    roomId: string,
    messageId: string,
    files: { name: string; sourcePath: string }[],
  ): Promise<Attachment[]> {
    if (files.length === 0) return [];
    const directory = join(this.options.dataDir, "attachments", roomId, messageId);
    await mkdir(directory, { recursive: true });

    const staged: Attachment[] = [];
    for (const file of files) {
      const size = await this.sizeOf(file.sourcePath, file.name);
      const fileName = await uniqueName(directory, safeFileName(file.name));
      const target = join(directory, fileName);
      await copyFile(file.sourcePath, target);
      staged.push({
        id: `${messageId}_${staged.length + 1}`,
        name: fileName,
        path: target,
        mimeType: mimeOf(fileName),
        sizeBytes: size,
      });
    }
    return staged;
  }

  /**
   * 员工运行前调用：把消息的附件复制进它的工作目录，让工具能在 cwd 内直接读到。
   *
   * 只在目标不存在时复制，**绝不覆盖**：员工完全可能去修改这个附件（例如把数据填进
   * CSV），按大小差异重写会把它的成果冲掉。副本丢了倒是要补回来，所以判据是「存在与否」。
   */
  async stageIntoWorkspace(
    workspaceDir: string,
    messageId: string,
    attachments: Attachment[],
  ): Promise<WorkspaceAttachment[]> {
    if (attachments.length === 0) return [];
    const directory = join(workspaceDir, "attachments", messageId);
    await mkdir(directory, { recursive: true });
    // 附件副本是应用放进去的，同样不该出现在用户仓库的 git 状态里。
    await writeFile(join(workspaceDir, "attachments", ".gitignore"), "*\n", "utf8");

    const staged: WorkspaceAttachment[] = [];
    for (const attachment of attachments) {
      const fileName = safeFileName(attachment.name);
      const target = join(directory, fileName);
      const size = await this.sizeOf(attachment.path, attachment.name);
      if (!(await this.exists(target))) {
        await copyFile(attachment.path, target);
      }
      staged.push({
        name: fileName,
        relativePath: relative(workspaceDir, target).replace(/\\/g, "/"),
        absolutePath: target,
        mimeType: attachment.mimeType ?? mimeOf(fileName),
        sizeBytes: size,
      });
    }
    return staged;
  }

  private async sizeOf(path: string, name: string): Promise<number> {
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new AttachmentError(`找不到附件「${name}」，它可能已被移动或删除`);
    }
    if (!info.isFile()) throw new AttachmentError(`附件「${name}」不是一个文件`);
    if (info.size > this.maxBytes) {
      throw new AttachmentTooLargeError(name, info.size, this.maxBytes);
    }
    return info.size;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
