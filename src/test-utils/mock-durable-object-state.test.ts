import { describe, expect, it } from "vitest";
import { createMockDurableObjectState } from "./mock-durable-object-state";

const limit = 2 * 1024 * 1024;

describe("SQLite Durable Object mock", () => {
  it("supports multi-statement SQL, BLOBs, cursor iteration and raw rows", () => {
    const { sql } = createMockDurableObjectState().storage;
    sql.exec(
      "CREATE TABLE sample (id INTEGER, data BLOB); INSERT INTO sample VALUES (1, ?)",
      new Uint8Array([1, 2]).buffer
    );
    sql.exec("INSERT INTO sample VALUES (2, ?)", new Uint8Array([3]));
    const cursor = sql.exec("SELECT * FROM sample ORDER BY id");
    expect(cursor.columnNames).toEqual(["id", "data"]);
    expect(cursor.next().value).toEqual({ id: 1, data: new Uint8Array([1, 2]).buffer });
    expect([...cursor.raw()]).toEqual([[2, new Uint8Array([3]).buffer]]);
    expect(cursor.toArray()).toEqual([]);
    expect(cursor.rowsRead).toBe(2);
    expect(() => sql.exec("SELECT * FROM sample").one()).toThrow();
    expect(() => sql.exec("SELECT * FROM sample WHERE id = 0").one()).toThrow();
    expect(sql.exec("UPDATE sample SET id = 3 WHERE id = 2").rowsWritten).toBe(1);
    expect(sql.exec("SELECT ';' AS text; SELECT ? AS value", "last").one()).toEqual({
      value: "last"
    });
  });
  it("enforces value, row, binding and statement limits", () => {
    const { sql } = createMockDurableObjectState().storage;
    sql.exec("CREATE TABLE sample (a BLOB, b BLOB)");
    for (const value of [
      new Uint8Array(limit + 1),
      "x".repeat(limit + 1),
      "汉".repeat(limit / 2)
    ]) {
      expect(() => sql.exec("INSERT INTO sample (a) VALUES (?)", value)).toThrow(/2 MB/);
    }
    expect(() =>
      sql.exec(
        "INSERT INTO sample VALUES (?, ?)",
        new Uint8Array(limit / 2 + 1),
        new Uint8Array(limit / 2)
      )
    ).toThrow();
    expect(() => sql.exec("INSERT INTO sample (a) VALUES (zeroblob(2097153))")).toThrow();
    expect(sql.exec("SELECT count(*) AS n FROM sample").one().n).toBe(0);
    expect(() =>
      sql.exec("SELECT " + Array(101).fill("?").join(","), ...Array(101).fill(1))
    ).toThrow(/100 bindings/);
    expect(() => sql.exec(" ".repeat(100 * 1024) + "SELECT 1")).toThrow(/100 KB/);
    for (const command of ["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT x", "RELEASE x"]) {
      expect(() => sql.exec("; /* test */ ; " + command)).toThrow(/transactionSync/);
    }
  });
  it(
    "rolls back synchronous transactions, KV and SQL; clears " + "storage and handles alarms",
    async () => {
      const { storage } = createMockDurableObjectState();
      storage.sql.exec("CREATE TABLE sample (id INTEGER)");
      await storage.put("before", 1);
      expect(() =>
        storage.transactionSync(() => {
          storage.sql.exec("INSERT INTO sample VALUES (1)");
          void storage.put("before", 2);
          throw new Error("rollback");
        })
      ).toThrow("rollback");
      expect(storage.sql.exec("SELECT * FROM sample").toArray()).toEqual([]);
      expect(await storage.get("before")).toBe(1);
      expect(() => storage.transactionSync(async () => 1)).toThrow(/synchronous/);
      expect(() =>
        storage.transactionSync(() => {
          storage.sql.exec("INSERT INTO sample VALUES (2)");
          storage.transactionSync(() => storage.sql.exec("INSERT INTO sample VALUES (3)"));
        })
      ).toThrow(/Nested transactionSync/);
      expect(storage.sql.exec("SELECT * FROM sample").toArray()).toEqual([]);
      await expect(storage.put("k", new Uint8Array(limit))).rejects.toThrow(/2 MB/);
      await expect(storage.put("k", "x".repeat(limit))).rejects.toThrow(/2 MB/);
      await storage.put("k", new Uint8Array(limit - 1));
      await storage.setAlarm(new Date(1234));
      expect(await storage.getAlarm()).toBe(1234);
      await storage.deleteAlarm();
      expect(await storage.getAlarm()).toBe(null);
      await storage.deleteAll();
      expect(await storage.list()).toEqual(new Map());
      expect(
        storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray()
      ).toEqual([]);
    }
  );
});
