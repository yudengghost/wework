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

import * as ResEdit from "resedit";

const appName = "Wework";
const outRoot = resolve("release");
const target = join(outRoot, `${appName}-win32-x64`);
const electronDist = resolve("..", "..", "node_modules", "electron", "dist");

await rm(target, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });
await cp(electronDist, target, { recursive: true });

// electron.exe 改名成 Wework.exe，用户双击的就是它。
await rename(join(target, "electron.exe"), join(target, `${appName}.exe`));

const appDir = join(target, "resources", "app");
await mkdir(appDir, { recursive: true });
await cp(resolve("dist"), join(appDir, "dist"), { recursive: true });
// 图标同样放进应用目录：运行时的窗口图标走这里，不依赖 exe 资源。
await cp(resolve("assets"), join(appDir, "assets"), { recursive: true });
await cp(resolve("assets", "wework.ico"), join(target, `${appName}.ico`));

const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
await writeFile(
  join(appDir, "package.json"),
  `${JSON.stringify(
    {
      name: "wework",
      productName: appName,
      version: manifest.version,
      main: "dist/main/main.cjs",
    },
    null,
    2,
  )}\n`,
);

/**
 * 把图标与版本信息真正写进 exe 的资源段。
 *
 * Electron 自带的 exe 上是它自己的图标与「Electron」版本串，在资源管理器里一眼就能看见；
 * resedit 是纯 JS 的 PE 资源编辑器，不需要联网下载 rcedit，正合我们的离线打包。
 */
const exePath = join(target, `${appName}.exe`);
const exe = ResEdit.NtExecutable.from(await readFile(exePath));
const resources = ResEdit.NtExecutableResource.from(exe);

const iconFile = ResEdit.Data.IconFile.from(await readFile(resolve("assets", "wework.ico")));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  resources.entries,
  1,
  1033,
  iconFile.icons.map((icon) => icon.data),
);

const language = { lang: 1033, codepage: 1200 };
/** RT_VERSION：Electron 自带的版本资源要先摘掉，否则属性面板里会同时出现两套名字。 */
const RT_VERSION = 16;
for (let index = resources.entries.length - 1; index >= 0; index -= 1) {
  if (resources.entries[index].type === RT_VERSION) resources.entries.splice(index, 1);
}

const version = ResEdit.Resource.VersionInfo.createEmpty();
version.setStringValues(
  language,
  {
    ProductName: appName,
    FileDescription: appName,
    CompanyName: appName,
    LegalCopyright: appName,
    InternalName: appName,
    OriginalFilename: `${appName}.exe`,
  },
  true,
);
const [major = 0, minor = 0, micro = 0] = manifest.version.split(".").map(Number);
version.setFileVersion(major, minor, micro, 0, language.lang);
version.setProductVersion(major, minor, micro, 0, language.lang);
version.outputToResourceEntries(resources.entries);

resources.outputResource(exe);
await writeFile(exePath, Buffer.from(exe.generate()));

console.log(`已打包：${exePath}（图标与版本信息已写入 exe）`);
