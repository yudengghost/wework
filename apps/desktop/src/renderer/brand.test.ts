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
    const outer = /<polyline id="w-outer"[\s\S]*?\/>/.exec(svg)?.[0] ?? "";
    const cut = /<polyline id="w-slot-cut"[\s\S]*?\/>/.exec(svg)?.[0] ?? "";
    const rect = /<rect id="w-base"[\s\S]*?\/>/.exec(svg)?.[0] ?? "";

    expect(openTag).toContain(`viewBox="${weworkBrand.viewBox}"`);
    expect(outer).toContain(`points="${weworkBrand.points}"`);
    expect(attr(outer, "stroke-width")).toBe(weworkBrand.strokeWidth);
    expect(cut).toContain(`points="${weworkBrand.slotPoints}"`);
    expect(attr(cut, "stroke-width")).toBe(weworkBrand.slotWidth);
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

  it("底座与 W 等宽、且自身中空", () => {
    // 描边居中：底座的墨迹宽度 = 路径宽度 + 一个描边宽。
    expect(weworkBrand.base.width + weworkBrand.base.strokeWidth).toBeCloseTo(
      weworkBrand.inkWidth,
      5,
    );
    // 高度大于描边宽，中间才会有看得见的空心。
    expect(weworkBrand.base.height).toBeGreaterThan(weworkBrand.base.strokeWidth);
  });

  it("W 自己也是空心的：挖槽比笔画窄，两侧都还留得住墨", () => {
    expect(weworkBrand.slotWidth).toBeLessThan(weworkBrand.strokeWidth);
    expect((weworkBrand.strokeWidth - weworkBrand.slotWidth) / 2).toBeGreaterThan(2);
  });

  it("W 的三个顶端齐平、两个谷底是平口", () => {
    const points = weworkBrand.points.split(" ").map(Number);
    const pairs = points.reduce<[number, number][]>((all, _, index) => {
      if (index % 2 === 0) all.push([points[index] as number, points[index + 1] as number]);
      return all;
    }, []);

    // 三组平口：最左的起手、中间那个顶、最右的收尾，四点的 y 必须一致。
    const tops = [pairs[0], pairs[1], pairs[4], pairs[5], pairs[8], pairs[9]];
    expect(new Set(tops.map((point) => point?.[1])).size).toBe(1);
    // 两个谷底各自是一段水平线：y 相同才算平口。
    expect(pairs[2]?.[1]).toBe(pairs[3]?.[1]);
    expect(pairs[6]?.[1]).toBe(pairs[7]?.[1]);
    expect(pairs[2]?.[1]).toBe(pairs[6]?.[1]);
  });
});
