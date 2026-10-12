import { describe, expect, it } from "vitest";

import { CORE_PACKAGE_NAME } from "./index";

describe("@buddy/core", () => {
  it("对外暴露包名常量", () => {
    expect(CORE_PACKAGE_NAME).toBe("@buddy/core");
  });
});
