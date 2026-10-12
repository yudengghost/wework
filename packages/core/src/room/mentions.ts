import type { Mention } from "../domain/schema";

export interface MentionCandidate {
  id: string;
  displayName: string;
}

export interface MentionParseResult {
  mentions: Mention[];
  /** 写成了 @xxx 但没匹配到任何员工的片段，用于 UI 提示。 */
  unknown: string[];
}

/** 群发写法。 */
const broadcastAliases = ["all", "全体", "所有人", "全体成员"];

/**
 * 解析正文里的 @。
 *
 * 采用「最长员工名优先」的前缀匹配，而不是先切 token 再查表：中文员工名后面常常紧跟
 * 其它汉字（如 `@小码看下这个`），按空白切分会把「小码看下这个」整段当成名字。
 */
export function parseMentions(body: string, candidates: MentionCandidate[]): MentionParseResult {
  const mentions: Mention[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  const byName = [...candidates].sort(
    (left, right) => right.displayName.length - left.displayName.length,
  );
  const broadcast = [...broadcastAliases].sort((left, right) => right.length - left.length);

  let index = 0;
  while (index < body.length) {
    if (body[index] !== "@") {
      index += 1;
      continue;
    }

    const rest = body.slice(index + 1);
    const restLower = rest.toLowerCase();

    const employee = byName.find((candidate) =>
      restLower.startsWith(candidate.displayName.toLowerCase()),
    );
    if (employee) {
      if (!seen.has(employee.id)) {
        seen.add(employee.id);
        mentions.push({ kind: "employee", employeeId: employee.id });
      }
      index += 1 + employee.displayName.length;
      continue;
    }

    const alias = broadcast.find((candidate) => restLower.startsWith(candidate.toLowerCase()));
    if (alias) {
      if (!seen.has("all")) {
        seen.add("all");
        mentions.push({ kind: "all" });
      }
      index += 1 + alias.length;
      continue;
    }

    // 没匹配到：把这个 @ 后面的连续非空白片段记为未知，便于提示用户。
    const token = /^[^\s，。,.!！?？;；:：]+/.exec(rest)?.[0] ?? "";
    if (token !== "") unknown.push(token);
    index += 1 + token.length;
  }

  return { mentions, unknown };
}
