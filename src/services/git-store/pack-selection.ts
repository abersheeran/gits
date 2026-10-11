import { GitObjectNotFoundError } from "./object-format";
import { ObjectStore, type ObjectRow } from "./object-store";
import { bytesToOid, oidToBytes } from "./oid";

export type PackSelection =
  | { kind: "all"; maxRowid: number; excludeBlobs?: boolean; blobMaxSize?: number }
  | { kind: "oids"; oids: string[] };

type SelectedRow = ObjectRow & { base_included: number };
const ROW_COLUMNS = `o.rowid, o.oid, o.type, o.size, o.base_oid, o.depth,
  o.payload_size, o.stored_size, o.chunk_id,
  CASE WHEN o.stored_size <= 65536 THEN o.data ELSE NULL END AS data`;

function allCondition(selection: Extract<PackSelection, { kind: "all" }>) {
  if (!Number.isSafeInteger(selection.maxRowid) || selection.maxRowid < 0) {
    throw new Error("Invalid maxRowid");
  }
  const clauses = ["o.rowid <= ?"];
  const bindings = [selection.maxRowid];
  if (selection.excludeBlobs) {
    clauses.push("o.type != 3");
  }
  if (selection.blobMaxSize !== undefined) {
    if (!Number.isSafeInteger(selection.blobMaxSize) || selection.blobMaxSize < 0) {
      throw new Error("Invalid blob limit");
    }
    clauses.push("(o.type != 3 OR o.size <= ?)");
    bindings.push(selection.blobMaxSize);
  }
  return { query: clauses.join(" AND "), bindings };
}

export function selectPackRows(store: ObjectStore, selection: PackSelection) {
  if (selection.kind === "oids") {
    const oids = [...new Set(selection.oids.map((oid) => bytesToOid(oidToBytes(oid))))];
    const selected = new Set(oids);
    for (const [oid, exists] of store.hasMany(oids)) {
      if (!exists) {
        throw new GitObjectNotFoundError(oid);
      }
    }
    function* rows(): Generator<SelectedRow> {
      for (let offset = 0; offset < oids.length; offset += 90) {
        const batch = oids.slice(offset, offset + 90);
        const placeholders = batch.map(() => "?").join(",");
        const found = store.sql
          .exec<ObjectRow>(
            `SELECT ${ROW_COLUMNS} FROM objects o WHERE o.oid IN (${placeholders})`,
            ...batch.map(oidToBytes)
          )
          .toArray();
        const byOid = new Map(found.map((row) => [bytesToOid(row.oid), row]));
        for (const oid of batch) {
          const row = byOid.get(oid);
          if (!row) {
            throw new GitObjectNotFoundError(oid);
          }
          yield {
            ...row,
            base_included: Number(!row.base_oid || selected.has(bytesToOid(row.base_oid)))
          };
        }
      }
    }
    return { count: oids.length, rows: rows() };
  }

  const condition = allCondition(selection);
  const count = store.sql
    .exec<{
      n: number;
    }>(`SELECT COUNT(*) AS n FROM objects o WHERE ${condition.query}`, ...condition.bindings)
    .one().n;
  // Delta bases have an earlier rowid and the same type; only blob size can exclude them.
  const checkBaseSize = selection.blobMaxSize !== undefined && !selection.excludeBlobs;
  const join = checkBaseSize ? "LEFT JOIN objects b ON b.oid = o.base_oid" : "";
  const included = checkBaseSize ? "(o.type != 3 OR b.size <= ?)" : "1";
  const baseBindings = checkBaseSize ? [selection.blobMaxSize!] : [];
  function* rows(): Generator<SelectedRow> {
    let after = 0;
    for (;;) {
      const batch = store.sql
        .exec<SelectedRow>(
          `SELECT ${ROW_COLUMNS}, ${included} AS base_included
         FROM objects o ${join}
         WHERE ${condition.query} AND o.rowid > ? ORDER BY o.rowid LIMIT 64`,
          ...baseBindings,
          ...condition.bindings,
          after
        )
        .toArray();
      if (!batch.length) {
        return;
      }
      for (const row of batch) {
        after = row.rowid;
        yield row;
      }
    }
  }
  return { count, rows: rows() };
}
