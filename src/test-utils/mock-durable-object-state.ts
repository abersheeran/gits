import { serialize } from "node:v8";
import { MockSqlStorage, SQL_VALUE_LIMIT } from "./mock-sql-storage";

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

class MockDurableObjectStorage {
  readonly sql = new MockSqlStorage();
  private alarm: number | null = null;

  transactionSync<T>(callback: () => T): T {
    const values = structuredClone(this.values);
    const alarm = this.alarm;
    try {
      return this.sql.transactionSync(callback);
    } catch (error) {
      this.values.clear();
      for (const [key, value] of values) {
        this.values.set(key, value);
      }
      this.alarm = alarm;
      throw error;
    }
  }

  async deleteAll(): Promise<void> {
    this.values.clear();
    this.alarm = null;
    this.sql.clear();
  }

  async setAlarm(value: number | Date): Promise<void> {
    this.alarm = Number(value);
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }

  private readonly values = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.values.has(key)) {
      return undefined;
    }
    return cloneValue(this.values.get(key) as T);
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    const size =
      value instanceof ArrayBuffer || ArrayBuffer.isView(value)
        ? value.byteLength
        : typeof value === "string"
          ? Buffer.byteLength(value)
          : serialize(value).byteLength;
    if (Buffer.byteLength(key) + size > SQL_VALUE_LIMIT) {
      throw new Error("KV entry exceeds 2 MB");
    }
    this.values.set(key, cloneValue(value));
  }

  async delete(key: string): Promise<boolean>;
  async delete(keys: string[]): Promise<number>;
  async delete(key: string | string[]): Promise<boolean | number> {
    if (typeof key === "string") {
      return this.values.delete(key);
    }
    if (key.length > 128) {
      throw new Error("KV delete exceeds 128 keys");
    }
    return key.reduce((count, item) => count + Number(this.values.delete(item)), 0);
  }

  async list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? "";
    const entries = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, options?.limit)
      .map(([key, value]) => [key, cloneValue(value) as T] as const);
    return new Map(entries);
  }
}

export function createMockDurableObjectState(): DurableObjectState<unknown> & {
  storage: MockDurableObjectStorage;
} {
  const storage = new MockDurableObjectStorage();
  return {
    storage,
    blockConcurrencyWhile: async <T,>(callback: () => Promise<T>) => callback()
  } as DurableObjectState<unknown> & {
    storage: MockDurableObjectStorage;
  };
}
