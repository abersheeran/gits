import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

class Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: SQLInputValue[] = []
  ) {
  }

  bind(...values: SQLInputValue[]) {
    if (values.length > 100) {
      throw new Error("D1 exceeds 100 bindings");
    }
    return new Statement(this.database, this.query, values);
  }

  execute() {
    const statement = this.database.prepare(this.query);
    const before = Number(this.database.prepare("SELECT total_changes() n").get()!.n);
    const results = statement.all(...this.values);
    const after = Number(this.database.prepare("SELECT total_changes() n").get()!.n);
    return { results, success: true, meta: { changes: after - before } };
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }

  async first(column?: string) {
    const row = this.execute().results[0];
    return (column ? row?.[column] : row) ?? null;
  }
}

export function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:", { enableDoubleQuotedStringLiterals: true });
  sqlite.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const db = {
    prepare: (query: string) => new Statement(sqlite, query),
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  } as unknown as D1Database;
  return { db, sqlite };
}
