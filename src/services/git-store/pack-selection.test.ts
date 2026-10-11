import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { ingestPack } from "./pack-ingest";
import { selectPackRows } from "./pack-selection";
import { createPackStream } from "./pack-writer";
import { testStore } from "./test-helpers";

it("bounds prefetched inline payloads and still streams larger inline objects", async () => {
  const { store } = testStore();
  const oids: string[] = [];
  for (let index = 0; index < 100; index++) {
    oids.push(store.writeFullObject("blob", randomBytes(index % 2 ? 70000 : 32000)));
  }
  for (const selection of [
    { kind: "all", maxRowid: store.maxRowid() } as const,
    { kind: "oids", oids } as const
  ]) {
    const rows = [...selectPackRows(store, selection).rows];
    expect(rows.every((row) => (row.data?.byteLength ?? 0) <= 65536)).toBe(true);
    const batchSize = selection.kind === "all" ? 64 : 90;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const bytes = rows
        .slice(offset, offset + batchSize)
        .reduce((total, row) => total + (row.data?.byteLength ?? 0), 0);
      expect(bytes).toBeLessThanOrEqual(batchSize * 65536);
    }
    expect(rows.some((row) => row.stored_size > 65536 && row.data === null)).toBe(true);
    const destination = testStore().store;
    await ingestPack(destination, createPackStream(store, selection).stream);
    for (const oid of oids) {
      expect(destination.read(oid).content).toEqual(store.read(oid).content);
    }
  }
}, 20000);
