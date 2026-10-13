/**
 * 改名迁移的纯逻辑：把员工档案里指向老数据目录的路径改写到新目录。
 *
 * 为什么需要它：工作目录与状态目录都落在数据目录里，而档案存的是**绝对路径**。
 * 只把文件拷过来、不改路径的话，员工会继续读写老目录，新目录永远缺一块，
 * 用户也就永远不敢删掉老目录。
 *
 * 只处理「在老目录底下」的路径：用户把工作目录指到别处（比如自己的代码仓库）时原样保留。
 */
export interface EmployeePathRecord {
  workspaceDir?: unknown;
  stateDir?: unknown;
}

const trimTail = (path: string): string => path.replace(/[\\/]+$/, "");

/** 返回改写了几处，方便调用方决定要不要落盘。 */
export function remapEmployeePaths<T extends EmployeePathRecord>(
  employees: T[],
  from: string,
  to: string,
): number {
  const source = trimTail(from);
  const target = trimTail(to);
  let changed = 0;

  for (const employee of employees) {
    for (const key of ["workspaceDir", "stateDir"] as const) {
      const value = employee[key];
      if (typeof value !== "string") continue;
      const rest = value.slice(source.length);
      // 必须正好是「老目录 + 分隔符」开头，避免把 BuddyData 这种同前缀目录误伤。
      if (value.slice(0, source.length).toLowerCase() !== source.toLowerCase()) continue;
      if (!rest.startsWith("\\") && !rest.startsWith("/")) continue;

      employee[key] = `${target}${rest}`;
      changed += 1;
    }
  }

  return changed;
}
