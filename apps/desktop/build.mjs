import { cp, mkdir, rm } from "node:fs/promises";

import { build } from "esbuild";

const out = "dist";

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/renderer`, { recursive: true });

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "warning",
  // esbuild 默认把非 ASCII 转义成 \uXXXX。界面与提示词里有大量中文，
  // 直接存 UTF-8 体积更小，也让产物可以直接被检索核查。
  charset: "utf8",
};

await build({
  ...shared,
  entryPoints: ["src/main/main.ts"],
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: `${out}/main/main.cjs`,
  external: ["electron"],
});

await build({
  ...shared,
  entryPoints: ["src/preload/preload.ts"],
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: `${out}/preload/preload.cjs`,
  external: ["electron"],
});

// 渲染进程打成 iife（而不是 esm）：file:// 下 Chromium 会以 CORS 为由拒绝模块脚本。
await build({
  ...shared,
  entryPoints: ["src/renderer/main.tsx"],
  platform: "browser",
  format: "iife",
  target: "chrome120",
  outfile: `${out}/renderer/renderer.js`,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});

await cp("src/renderer/index.html", `${out}/renderer/index.html`);
await cp("src/renderer/styles.css", `${out}/renderer/styles.css`);

console.log("built apps/desktop/dist");
