import { describe, expect, it } from "vitest";

import { createId } from "./ids";

describe("createId", () => {
  it("带前缀且形态稳定", () => {
    expect(createId("emp")).toMatch(/^emp_[0-9a-f]{12}$/);
    expect(createId("room")).toMatch(/^room_[0-9a-f]{12}$/);
  });

  it("连续生成不重复", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId("msg")));

    expect(ids.size).toBe(1000);
  });
});
