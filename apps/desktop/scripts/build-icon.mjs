/**
 * 图标资产生产线（完全离线，只用本机的 Electron 当光栅化器）。
 *
 * 1. 分别量出「W」与「底座」的墨迹外接框：数 canvas 的 alpha 像素——
 *    Chromium 的 getBoundingClientRect 对 SVG 图形给的是不含描边的几何框，粗描边与斜接尖角都会漏掉；
 * 2. 据此把底座的横向长度对齐成与 W 的横向跨度完全一致，并把 viewBox 校正成正方形；
 * 3. 逐尺寸导出 PNG，再按 ico 规范拼出 wework.ico。
 *
 * 运行：npm run icon -w @wework/desktop
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, app } from "electron";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(here, "..", "assets");
const iconsDir = join(assetsDir, "icons");
const svgPath = join(assetsDir, "wework-icon.svg");
/** 图形坐标所在的固定坐标系；反复运行脚本也不会漂移。 */
const nativeBox = "0 0 64 64";
const measurePx = 512;
/** 图标文件里使用的实色：与界面里的 --blue-strong 一致。 */
const ink = "#19759b";
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
/** ico 里只放到 256：更大的尺寸在目录项里同样记作 0，会与 256 撞车。 */
const icoSizes = (list) => list.filter((size) => size <= 256);

const round = (value) => Math.round(value * 1000) / 1000;
const pick = (pattern, text) => {
  const found = pattern.exec(text);
  if (!found) throw new Error(`源文件里找不到 ${pattern}`);
  return found[0];
};
const attrOf = (element, name) => new RegExp(`${name}="([^"]*)"`).exec(element)?.[1];

/** 去掉注释再编码：源文件里的中文注释会让 btoa 直接抛错，而栅格化并不需要它。 */
const toDataUrl = (svgText) =>
  `"data:image/svg+xml;base64," + btoa(${JSON.stringify(
    svgText.replace(/<!--[\s\S]*?-->/g, ""),
  )})`;

/** 把图形画到 canvas 上，数 alpha 得到墨迹外接框（像素）。 */
const measureScript = (svgText) => `(async () => {
  const image = new Image();
  image.src = ${toDataUrl(svgText)};
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = ${measurePx};
  canvas.height = ${measurePx};
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, ${measurePx}, ${measurePx});
  const data = ctx.getImageData(0, 0, ${measurePx}, ${measurePx}).data;
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1e9;
  let maxY = -1e9;
  for (let y = 0; y < ${measurePx}; y += 1) {
    for (let x = 0; x < ${measurePx}; x += 1) {
      // 阈值避开抗锯齿的极淡边缘
      if (data[(y * ${measurePx} + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
})()`;

const renderScript = (svgText, list) => `(async () => {
  const url = ${toDataUrl(svgText)};
  const out = {};
  for (const size of ${JSON.stringify(list)}) {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);
    out[String(size)] = canvas.toDataURL("image/png").split(",")[1];
  }
  return out;
})()`;

/**
 * 手写 .ico 容器：Vista 之后条目允许直接内嵌 PNG，
 * 所以只要拼文件头、目录项、各尺寸 PNG 三段。
 */
function buildIco(items) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(items.length, 4);

  const entries = Buffer.alloc(16 * items.length);
  let offset = header.length + entries.length;
  items.forEach((item, index) => {
    const at = index * 16;
    // 256 在 ico 目录里用 0 表示
    const dimension = item.size >= 256 ? 0 : item.size;
    entries.writeUInt8(dimension, at);
    entries.writeUInt8(dimension, at + 1);
    entries.writeUInt8(0, at + 2);
    entries.writeUInt8(0, at + 3);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(item.data.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += item.data.length;
  });

  return Buffer.concat([header, entries, ...items.map((item) => item.data)]);
}

app.disableHardwareAcceleration();
app.on("window-all-closed", () => undefined);

