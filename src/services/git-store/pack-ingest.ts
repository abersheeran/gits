import { createHash } from "node:crypto";
import { applyDelta, deltaTargetSize } from "./delta";
import { StreamingInflate } from "./inflate";
import {
  checkResolveSize,
  GitMissingObjectError,
  MAX_DELTA_DEPTH,
  objectHash,
  objectHeader,
  objectType,
  TYPE_CODES
} from "./object-format";
import { ObjectStore } from "./object-store";
import { bytesToOid, oidToBytes } from "./oid";
import { PackOffsets, PackReader, type PackInput } from "./pack-input";
import {
  cleanOrphanChunks,
  PayloadWriter,
  readPayload,
  releasePayload,
  type StoredPayload
} from "./payload-store";

export { GitMissingObjectError, GitPackTooLargeError } from "./object-format";

export type IngestOptions = {
  maxBytes?: number;
  onProgress?: (processed: number) => void;
};

type Pending = {
  entry: number;
  base_index: number | null;
  base_oid: string | null;
  payload_size: number;
  data: ArrayBuffer | null;
  chunk_id: number | null;
  stored_size: number;
  delta_chunk_id: number;
};

async function entryHeader(reader: PackReader) {
  let byte = await reader.byte();
  const type = (byte >> 4) & 7;
  let size = byte & 15;
  let factor = 16;
  while (byte & 128) {
    byte = await reader.byte();
    size += (byte & 127) * factor;
    factor *= 128;
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(factor)) {
      throw new Error("Invalid pack object size");
    }
  }
  if (![1, 2, 3, 4, 6, 7].includes(type)) {
    throw new Error("Invalid pack object type");
  }
  return { type, size };
}

async function baseIndex(reader: PackReader, offsets: PackOffsets, entry: number, offset: number) {
  let byte = await reader.byte();
  let distance = byte & 127;
  while (byte & 128) {
    byte = await reader.byte();
    distance = (distance + 1) * 128 + (byte & 127);
    if (!Number.isSafeInteger(distance)) {
      throw new Error("Invalid OFS_DELTA offset");
    }
  }
  if (!distance) {
    throw new Error("Invalid OFS_DELTA offset");
  }
  return offsets.find(offset - distance, entry);
}

function resolveDelta(
  store: ObjectStore,
  baseOid: string,
  delta: Uint8Array,
  payload: StoredPayload
): string {
  const row = store.getRow(baseOid);
  const source = store.read(baseOid);
  checkResolveSize(deltaTargetSize(delta));
  const content = applyDelta(source.content, delta);
  const oid = objectHash(source.type, content);
  if (row.depth + 1 > MAX_DELTA_DEPTH) {
    store.writeFullObject(source.type, content);
    releasePayload(store.sql, payload.chunkId);
  } else {
    store.insert(
      {
        oid,
        type: TYPE_CODES[source.type],
        size: content.length,
        baseOid,
        depth: row.depth + 1,
        payload_size: delta.length
      },
      payload
    );
  }
  return oid;
}

function resolvePending(store: ObjectStore, offsets: PackOffsets): void {
  for (;;) {
    let progress = 0;
    let unresolved = 0;
    let missing = "";
    let after = -1;
    for (;;) {
      const entries = store.sql
        .exec<{
          entry: number;
        }>("SELECT entry FROM ingest_pending WHERE entry > ? ORDER BY entry LIMIT 256", after)
        .toArray();
      if (!entries.length) {
        break;
      }
      for (const { entry } of entries) {
        after = entry;
        const row = store.sql
          .exec<Pending>("SELECT * FROM ingest_pending WHERE entry = ?", entry)
          .one();
        const base = row.base_index === null ? row.base_oid : offsets.getOid(row.base_index);
        const oid = typeof base === "string" ? base : base ? bytesToOid(base) : null;
        if (!oid || !store.has(oid)) {
          unresolved++;
          if (oid) {
            missing = oid;
          }
          continue;
        }
        const delta = new Uint8Array(row.payload_size);
        let offset = 0;
        for (const chunk of readPayload(store.sql, {
          data: null,
          chunk_id: row.delta_chunk_id,
          stored_size: row.payload_size
        })) {
          delta.set(chunk, offset);
          offset += chunk.length;
        }
        const resolved = resolveDelta(store, oid, delta, {
          data: row.data ? new Uint8Array(row.data) : null,
          chunkId: row.chunk_id,
          storedSize: row.stored_size
        });
        releasePayload(store.sql, row.delta_chunk_id);
        offsets.setOid(entry, oidToBytes(resolved));
        store.sql.exec("DELETE FROM ingest_pending WHERE entry = ?", entry).toArray();
        progress++;
      }
    }
    if (!unresolved) {
      return;
    }
    if (!progress) {
      if (missing) {
        throw new GitMissingObjectError(missing);
      }
      throw new Error("Unresolved delta cycle");
    }
  }
}

