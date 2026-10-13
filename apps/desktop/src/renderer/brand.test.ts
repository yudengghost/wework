// @vitest-environment node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
    const polyline = /<polyline[\s\S]*?\/>/.exec(svg)?.[0] ?? "";
    const rect = /<rect[\s\S]*?\/>/.exec(svg)?.[0] ?? "";

    expect(openTag).toContain(`viewBox="${weworkBrand.viewBox}"`);
    expect(attr(openTag, "stroke-width")).toBe(weworkBrand.strokeWidth);
    expect(polyline).toContain(`points="${weworkBrand.points}"`);
    expect(attr(rect, "x")).toBe(weworkBrand.base.x);
    expect(attr(rect, "y")).toBe(weworkBrand.base.y);
    expect(attr(rect, "width")).toBe(weworkBrand.base.width);
    expect(attr(rect, "height")).toBe(weworkBrand.base.height);
  });

  it("总比例是正方形：viewBox 宽高相等", () => {
    const [, , width, height] = weworkBrand.viewBox.split(" ").map(Number);
    expect(width).toBe(height);
  });

  it("底座与 W 等宽、且自身中空", () => {
    // 描边居中：底座的墨迹宽度 = 路径宽度 + 一个描边宽。
    expect(weworkBrand.base.width + weworkBrand.strokeWidth).toBeCloseTo(
      weworkBrand.inkWidth,
      5,
    );
    // 高度大于描边宽才会有看不见的空心。
    expect(weworkBrand.base.height).toBeGreaterThan(weworkBrand.strokeWidth);
  });
});
