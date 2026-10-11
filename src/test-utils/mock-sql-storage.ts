import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export const SQL_VALUE_LIMIT = 2 * 1024 * 1024;

function valueSize(value: unknown): number {
  if (typeof value === "string") {
    return Buffer.byteLength(value);
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  return value === null ? 0 : 8;
}

function checkRow(values: unknown[]): void {
  if (values.reduce<number>((size, value) => size + valueSize(value), 0) > SQL_VALUE_LIMIT) {
    throw new Error("SQLite row exceeds 2 MB");
  }
}

class MockSqlCursor<T extends Record<string, SqlStorageValue>> {
  private position = 0;

  constructor(
    private readonly rows: T[],
    readonly columnNames: string[],
    readonly rowsWritten: number
  ) {
  }

  get rowsRead(): number {
    return this.position;
  }

  next(): IteratorResult<T> {
    if (this.position === this.rows.length) {
      return { done: true, value: undefined };
    }
    return { done: false, value: this.rows[this.position++]! };
  }

  toArray(): T[] {
    return Array.from(this);
  }

  one(): T {
    const rows = this.toArray();
    if (rows.length !== 1) {
      throw new Error("Expected exactly one SQL row");
    }
    return rows[0]!;
  }

  raw() {
    const cursor = this;
    return {
      next(): IteratorResult<SqlStorageValue[]> {
        const row = cursor.next();
        return row.done
          ? { done: true, value: undefined }
          : {
              done: false,
              value: cursor.columnNames.map((name) => row.value[name]!)
            };
      },
      [Symbol.iterator]() {
        return this;
      },
      toArray(): SqlStorageValue[][] {
        return Array.from(this);
      }
    };
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this;
  }
}

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function stripComments(query: string): string {
  return query.replace(/^(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "");
}

export class MockSqlStorage {
  private database = new DatabaseSync(":memory:");
  private transactionDepth = 0;

  constructor() {
    this.installRowCheck();
  }

  private installRowCheck(): void {
    this.database.function("__mock_check_row", { varargs: true }, (...values) => {
      checkRow(values);
      return null;
    });
  }

  private addRowChecks(): void {
    const tables = this.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    for (const { name } of tables) {
      const columns = this.database.prepare(`PRAGMA table_info(${quote(String(name))})`).all();
      const args = columns.map((column) => `NEW.${quote(String(column.name))}`).join(",");
      for (const operation of ["INSERT", "UPDATE"]) {
        this.database
          .exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${quote(`__limit_${operation}_${name}`)}
          BEFORE ${operation} ON ${quote(String(name))} BEGIN
          SELECT __mock_check_row(${args}); END`);
      }
    }
  }

  exec<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) {
    if (Buffer.byteLength(query) > 100 * 1024) {
      throw new Error("SQL exceeds 100 KB");
    }
    if (bindings.length > 100) {
      throw new Error("SQL exceeds 100 bindings");
    }
    const values = bindings.map((value): SQLInputValue => {
      if (valueSize(value) > SQL_VALUE_LIMIT) {
        throw new Error("SQL value exceeds 2 MB");
      }
      if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
      }
      if (
        value instanceof Uint8Array ||
        value === null ||
        typeof value === "string" ||
        typeof value === "number"
      ) {
        return value;
      }
      throw new Error("Invalid SQL binding");
    });
    let remaining = query;
    let result = new MockSqlCursor<T>([], [], 0);
    while (stripComments(remaining).replaceAll(";", "").trim()) {
      if (/^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(stripComments(remaining))) {
        throw new Error("Use storage.transactionSync() for transactions");
      }
      const statement = this.database.prepare(remaining);
      remaining = remaining.slice(statement.sourceSQL.length);
      const last = !stripComments(remaining).replaceAll(";", "").trim();
      const args = last ? values : [];
      const columns = statement.columns().map((column) => column.name);
      const before = this.database.prepare("SELECT total_changes() AS n").get()!.n as number;
      const rows = statement.all(...args).map((row) => {
        checkRow(Object.values(row));
        return Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            value instanceof Uint8Array ? Uint8Array.from(value).buffer : value
          ])
        ) as T;
      });
      const after = this.database.prepare("SELECT total_changes() AS n").get()!.n as number;
      if (/^CREATE\s+(?:TEMP\s+)?TABLE\b/i.test(stripComments(statement.sourceSQL))) {
        this.addRowChecks();
      }
      result = new MockSqlCursor(rows, columns, after - before);
    }
    return result;
  }

  transactionSync<T>(callback: () => T): T {
    if (this.transactionDepth) {
      throw new Error("Nested transactionSync is not supported");
    }
    const savepoint = `mock_${this.transactionDepth++}`;
    this.database.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = callback();
      if (
        result &&
        typeof (
          result as {
            then?: unknown;
          }
        ).then === "function"
      ) {
        throw new Error("transactionSync callback must be synchronous");
      }
      this.database.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.database.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  clear(): void {
    this.database.close();
    this.database = new DatabaseSync(":memory:");
    this.installRowCheck();
  }
}
