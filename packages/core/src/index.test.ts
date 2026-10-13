import { describe, expect, it } from "vitest";

import {
  CORE_PACKAGE_NAME,
  ConfigStore,
  EmployeeStore,
  FileStore,
  MessageLog,
  RoomStore,
  createId,
  defaultConfig,
} from "./index";

describe("@wework/core", () => {
  it("对外暴露包名常量", () => {
    expect(CORE_PACKAGE_NAME).toBe("@wework/core");
  });

  it("通过公共入口暴露全部核心构件", () => {
    expect(typeof createId).toBe("function");
    expect(typeof defaultConfig).toBe("function");
    for (const ctor of [ConfigStore, EmployeeStore, RoomStore, MessageLog, FileStore]) {
      expect(typeof ctor).toBe("function");
    }
  });
});