export async function ingestPack(
  store: ObjectStore,
  input: PackInput,
  options: IngestOptions = {}
) {
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
  ) {
    throw new Error("Invalid maxBytes");
  }
  const startRowid = store.maxRowid();
  store.sql.exec("DROP TABLE IF EXISTS ingest_pending").toArray();
  cleanOrphanChunks(store.sql);
  store.sql
    .exec(
      `CREATE TABLE ingest_pending (
    entry INTEGER PRIMARY KEY, base_index INTEGER, base_oid TEXT, payload_size INTEGER NOT NULL,
    data BLOB, chunk_id INTEGER, stored_size INTEGER NOT NULL, delta_chunk_id INTEGER NOT NULL
  )`
    )
    .toArray();
  const reader = new PackReader(input, options.maxBytes);
  const decoder = new StreamingInflate(() => {
  });
  try {
    const header = await reader.bytes(12);
    const view = new DataView(header.buffer);
    const version = view.getUint32(4);
    const objectCount = view.getUint32(8);
    if (new TextDecoder().decode(header.subarray(0, 4)) !== "PACK" || ![2, 3].includes(version)) {
      throw new Error("Invalid pack header");
    }
    if (objectCount > 2000000) {
      throw new Error("Pack exceeds object count limit");
    }
    const offsets = new PackOffsets(objectCount);
    for (let entry = 0; entry < objectCount; entry++) {
      const offset = reader.offset;
      offsets.setOffset(entry, offset);
      const { type, size } = await entryHeader(reader);
      const index = type === 6 ? await baseIndex(reader, offsets, entry, offset) : null;
      const baseOid = type === 7 ? bytesToOid(await reader.bytes(20)) : null;
      const fullType = type <= 4 ? objectType(type) : null;
      if (!fullType) {
        checkResolveSize(size);
      }
      const hash = fullType ? createHash("sha1").update(objectHeader(fullType, size)) : null;
      const writer = new PayloadWriter(store.sql);
      const delta = fullType ? null : new Uint8Array(size);
      let deltaOffset = 0;
      decoder.reset((bytes) => {
        if (decoder.size > size) {
          throw new Error("Pack object size mismatch");
        }
        hash?.update(bytes);
        if (delta) {
          delta.set(bytes, deltaOffset);
          deltaOffset += bytes.length;
        }
      });
      while (!decoder.ended) {
        const chunk = await reader.peek();
        if (!chunk.length) {
          throw new Error("Truncated pack entry");
        }
        const consumed = decoder.push(chunk);
        writer.write(chunk.subarray(0, consumed));
        reader.consume(consumed);
      }
      if (decoder.size !== size) {
        throw new Error("Pack object size mismatch");
      }
      const payload = writer.finish();
      if (fullType && hash) {
        const oid = hash.digest("hex");
        store.insert({ oid, type, size, baseOid: null, depth: 0, payload_size: size }, payload);
        offsets.setOid(entry, oidToBytes(oid));
      } else {
        const base = index === null ? null : offsets.getOid(index);
        const oid = baseOid ?? (base ? bytesToOid(base) : null);
        if (oid && store.has(oid)) {
          offsets.setOid(entry, oidToBytes(resolveDelta(store, oid, delta!, payload)));
        } else {
          const deltaWriter = new PayloadWriter(store.sql);
          deltaWriter.write(delta!);
          const decoded = deltaWriter.finish(true);
          store.sql
            .exec(
              `INSERT INTO ingest_pending
                (entry, base_index, base_oid, payload_size, data, chunk_id,
                 stored_size, delta_chunk_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              entry,
              index,
              baseOid,
              size,
              payload.data,
              payload.chunkId,
              payload.storedSize,
              decoded.chunkId
            )
            .toArray();
        }
      }
      options.onProgress?.(entry + 1);
    }
    const digest = reader.hash.digest("hex");
    if (bytesToOid(await reader.bytes(20, false)) !== digest) {
      throw new Error("Pack checksum mismatch");
    }
    if ((await reader.peek()).length) {
      throw new Error("Extra bytes after pack");
    }
    resolvePending(store, offsets);
    return { objectCount, startRowid };
  } finally {
    decoder.dispose();
    try {
      await reader.close();
    } finally {
      store.sql.exec("DROP TABLE IF EXISTS ingest_pending").toArray();
    }
  }
}
