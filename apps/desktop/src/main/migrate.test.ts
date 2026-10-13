// @vitest-environment node
import { describe, expect, it } from "vitest";

import { remapEmployeePaths } from "./migrate";

const from = "C:\\Users\\me\\AppData\\Roaming\\Buddy\\data";
const to = "C:\\Users\\me\\AppData\\Roaming\\Wework\\data";

describe("改名迁移的路径改写", () => {
  it("把老目录底下的工作目录与状态目录改到新目录", () => {
    const employees = [
      {
        workspaceDir: `${from}\\workspaces\\HR`,
        stateDir: `${from}\\state\\HR`,
      },
    ];

    expect(remapEmployeePaths(employees, from, to)).toBe(2);
    expect(employees[0]).toEqual({
      workspaceDir: `${to}\\workspaces\\HR`,
      stateDir: `${to}\\state\\HR`,
    });
  });

  it("用户自己指定的工作目录（不在老目录下）原样保留", () => {
    const employees = [{ workspaceDir: "E:\\我的代码\\项目", stateDir: `${from}/state/x` }];

    expect(remapEmployeePaths(employees, from, to)).toBe(1);
    expect(employees[0]?.workspaceDir).toBe("E:\\我的代码\\项目");
    expect(employees[0]?.stateDir).toBe(`${to}/state/x`);
  });

  it("仅仅前缀相同的目录不会被误改", () => {
    const employees = [{ workspaceDir: `${from}Backup\\workspaces\\HR` }];

    expect(remapEmployeePaths(employees, from, to)).toBe(0);
    expect(employees[0]?.workspaceDir).toBe(`${from}Backup\\workspaces\\HR`);
  });

  it("大小写不同的盘符与目录名照样识别（Windows 路径不区分大小写）", () => {
    const employees = [{ workspaceDir: from.toLowerCase() + "\\workspaces\\hr" }];

    expect(remapEmployeePaths(employees, from, to)).toBe(1);
    expect(employees[0]?.workspaceDir).toBe(`${to}\\workspaces\\hr`);
  });
});
