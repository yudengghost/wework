import { describe, expect, it } from "vitest";

import { parseMentions } from "./mentions";

const team = [
  { id: "emp_a", displayName: "小码" },
  { id: "emp_b", displayName: "小测" },
  { id: "emp_c", displayName: "Reviewer" },
];

describe("parseMentions", () => {
  it("无 @ 时返回空", () => {
    expect(parseMentions("今天天气不错", team)).toEqual({ mentions: [], unknown: [] });
  });

  it("中文员工名后面紧跟汉字也能正确识别", () => {
    const result = parseMentions("@小码看下这个 bug", team);

    expect(result.mentions).toEqual([{ kind: "employee", employeeId: "emp_a" }]);
    expect(result.unknown).toEqual([]);
  });

  it("支持多个 @ 且按出现顺序", () => {
    const result = parseMentions("@小测 先复现，@小码 再修", team);

    expect(result.mentions).toEqual([
      { kind: "employee", employeeId: "emp_b" },
      { kind: "employee", employeeId: "emp_a" },
    ]);
  });

  it("@all 与中文别名都解析成群发", () => {
    expect(parseMentions("@all 都来看", team).mentions).toEqual([{ kind: "all" }]);
    expect(parseMentions("@全体 都来看", team).mentions).toEqual([{ kind: "all" }]);
  });

  it("英文名大小写不敏感", () => {
    expect(parseMentions("@reviewer 帮忙看", team).mentions).toEqual([
      { kind: "employee", employeeId: "emp_c" },
    ]);
  });

  it("重复 @ 同一人只投递一次", () => {
    const result = parseMentions("@小码 @小码 两次", team);

    expect(result.mentions).toHaveLength(1);
  });

  it("未知的 @ 记入 unknown 且不产生投递", () => {
    const result = parseMentions("@不存在的人 你好", team);

    expect(result.mentions).toEqual([]);
    expect(result.unknown).toEqual(["不存在的人"]);
  });

  it("邮箱里的 @ 不会被误当成提人", () => {
    const result = parseMentions("发到 someone@example.com", team);

    expect(result.mentions).toEqual([]);
  });
});
