// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 渲染层里出现 alert / confirm / prompt，Electron 会弹原生模态对话框，
 * 它阻塞整个渲染进程——用户看到的是「界面卡死，只能重启」。
 *
 * 询问与回执一律走应用内界面（ConfirmDialog / 面板内的 result、error 行）。
 */
describe("渲染层不用原生对话框", () => {
  it("源码里没有 window.alert / window.confirm / window.prompt", async () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];

    for (const file of await sourceFiles(root)) {
      const raw = await readFile(file, "utf8");
      if (/window\.(alert|confirm|prompt)\s*\(/.test(raw)) offenders.push(basename(file));
    }

    expect(offenders).toEqual([]);
  });
});

async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests") files.push(...(await sourceFiles(path)));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    files.push(path);
  }
  return files;
}