async function main() {
  await mkdir(iconsDir, { recursive: true });
  const source = await readFile(svgPath, "utf8");
  const head = source.slice(0, source.indexOf("<svg"));
  const openTag = pick(/<svg[\s\S]*?>/, source);
  // 元素可能被格式化成多行，所以 id 与标签之间允许换行。
  const polyline = pick(/<polyline\s[^>]*id="w-outer"[\s\S]*?\/>/, source);
  const rect = pick(/<rect\s[^>]*id="w-base"[\s\S]*?\/>/, source);
  // 画 W 用到的 <defs> 是可选的（现在没有 mask 就整块不存在）。
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(source)?.[0] ?? "";
  const strokeWidth = Number(attrOf(polyline, "stroke-width"));
  const baseStrokeWidth = Number(attrOf(rect, "stroke-width"));

  const win = new BrowserWindow({ show: false, width: measurePx, height: measurePx });
  await win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent('<!doctype html><meta charset="utf-8"><title>icon</title>'),
  );

  const withAttr = (element, name, value) =>
    element.replace(new RegExp(`${name}="[^"]*"`), `${name}="${value}"`);
  /** 生成一份只含指定图形、坐标固定在 64×64 空间的 SVG（测量时铺满 512px，故 1 单位 = 8px）。 */
  const doc = (shapes, box = nativeBox, px = measurePx, probeClip = "") =>
    `${openTag
      .replace(/viewBox="[^"]*"/, `viewBox="${box}"`)
      .replace(/width="[^"]*"/, `width="${px}"`)
      .replace(/height="[^"]*"/, `height="${px}"`)}${defs}${probeClip}${shapes}</svg>`;
  const scale = measurePx / 64;
  const inkBox = async (shapes, probeClip = "") => {
    const box = await win.webContents.executeJavaScript(
      measureScript(doc(shapes, nativeBox, measurePx, probeClip)),
    );
    return {
      left: box.minX / scale,
      top: box.minY / scale,
      right: (box.maxX + 1) / scale,
      bottom: (box.maxY + 1) / scale,
    };
  };

  // 1. 底座长度对齐 W 的**底部**宽度（两个谷的外沿），不是顶宽：
  //    只量最下面一截墨迹，所以再叠一层只留底带的裁剪。
  const wBox = await inkBox(polyline);
  const bottomProbe = `<clipPath id="probe-bottom" clipPathUnits="userSpaceOnUse"><rect x="0" y="${
    round(wBox.bottom) - 4
  }" width="64" height="4" /></clipPath>`;
  const baseBox = await inkBox(
    `<g clip-path="url(#probe-bottom)">${polyline}</g>`,
    bottomProbe,
  );
  const rBox = await inkBox(rect);
  const alignedRect = withAttr(
    withAttr(rect, "x", round(baseBox.left + baseStrokeWidth / 2)),
    "width",
    round(baseBox.right - baseBox.left - baseStrokeWidth),
  );

  // 2. 整体（含描边与尖角）的外接框 → 正外接正方形，这就是「总比例正方形」。
  const fBox = await inkBox(polyline + alignedRect);
  const side = Math.max(fBox.right - fBox.left, fBox.bottom - fBox.top);
  const centerX = (fBox.left + fBox.right) / 2;
  const centerY = (fBox.top + fBox.bottom) / 2;
  const viewBox = [round(centerX - side / 2), round(centerY - side / 2), round(side), round(side)];
  // 就地替换属性：源文件的注释与换行都保留，只有 viewBox 与底座坐标会被改写。
  const finalSvg = source
    .replace(/viewBox="[^"]*"/, `viewBox="${viewBox.join(" ")}"`)
    .replace(rect, alignedRect);

  console.log(
    `W 墨迹 x[${round(wBox.left)}, ${round(wBox.right)}] y[${round(wBox.top)}, ${round(wBox.bottom)}]` +
      ` = ${round(wBox.right - wBox.left)} × ${round(wBox.bottom - wBox.top)}`,
  );
  console.log(
    `W 顶宽 ${round(wBox.right - wBox.left)}、底宽 ${round(
      baseBox.right - baseBox.left,
    )} → 底座对齐到底宽（原来的底座墨迹 x[${round(rBox.left)}, ${round(rBox.right)}]）`,
  );
  console.log(
    `W 与底座间隙 ${round(rBox.top - wBox.bottom)}；底座中空高度 ${round(
      Number(attrOf(alignedRect, "height")) - Number(attrOf(alignedRect, "stroke-width")),
    )}`,
  );
  console.log(
    `整体墨迹 ${round(fBox.right - fBox.left)} × ${round(fBox.bottom - fBox.top)}` +
      ` → viewBox "${viewBox.join(" ")}"`,
  );

  await writeFile(svgPath, finalSvg, "utf8");

  const pngs = await win.webContents.executeJavaScript(
    renderScript(finalSvg.replace(/currentColor/g, ink), sizes),
  );
  const items = [];
  for (const size of sizes) {
    const data = Buffer.from(pngs[String(size)], "base64");
    await writeFile(join(iconsDir, `wework-${size}.png`), data);
    if (icoSizes(sizes).includes(size)) items.push({ size, data });
  }
  await writeFile(join(assetsDir, "wework.ico"), buildIco(items));

  console.log(
    `已生成 ${sizes.length} 个 PNG（${sizes.join("/")}）与 wework.ico（${icoSizes(sizes).join("/")}）`,
  );
  win.destroy();
  app.quit();
}

void app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
