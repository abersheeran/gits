export const CHUNK_BYTES = 1024 * 1024;

export type StoredPayload = {
  data: Uint8Array | null;
  chunkId: number | null;
  storedSize: number;
};

export type PayloadRow = {
  data: ArrayBuffer | null;
  chunk_id: number | null;
  stored_size: number;
};

export class PayloadWriter {
  private buffer: Uint8Array = new Uint8Array(0);
  private used = 0;
  private seq = 0;
  private chunkId: number | null = null;
  private storedSize = 0;

  constructor(private readonly sql: SqlStorage) {
  }

  private flush(): void {
    if (this.chunkId === null) {
      this.chunkId = Number(
        this.sql
          .exec(
            `INSERT INTO meta (key, value) VALUES ('next_chunk_id', '1')
        ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value`
          )
          .one().value
      );
    }
    this.sql
      .exec(
        "INSERT INTO object_chunks (chunk_id, seq, data) VALUES (?, ?, ?)",
        this.chunkId,
        this.seq++,
        this.buffer.subarray(0, this.used)
      )
      .toArray();
    this.used = 0;
  }

  write(bytes: Uint8Array): void {
    this.storedSize += bytes.length;
    for (let offset = 0; offset < bytes.length; ) {
      if (this.used === CHUNK_BYTES) {
        this.flush();
      }
      const needed = Math.min(CHUNK_BYTES, this.used + bytes.length - offset);
      if (needed > this.buffer.length) {
        const capacity = Math.min(CHUNK_BYTES, Math.max(needed, this.buffer.length * 2, 256));
        const buffer = new Uint8Array(capacity);
        buffer.set(this.buffer.subarray(0, this.used));
        this.buffer = buffer;
      }
      const size = Math.min(CHUNK_BYTES - this.used, bytes.length - offset);
      this.buffer.set(bytes.subarray(offset, offset + size), this.used);
      this.used += size;
      offset += size;
    }
  }

  finish(chunked = false): StoredPayload {
    if ((chunked || this.chunkId !== null) && this.used) {
      this.flush();
    }
    return {
      data: this.chunkId === null ? this.buffer.slice(0, this.used) : null,
      chunkId: this.chunkId,
      storedSize: this.storedSize
    };
  }
}

export function* readPayload(sql: SqlStorage, row: PayloadRow): Generator<Uint8Array> {
  if (row.data !== null) {
    if (row.data.byteLength !== row.stored_size) {
      throw new Error("Invalid inline payload size");
    }
    yield new Uint8Array(row.data);
    return;
  }
  if (row.chunk_id === null) {
    throw new Error("Missing object payload");
  }
  let total = 0;
  for (let seq = 0; total < row.stored_size; seq++) {
    const chunk = sql
      .exec<{
        data: ArrayBuffer;
      }>("SELECT data FROM object_chunks WHERE chunk_id = ? AND seq = ?", row.chunk_id, seq)
      .toArray()[0];
    if (!chunk || !chunk.data.byteLength) {
      throw new Error("Missing object chunk");
    }
    total += chunk.data.byteLength;
    if (total > row.stored_size) {
      throw new Error("Invalid chunked payload size");
    }
    yield new Uint8Array(chunk.data);
  }
}

export function releasePayload(sql: SqlStorage, chunkId: number | null): void {
  if (chunkId !== null) {
    sql.exec("DELETE FROM object_chunks WHERE chunk_id = ?", chunkId).toArray();
  }
}

export function cleanOrphanChunks(sql: SqlStorage): void {
  sql
    .exec(
      "DELETE FROM object_chunks WHERE chunk_id NOT IN (SELECT chunk_id " +
        "FROM objects WHERE chunk_id IS NOT NULL)"
    )
    .toArray();
}
