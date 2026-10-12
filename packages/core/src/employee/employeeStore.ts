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
      return this.list();
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
    return this.list();
  }

  list(): Employee[] {
    return [...this.employees];
  }

  get(employeeId: string): Employee | undefined {
    return this.employees.find((employee) => employee.id === employeeId);
  }

  getByName(displayName: string): Employee | undefined {
    const needle = displayName.trim().toLowerCase();
    return this.employees.find((employee) => employee.displayName.toLowerCase() === needle);
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
    return employee;
  }

  async update(employeeId: string, patch: Partial<NewEmployeeInput>): Promise<Employee> {
    const index = this.employees.findIndex((employee) => employee.id === employeeId);
    if (index === -1) throw new EmployeeNotFoundError(employeeId);

    const current = this.employees[index] as Employee;
    if (patch.displayName !== undefined && patch.displayName !== current.displayName) {
      this.assertNameAvailable(patch.displayName, employeeId);
    }

    const updated = employeeSchema.parse({ ...current, ...patch });
    this.employees[index] = updated;
    await this.persist();
    return updated;
  }

  async remove(employeeId: string): Promise<void> {
    const index = this.employees.findIndex((employee) => employee.id === employeeId);
    if (index === -1) throw new EmployeeNotFoundError(employeeId);
    this.employees.splice(index, 1);
    await this.persist();
  }

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
