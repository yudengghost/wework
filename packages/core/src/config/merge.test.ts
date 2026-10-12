import { describe, expect, it } from "vitest";

import { deepMerge } from "./merge";

describe("deepMerge", () => {
  it("递归合并嵌套对象", () => {
    const base = { a: { x: 1, y: 2 }, b: 1 };

    expect(deepMerge(base, { a: { y: 9 } })).toEqual({ a: { x: 1, y: 9 }, b: 1 });
  });

  it("数组整体替换而不是拼接", () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] });
  });

  it("忽略 undefined 值，不覆盖既有配置", () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: undefined })).toEqual({ a: 1, b: 2 });
  });

  it("patch 为 null 时整体替换", () => {
    expect(deepMerge({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
  });

  it("不修改传入对象", () => {
    const base = { a: { x: 1 } };

    deepMerge(base, { a: { x: 2 } });

    expect(base.a.x).toBe(1);
  });
});
