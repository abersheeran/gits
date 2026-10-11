import { Deflate } from "pako";
import { applyDelta, deltaTargetSize } from "./delta";
import { inflateChunks, StreamingInflate } from "./inflate";
import {
  checkResolveSize,
  GitObjectNotFoundError,
  MAX_DELTA_DEPTH,
  objectHash,
  objectType,
  TYPE_CODES,
  type ObjectType
} from "./object-format";
import { bytesToOid, oidToBytes } from "./oid";
import { parseBlob, parseCommit, parseTag, parseTree } from "./parse";
import { PayloadWriter, readPayload, releasePayload, type StoredPayload } from "./payload-store";

export {
  GitObjectNotFoundError,
  GitObjectTooLargeError,
  MAX_DELTA_DEPTH,
  MAX_RESOLVE_BYTES
} from "./object-format";

export type ObjectRow = {
  rowid: number;
  oid: ArrayBuffer;
  type: number;
  size: number;
  base_oid: ArrayBuffer | null;
  depth: number;
  payload_size: number;
  stored_size: number;
  data: ArrayBuffer | null;
  chunk_id: number | null;
};

/** Content buffers are shared with the cache; callers must not modify them. */
export type ResolvedObject = {
  type: ObjectType;
  content: Uint8Array;
};

export type ObjectMetadata = Omit<
  ObjectRow,
  "oid" | "base_oid" | "data" | "chunk_id" | "stored_size" | "rowid"
> & {
  oid: string;
  baseOid: string | null;
};

const CACHE_BYTES = 24 * 1024 * 1024;

const CACHE_OBJECT_BYTES = 4 * 1024 * 1024;

const CACHE_ENTRY_BYTES = 256;

export class ObjectStore {
  private readonly cache = new Map<string, ResolvedObject>();
  private cacheBytes = 0;

  constructor(readonly sql: SqlStorage) {
  }

  has(oid: string): boolean {
    return this.getRowid(oid) !== null;
  }

  hasMany(oids: string[]): Map<string, boolean> {
    const result = new Map<string, boolean>();
    for (let i = 0; i < oids.length; i += 90) {
      const batch = oids.slice(i, i + 90);
      const rows = this.sql
        .exec<{
          oid: ArrayBuffer;
        }>(
          `SELECT oid FROM objects WHERE oid IN (${batch.map(() => "?").join(",")})`,
          ...batch.map(oidToBytes)
        )
        .toArray();
      const present = new Set(rows.map((row) => bytesToOid(row.oid)));
      for (const oid of batch) {
        result.set(oid, present.has(oid.toLowerCase()));
      }
    }
    return result;
  }

  getRowid(oid: string): number | null {
    return (
      this.sql
        .exec<{
          rowid: number;
        }>("SELECT rowid FROM objects WHERE oid = ?", oidToBytes(oid))
        .toArray()[0]?.rowid ?? null
    );
  }

  maxRowid(): number {
    return this.sql
      .exec<{
        n: number;
      }>("SELECT COALESCE(MAX(rowid), 0) AS n FROM objects")
      .one().n;
  }

  readHeader(oid: string): {
    type: ObjectType;
    size: number;
  } | null {
    const row = this.sql
      .exec<{
        type: number;
        size: number;
      }>("SELECT type, size FROM objects WHERE oid = ?", oidToBytes(oid))
      .toArray()[0];
    return row ? { type: objectType(row.type), size: row.size } : null;
  }

  getRow(oid: string): ObjectRow {
    const row = this.sql
      .exec<ObjectRow>("SELECT rowid, * FROM objects WHERE oid = ?", oidToBytes(oid))
      .toArray()[0];
    if (!row) {
      throw new GitObjectNotFoundError(oid);
    }
    return row;
  }

  *readPayload(oid: string): Generator<Uint8Array> {
    yield* readPayload(this.sql, this.getRow(oid));
  }

  private remember(oid: string, object: ResolvedObject): void {
    if (object.content.length > CACHE_OBJECT_BYTES) {
      return;
    }
    const prior = this.cache.get(oid);
    if (prior) {
      this.cacheBytes -= prior.content.length + CACHE_ENTRY_BYTES;
      this.cache.delete(oid);
    }
    while (this.cacheBytes + object.content.length + CACHE_ENTRY_BYTES > CACHE_BYTES) {
      const key = this.cache.keys().next().value!;
      this.cacheBytes -= this.cache.get(key)!.content.length + CACHE_ENTRY_BYTES;
      this.cache.delete(key);
    }
    this.cache.set(oid, object);
    this.cacheBytes += object.content.length + CACHE_ENTRY_BYTES;
  }

