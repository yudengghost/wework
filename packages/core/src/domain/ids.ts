import { randomUUID } from "node:crypto";

export const idPrefixes = ["emp", "room", "msg", "run", "appr", "att", "mem"] as const;
export type IdPrefix = (typeof idPrefixes)[number];

/** 生成形如 `emp_9f2c1a0b3d4e` 的短 id：前缀 + 12 位十六进制。 */
export function createId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
