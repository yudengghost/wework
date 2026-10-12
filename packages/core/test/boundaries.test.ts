import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "..", "src");

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("包边界", () => {
  it("core 不依赖 electron", async () => {
    const files = await collectSourceFiles(sourceRoot);
    const offenders: string[] = [];

    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (/from\s+["']electron["']|require\(\s*["']electron["']\s*\)/.test(content)) {
        offenders.push(relative(sourceRoot, file));
      }
    }

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
  });
});
