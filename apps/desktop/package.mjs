/**
 * 离线打包：不依赖 electron-builder / electron-packager 的联网下载。
 *
 * Electron 的应用加载约定很简单——把它自己的运行时整个复制一份，
 * 把 `electron.exe` 改成产品名，再把应用放进 `resources/app/`（含一个 `main` 指向入口的
 * package.json）即可。我们的 main.cjs 已经把 core 全部打进去了，所以运行时不需要任何
 * node_modules。
 */
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const appName = "Buddy";
const outRoot = resolve("release");
const target = join(outRoot, `${appName}-win32-x64`);
const electronDist = resolve("..", "..", "node_modules", "electron", "dist");

await rm(target, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });
await cp(electronDist, target, { recursive: true });

// electron.exe 改名成 Buddy.exe，用户双击的就是它。
await rename(join(target, "electron.exe"), join(target, `${appName}.exe`));

const appDir = join(target, "resources", "app");
await mkdir(appDir, { recursive: true });
await cp(resolve("dist"), join(appDir, "dist"), { recursive: true });

const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
await writeFile(
  join(appDir, "package.json"),
  `${JSON.stringify(
    {
      name: "buddy",
      productName: appName,
      version: manifest.version,
      main: "dist/main/main.cjs",
    },
    null,
    2,
  )}\n`,
);

console.log(`已打包：${join(target, `${appName}.exe`)}`);
