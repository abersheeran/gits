import { ObjectStore } from "./object-store";
import { bytesToOid, oidToBytes } from "./oid";

export function findMissingObject(
  store: ObjectStore,
  startRowid: number,
  tipOids: string[]
): string | null {
  const maxRowid = store.maxRowid();
  const visited = new Uint8Array(Math.ceil(Math.max(0, maxRowid - startRowid) / 8));
  const pending: number[] = [];
  function enqueue(oids: string[]): string | null {
    for (let offset = 0; offset < oids.length; offset += 90) {
      const batch = oids.slice(offset, offset + 90);
      const rows = store.sql
        .exec<{
          oid: ArrayBuffer;
          rowid: number;
        }>(
          `SELECT oid, rowid FROM objects WHERE oid IN (${batch.map(() => "?").join(",")})`,
          ...batch.map(oidToBytes)
        )
        .toArray();
      const found = new Map(rows.map((row) => [bytesToOid(row.oid), row.rowid]));
      for (const oid of batch) {
        const rowid = found.get(oid.toLowerCase());
        if (rowid === undefined) {
          return oid;
        }
        if (rowid <= startRowid) {
          continue;
        }
        const index = rowid - startRowid - 1;
        const mask = 1 << (index & 7);
        if (visited[index >> 3]! & mask) {
          continue;
        }
        visited[index >> 3]! |= mask;
        pending.push(rowid);
      }
    }
    return null;
  }
  const missingTip = enqueue(tipOids);
  if (missingTip) {
    return missingTip;
  }
  while (pending.length) {
    const row = store.sql
      .exec<{
        oid: ArrayBuffer;
        type: number;
      }>("SELECT oid, type FROM objects WHERE rowid = ?", pending.pop()!)
      .one();
    const oid = bytesToOid(row.oid);
    let references: string[] = [];
    if (row.type === 1) {
      const { commit } = store.readCommit(oid);
      references = [commit.tree, ...commit.parent];
    } else if (row.type === 2) {
      references = store
        .readTree(oid)
        .tree.filter((entry) => entry.mode !== "160000")
        .map((entry) => entry.oid);
    } else if (row.type === 4) {
      references = [store.readTag(oid).tag.object];
    }
    const missing = enqueue(references);
    if (missing) {
      return missing;
    }
  }
  return null;
}
