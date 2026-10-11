export type GitStorage = Pick<DurableObjectStorage, "sql" | "transactionSync">;

export function ensureGitStoreSchema(sql: SqlStorage): void {
  sql
    .exec(
      `
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, oid TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS objects (
      oid BLOB PRIMARY KEY, type INTEGER NOT NULL, size INTEGER NOT NULL,
      base_oid BLOB, depth INTEGER NOT NULL, payload_size INTEGER NOT NULL,
      stored_size INTEGER NOT NULL, data BLOB, chunk_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_objects_chunk ON objects(chunk_id) WHERE chunk_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS object_chunks (
      chunk_id INTEGER NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL,
      PRIMARY KEY (chunk_id, seq)
    ) WITHOUT ROWID;
    INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
  `
    )
    .toArray();
  if (sql.exec("SELECT value FROM meta WHERE key = 'schema_version'").one().value !== "1") {
    throw new Error("Unsupported Git store schema version");
  }
}
