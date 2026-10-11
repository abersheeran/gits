import { createHash } from "node:crypto";
import { StorageService } from "../storage-service";
import { StreamingInflate } from "./inflate";
import { importLooseObject } from "./legacy-loose";
import { LegacyRefs, type SkippedLegacyRef } from "./legacy-refs";
import { GitMissingObjectError, objectHash, objectHeader, objectType } from "./object-format";
import { ObjectStore } from "./object-store";
import { bytesToOid } from "./oid";
import { ingestPack } from "./pack-ingest";
import { RefStore } from "./ref-store";
import { ensureGitStoreSchema, type GitStorage } from "./schema";

function verifyObjects(store: ObjectStore): void {
  let after = 0;
  for (;;) {
    const rows = store.sql
      .exec<{
        oid: ArrayBuffer;
        rowid: number;
        type: number;
        size: number;
        base_oid: ArrayBuffer | null;
      }>(
        "SELECT oid, rowid, type, size, base_oid FROM objects WHERE rowid " +
          "> ? ORDER BY rowid LIMIT 256",
        after
      )
      .toArray();
    if (!rows.length) {
      return;
    }
    for (const row of rows) {
      after = row.rowid;
      const oid = bytesToOid(row.oid);
      let actual: string;
      if (row.base_oid) {
        const object = store.read(oid);
        actual = objectHash(object.type, object.content);
      } else {
        const hash = createHash("sha1").update(objectHeader(objectType(row.type), row.size));
        const decoder = new StreamingInflate((bytes) => {
          hash.update(bytes);
        });
        try {
          for (const chunk of store.readPayload(oid)) {
            if (decoder.ended || decoder.push(chunk) !== chunk.length) {
              throw new Error("Invalid imported payload");
            }
          }
          decoder.finish();
          if (decoder.size !== row.size) {
            throw new Error("Imported object size mismatch");
          }
        } finally {
          decoder.dispose();
        }
        actual = hash.digest("hex");
      }
      if (actual !== oid) {
        throw new Error(`Imported object OID mismatch: ${oid}`);
      }
    }
  }
}

export async function importLegacyRepository(args: {
  storage: GitStorage;
  source: StorageService;
  owner: string;
  repo: string;
  store?: ObjectStore;
  cleanupPending?: boolean;
}): Promise<{
  objectCount: number;
  refCount: number;
  skippedRefs: SkippedLegacyRef[];
}> {
  const { storage, source, owner, repo } = args;
  ensureGitStoreSchema(storage.sql);
  const store = args.store ?? new ObjectStore(storage.sql);
  const refs = new RefStore(storage);
  const prefix = `${source.repoPrefix(owner, repo)}/`;
  const packs: Array<{
    key: string;
    uploaded: Date;
  }> = [];
  const importedRefs = new LegacyRefs();
  let cursor: string | undefined;
  do {
    const page = await source.list(prefix, cursor);
    for (const item of page.objects) {
      const path = item.key.slice(prefix.length);
      const loose = /^objects\/([0-9a-f]{2})\/([0-9a-f]{38})$/.exec(path);
      if (loose) {
        const stream = await source.getStream(item.key);
        if (!stream) {
          throw new Error(`Legacy object disappeared: ${item.key}`);
        }
        await importLooseObject(store, loose[1]! + loose[2]!, stream);
      } else if (/^objects\/pack\/[^/]+\.pack$/.test(path)) {
        packs.push({ key: item.key, uploaded: item.uploaded });
      } else if (path.startsWith("refs/")) {
        const value = await source.getText(item.key);
        if (value === null) {
          throw new Error(`Legacy ref disappeared: ${path}`);
        }
        importedRefs.add(path, value);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  let pending = packs.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
  while (pending.length) {
    const before = store.maxRowid();
    const retry: typeof packs = [];
    let missing: GitMissingObjectError | undefined;
    for (const pack of pending) {
      const stream = await source.getStream(pack.key);
      if (!stream) {
        throw new Error(`Legacy pack disappeared: ${pack.key}`);
      }
      try {
        await ingestPack(store, stream);
      } catch (error) {
        if (!(error instanceof GitMissingObjectError)) {
          throw error;
        }
        retry.push(pack);
        missing = error;
      }
    }
    if (retry.length === pending.length && store.maxRowid() === before) {
      throw missing;
    }
    pending = retry;
  }
  const packedRefs = await source.getText(prefix + "packed-refs");
  importedRefs.addPacked(packedRefs ?? "");
  verifyObjects(store);
  for (const [oid, exists] of store.hasMany(importedRefs.entries().map(([, oid]) => oid))) {
    if (!exists) {
      throw new Error(`Legacy ref points to missing object: ${oid}`);
    }
  }
  const head = importedRefs.selectHead(await source.readHead(owner, repo));
  if (!head.startsWith("ref: ") && !store.has(head)) {
    throw new Error("Legacy HEAD points to missing object");
  }
  importedRefs.publish(refs, head, args.cleanupPending);
  const objectCount = storage.sql
    .exec<{
      n: number;
    }>("SELECT COUNT(*) AS n FROM objects")
    .one().n;
  return {
    objectCount,
    refCount: importedRefs.entries().length,
    skippedRefs: importedRefs.skippedRefs
  };
}
