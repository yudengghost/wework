import { describe, expect, it } from "vitest";

import { extractEmployeeRequests } from "./employeeRequest";

const marker = "@@create-employee";

function block(json: string, header = marker): string {
  return `\`\`\`${header}\n${json}\n\`\`\``;
}

describe("extractEmployeeRequests", () => {
  it("抽出申请并从正文里剥离协议块", () => {
    const body = `我们需要一位测试同学。\n\n${block(
      '{"displayName":"小测","framework":"codex","permissionMode":"read-only"}',
    )}\n\n请批准。`;

    const result = extractEmployeeRequests(body, marker);

    expect(result.drafts).toEqual([
      { displayName: "小测", framework: "codex", permissionMode: "read-only" },
    ]);
    expect(result.body).toBe("我们需要一位测试同学。\n\n请批准。");
    expect(result.errors).toEqual([]);
  });

  it("不碰普通的代码块", () => {
    const body = `看这段命令：\n\n\`\`\`bash\nnpm test\n\`\`\``;

    const result = extractEmployeeRequests(body, marker);

    expect(result.drafts).toEqual([]);
    expect(result.body).toBe(body);
  });

  it("JSON 写坏时报错而不是静默忽略", () => {
    const result = extractEmployeeRequests(block('{"displayName": }'), marker);

    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("JSON");
  });

  it("字段不合法时报错并说明原因", () => {
    const result = extractEmployeeRequests(block('{"framework":"codex"}'), marker);

    expect(result.drafts).toEqual([]);
    expect(result.errors[0]).toContain("不合法");
  });

  it("支持一次多条申请", () => {
    const body = `${block('{"displayName":"甲","framework":"codex"}')}\n${block(
      '{"displayName":"乙","framework":"claude-code"}',
    )}`;

    const result = extractEmployeeRequests(body, marker);

    expect(result.drafts.map((draft) => draft.displayName)).toEqual(["甲", "乙"]);
  });

  it("没有协议块时原样返回", () => {
    const body = "就是一条普通回复";

    const result = extractEmployeeRequests(body, marker);

    expect(result).toEqual({ body, drafts: [], errors: [] });
  });

  it("可选字段留空字符串时按未填写处理，不算错", () => {
    const result = extractEmployeeRequests(
      block('{"displayName":"小测","framework":"codex","model":"","systemPrompt":"  "}'),
      marker,
    );

    expect(result.errors).toEqual([]);
    expect(result.drafts).toEqual([{ displayName: "小测", framework: "codex" }]);
  });

  it("必填字段为空仍然报错，并指出是哪个字段", () => {
    const result = extractEmployeeRequests(
      block('{"displayName":"","framework":"codex"}'),
      marker,
    );

    expect(result.drafts).toEqual([]);
    expect(result.errors[0]).toContain("displayName");
  });
});
