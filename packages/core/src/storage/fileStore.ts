import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface TextFileStore {
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  appendLine(path: string, line: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listFiles(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  ensureDir(dir: string): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export class FileStore implements TextFileStore {
  async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async read(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** 先写临时文件再 rename，避免进程中断留下半截文件。 */
  async write(path: string, contents: string): Promise<void> {
    await this.ensureDir(dirname(path));
    const tmpPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, contents, "utf8");
    await rename(tmpPath, path);
  }

  async appendLine(path: string, line: string): Promise<void> {
    await this.ensureDir(dirname(path));
    const normalized = line.endsWith("\n") ? line : `${line}\n`;
    await appendFile(path, normalized, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }
}