  read(oid: string): ResolvedObject {
    oid = bytesToOid(oidToBytes(oid));
    const chain: Array<{
      oid: string;
      row: ObjectRow;
    }> = [];
    let current = oid;
    let resolved: ResolvedObject;
    for (;;) {
      const cached = this.cache.get(current);
      if (cached) {
        this.remember(current, cached);
        resolved = cached;
        break;
      }
      const row = this.getRow(current);
      checkResolveSize(row.size);
      checkResolveSize(row.payload_size);
      if (!row.base_oid) {
        resolved = {
          type: objectType(row.type),
          content: inflateChunks(readPayload(this.sql, row), row.size)
        };
        this.remember(current, resolved);
        break;
      }
      if (chain.some((entry) => entry.oid === current) || chain.length >= MAX_DELTA_DEPTH) {
        throw new Error("Invalid delta chain");
      }
      chain.push({ oid: current, row });
      current = bytesToOid(row.base_oid);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const entry = chain[i]!;
      const delta = inflateChunks(readPayload(this.sql, entry.row), entry.row.payload_size);
      const targetSize = deltaTargetSize(delta);
      checkResolveSize(targetSize);
      if (targetSize !== entry.row.size) {
        throw new Error("Invalid delta object size");
      }
      const content = applyDelta(resolved.content, delta);
      if (content.length !== entry.row.size || TYPE_CODES[resolved.type] !== entry.row.type) {
        throw new Error("Invalid delta object metadata");
      }
      resolved = { type: resolved.type, content };
      this.remember(entry.oid, resolved);
    }
    return resolved;
  }

  readPrefix(oid: string, maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new Error("Invalid prefix size");
    }
    const row = this.getRow(oid);
    if (row.base_oid) {
      const object = this.read(oid);
      return {
        type: object.type,
        size: row.size,
        content: object.content.slice(0, maxBytes),
        truncated: row.size > maxBytes
      };
    }
    const content = new Uint8Array(Math.min(maxBytes, row.size));
    let offset = 0;
    const decoder = new StreamingInflate((bytes) => {
      const length = Math.min(bytes.length, content.length - offset);
      content.set(bytes.subarray(0, length), offset);
      offset += length;
      if (offset === content.length && row.size > content.length) {
        return false;
      }
    });
    try {
      if (content.length || !row.size) {
        for (const chunk of readPayload(this.sql, row)) {
          const consumed = decoder.push(chunk);
          if (decoder.stopped) {
            break;
          }
          if (consumed !== chunk.length) {
            throw new Error("Extra zlib bytes");
          }
        }
        if (!decoder.stopped) {
          decoder.finish();
          if (decoder.size !== row.size) {
            throw new Error("Object size mismatch");
          }
        }
      }
      if (offset !== content.length) {
        throw new Error("Truncated object");
      }
      return {
        type: objectType(row.type),
        size: row.size,
        content,
        truncated: row.size > maxBytes
      };
    } finally {
      decoder.dispose();
    }
  }

  private typed(oid: string, type: ObjectType): Uint8Array {
    const object = this.read(oid);
    if (object.type !== type) {
      throw new Error(`Expected ${type}, got ${object.type}`);
    }
    return object.content;
  }

  readCommit(oid: string) {
    return parseCommit(oid, this.typed(oid, "commit"));
  }

  readTree(oid: string) {
    return parseTree(oid, this.typed(oid, "tree"));
  }

  readTag(oid: string) {
    return parseTag(oid, this.typed(oid, "tag"));
  }

  readBlob(oid: string) {
    return parseBlob(oid, this.typed(oid, "blob"));
  }

  insert(metadata: ObjectMetadata, payload: StoredPayload): void {
    const inserted = this.sql
      .exec<{
        rowid: number;
      }>(
        `INSERT OR IGNORE INTO objects
      (oid, type, size, base_oid, depth, payload_size, stored_size, data, chunk_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rowid`,
        oidToBytes(metadata.oid),
        metadata.type,
        metadata.size,
        metadata.baseOid ? oidToBytes(metadata.baseOid) : null,
        metadata.depth,
        metadata.payload_size,
        payload.storedSize,
        payload.data,
        payload.chunkId
      )
      .toArray();
    if (!inserted.length) {
      releasePayload(this.sql, payload.chunkId);
    }
  }

  writeFullObject(type: ObjectType, content: Uint8Array): string {
    const oid = objectHash(type, content);
    if (this.has(oid)) {
      return oid;
    }
    const writer = new PayloadWriter(this.sql);
    const encoder = new Deflate();
    encoder.onData = (chunk) => writer.write(chunk as Uint8Array);
    for (let offset = 0; offset < content.length; offset += 64 * 1024) {
      encoder.push(content.subarray(offset, offset + 64 * 1024), false);
    }
    encoder.push(new Uint8Array(), true);
    if (encoder.err) {
      throw new Error(encoder.msg);
    }
    this.insert(
      {
        oid,
        type: TYPE_CODES[type],
        size: content.length,
        baseOid: null,
        depth: 0,
        payload_size: content.length
      },
      writer.finish()
    );
    return oid;
  }
}
