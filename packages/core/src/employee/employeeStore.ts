import { z } from "zod";

import { createId } from "../domain/ids";
import { employeeSchema, type Employee } from "../domain/schema";
import { DataParseError } from "../storage/errors";
import type { TextFileStore } from "../storage/fileStore";

export class EmployeeNameConflictError extends Error {
  constructor(displayName: string) {
    super(`员工名已被占用: ${displayName}`);
    this.name = "EmployeeNameConflictError";
  }
}

export class EmployeeNotFoundError extends Error {
  constructor(employeeId: string) {
    super(`员工不存在: ${employeeId}`);
    this.name = "EmployeeNotFoundError";
  }
}

/**
 * 用 z.input 而不是派生后的输出类型：默认值字段（如 permissions.allowedTools、skills）
 * 在输入侧是可选的，这样调用方不必把默认值全部写一遍。
 */
export type NewEmployeeInput = Omit<z.input<typeof employeeSchema>, "id" | "createdAt">;

const employeeListSchema = z.array(employeeSchema);

/**
 * 员工名册。
 *
 * 删除分两种：
 * - `remove` 软删除：只打标记，档案留着。历史记录要靠它显示原来的名字，
 *   否则删了人之后旧消息只能显示一串 emp_xxx 的 id。
 * - `purge` 彻底删除：直接移除记录（配套的清理由上层负责）。
 */
export class EmployeeStore {
  private employees: Employee[] = [];

  constructor(
    private readonly store: TextFileStore,
    private readonly filePath: string,
  ) {}

  async load(): Promise<Employee[]> {
    const raw = await this.store.read(this.filePath);
    if (raw === null) {
      this.employees = [];
      return this.listAll();
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new DataParseError("员工文件不是合法 JSON", this.filePath, error);
    }

    const parsed = employeeListSchema.safeParse(json);
    if (!parsed.success) {
      throw new DataParseError(`员工文件校验失败: ${parsed.error.message}`, this.filePath);
    }

    this.employees = parsed.data;
    return this.listAll();
  }

  /** 在册员工（不含已移除的）。 */
  list(): Employee[] {
    return this.employees.filter((employee) => !employee.removedAt).map((item) => ({ ...item }));
  }

  /** 全部档案，含已移除的——用于把历史消息里的名字还原出来。 */
  listAll(): Employee[] {
    return this.employees.map((item) => ({ ...item }));
  }

  /** 已移除的员工，按移除时间倒序。 */
  listRemoved(): Employee[] {
    return this.employees.filter((employee) => employee.removedAt).map((item) => ({ ...item }));
  }

  /** 按 id 查找，包含已移除的（历史记录需要解析姓名）。 */
  get(employeeId: string): Employee | undefined {
    const found = this.employees.find((employee) => employee.id === employeeId);
    return found ? { ...found } : undefined;
  }

  getByName(displayName: string): Employee | undefined {
    const needle = displayName.trim().toLowerCase();
    const found = this.employees.find(
      (employee) =>
        !employee.removedAt && employee.displayName.toLowerCase() === needle,
    );
    return found ? { ...found } : undefined;
  }

  async create(input: NewEmployeeInput): Promise<Employee> {
    this.assertNameAvailable(input.displayName);
    const employee = employeeSchema.parse({
      ...input,
      id: createId("emp"),
      createdAt: new Date().toISOString(),
    });
    this.employees.push(employee);
    await this.persist();
    return { ...employee };
  }

  async update(employeeId: string, patch: Partial<NewEmployeeInput>): Promise<Employee> {
    const index = this.indexOf(employeeId);
    const current = this.employees[index] as Employee;
    if (patch.displayName !== undefined && patch.displayName !== current.displayName) {
      this.assertNameAvailable(patch.displayName, employeeId);
    }

    const updated = employeeSchema.parse({ ...current, ...patch });
    this.employees[index] = updated;
    await this.persist();
    return { ...updated };
  }

  /** 软删除：员工离开名册，档案与历史都保留。 */
  async remove(employeeId: string): Promise<Employee> {
    const index = this.indexOf(employeeId);
    const current = this.employees[index] as Employee;
    const updated: Employee = { ...current, removedAt: new Date().toISOString() };
    this.employees[index] = updated;
    await this.persist();
    return { ...updated };
  }

  /** 把移除的员工放回名册。 */
  async restore(employeeId: string): Promise<Employee> {
    const index = this.indexOf(employeeId);
    const current = this.employees[index] as Employee;
    const { removedAt: _removedAt, ...rest } = current;
    const updated = employeeSchema.parse(rest);
    this.employees[index] = updated;
    await this.persist();
    return { ...updated };
  }

  /** 彻底删除档案。房间、消息、记忆的清理由调用方负责。 */
  async purge(employeeId: string): Promise<void> {
    const index = this.indexOf(employeeId);
    this.employees.splice(index, 1);
    await this.persist();
  }

  private indexOf(employeeId: string): number {
    const index = this.employees.findIndex((employee) => employee.id === employeeId);
    if (index === -1) throw new EmployeeNotFoundError(employeeId);
    return index;
  }

  /** 重名只在在册员工之间判断：移除后名字可以重新使用，历史记录仍保留旧档案。 */
  private assertNameAvailable(displayName: string, exceptEmployeeId?: string): void {
    const existing = this.getByName(displayName);
    if (existing && existing.id !== exceptEmployeeId) {
      throw new EmployeeNameConflictError(displayName);
    }
  }

  private async persist(): Promise<void> {
    await this.store.write(this.filePath, `${JSON.stringify(this.employees, null, 2)}\n`);
  }
}
