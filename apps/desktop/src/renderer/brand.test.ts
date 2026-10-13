// @vitest-environment node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { weworkBrand } from "./brand";

const svgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "wework-icon.svg");
const svg = await readFile(svgPath, "utf8");
const attr = (element: string, name: string): number =>
  Number(new RegExp(`${name}="([^"]*)"`).exec(element)?.[1]);

describe("Wework 标识", () => {
  it("界面里的坐标与图标文件完全一致", () => {
    const openTag = /<svg[\s\S]*?>/.exec(svg)?.[0] ?? "";
    const outer = /<polyline\s[^>]*id="w-outer"[\s\S]*?\/>/.exec(svg)?.[0] ?? "";
    const rect = /<rect\s[^>]*id="w-base"[\s\S]*?\/>/.exec(svg)?.[0] ?? "";
    const clip = /<clipPath[\s\S]*?<\/clipPath>/.exec(svg)?.[0] ?? "";

    expect(openTag).toContain(`viewBox="${weworkBrand.viewBox}"`);
    expect(outer).toContain(`points="${weworkBrand.points}"`);
    expect(attr(outer, "stroke-width")).toBe(weworkBrand.strokeWidth);
    expect(attr(clip, "y")).toBe(weworkBrand.clip.y);
    expect(attr(clip, "height")).toBe(weworkBrand.clip.height);
    expect(attr(rect, "x")).toBe(weworkBrand.base.x);
    expect(attr(rect, "y")).toBe(weworkBrand.base.y);
    expect(attr(rect, "width")).toBe(weworkBrand.base.width);
    expect(attr(rect, "height")).toBe(weworkBrand.base.height);
    expect(attr(rect, "stroke-width")).toBe(weworkBrand.base.strokeWidth);
  });

  it("总比例是正方形：viewBox 宽高相等", () => {
    const [, , width, height] = weworkBrand.viewBox.split(" ").map(Number);
    expect(width).toBe(height);
  });

  it("三个尖与两个谷底都在切线之外，因此会被切平", () => {
    const points = weworkBrand.points.split(" ").map(Number);
    const ys = points.filter((_, index) => index % 2 === 1);
    const cutTop = weworkBrand.clip.y;
    const cutBottom = weworkBrand.clip.y + weworkBrand.clip.height;

    // 三个尖（三个峰）都在上切线之上
    const peaks = [ys[0], ys[2], ys[4]];
    expect(peaks.every((y) => (y ?? 0) < cutTop)).toBe(true);
    // 两个谷都在下切线之下
    expect((ys[1] ?? 0) > cutBottom && (ys[3] ?? 0) > cutBottom).toBe(true);
  });

  it("底座与 W 的底部齐宽、且自身中空", () => {
    // 描边居中：底座的墨迹宽度 = 路径宽度 + 一个描边宽。
    expect(weworkBrand.base.width + weworkBrand.base.strokeWidth).toBeCloseTo(
      weworkBrand.bottomWidth,
      5,
    );
    // 比顶部窄：底座跟着 W 的脚，而不是跟着最宽的那一行。
    expect(weworkBrand.bottomWidth).toBeLessThan(weworkBrand.topWidth);
    // 高度大于描边宽，中间才会有看得见的空心。
    expect(weworkBrand.base.height).toBeGreaterThan(weworkBrand.base.strokeWidth);
  });
});
