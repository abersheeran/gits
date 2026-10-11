import { randomBytes } from "node:crypto";
import { deflate } from "pako";
import { describe, expect, it, vi } from "vitest";
import { StreamingInflate } from "./inflate";
import { objectHash } from "./object-format";
import {
  GitObjectNotFoundError,
  GitObjectTooLargeError,
  MAX_RESOLVE_BYTES,
  ObjectStore
} from "./object-store";
import { PayloadWriter } from "./payload-store";
import { testStore } from "./test-helpers";

const text = new TextEncoder();

describe("ObjectStore", () => {
  it("writes idempotently, reads headers and typed objects, batches presence checks", () => {
    const { storage, store } = testStore();
    const content = text.encode("example");
    const oid = store.writeFullObject("blob", content);
    expect(store.writeFullObject("blob", content)).toBe(oid);
    expect(store.maxRowid()).toBe(1);
    expect(store.readHeader(oid)).toEqual({ type: "blob", size: 7 });
    expect(store.readBlob(oid)).toEqual({ oid, blob: content });
    expect(store.readPrefix(oid, 3)).toEqual({
      type: "blob",
      size: 7,
      content: text.encode("exa"),
      truncated: true
    });
    expect(store.readPrefix(oid, 20).truncated).toBe(false);
    expect(() => store.readTree(oid)).toThrow();
    expect(() => store.read("0".repeat(40))).toThrow(GitObjectNotFoundError);
    expect(store.readHeader("0".repeat(40))).toBe(null);
    const oids = Array.from({ length: 200 }, (_, i) => i.toString(16).padStart(40, "0"));
    expect([...store.hasMany([...oids, oid]).values()].filter(Boolean)).toHaveLength(1);
    const value = store.read(oid);
    expect(store.read(oid).content).toBe(value.content);
    expect(new ObjectStore(storage.sql).read(oid).content).toEqual(content);
    expect(store.read(oid).content).toEqual(content);
  });
  it("chunks large payloads and releases chunks on duplicate insert", () => {
    const { store, storage } = testStore();
    const content = randomBytes(3 * 1024 * 1024 + 300);
    const oid = store.writeFullObject("blob", content);
    const row = store.getRow(oid);
    expect(row.data).toBe(null);
    expect(storage.sql.exec("SELECT COUNT(*) AS n FROM object_chunks").one().n).toBe(4);
    expect(Buffer.from(store.read(oid).content).equals(content)).toBe(true);
    const writer = new PayloadWriter(storage.sql);
    writer.write(deflate(content));
    store.insert(
      { oid, type: 3, size: content.length, payload_size: content.length, depth: 0, baseOid: null },
      writer.finish()
    );
    expect(storage.sql.exec("SELECT COUNT(*) AS n FROM object_chunks").one().n).toBe(4);
  });
  it("previews objects above the resolution limit without materializing them", () => {
    const { store } = testStore();
    const content = new Uint8Array(MAX_RESOLVE_BYTES + 1).fill(65);
    const oid = store.writeFullObject("blob", content);
    expect(() => store.read(oid)).toThrow(GitObjectTooLargeError);
    expect(store.readPrefix(oid, 8)).toEqual({
      type: "blob",
      size: content.length,
      content: new Uint8Array(8).fill(65),
      truncated: true
    });
    expect(store.readPrefix(oid, 0).content).toHaveLength(0);
    expect(oid).toBe(objectHash("blob", content));
  });
});

it("inflate stops at the exact end of one zlib stream, including " + "concatenated streams", () => {
  const compressed = deflate(text.encode("first"));
  const input = Buffer.concat([compressed, deflate(text.encode("second"))]);
  const output: Uint8Array[] = [];
  const decoder = new StreamingInflate((bytes) => {
    output.push(bytes.slice());
  });
  expect(decoder.push(input)).toBe(compressed.length);
  decoder.finish();
  expect(Buffer.concat(output).toString()).toBe("first");
  const partial = new StreamingInflate(() => {
  });
  partial.push(compressed.subarray(0, compressed.length - 1));
  expect(() => partial.finish()).toThrow();
});

it("evicts the least recently used resolved bytes and bypasses large entries", () => {
  const { store } = testStore();
  const oids: string[] = [];
  for (let i = 0; i < 9; i++) {
    const oid = store.writeFullObject("blob", new Uint8Array(3 * 1024 * 1024).fill(i));
    oids.push(oid);
    expect(store.read(oid).content[0]).toBe(i);
  }
  const lookup = vi.spyOn(store, "getRow");
  store.read(oids[8]!);
  expect(lookup).not.toHaveBeenCalled();
  store.read(oids[0]!);
  expect(lookup).toHaveBeenCalled();
  const large = store.writeFullObject("blob", new Uint8Array(4 * 1024 * 1024 + 1));
  store.read(large);
  lookup.mockClear();
  store.read(large);
  expect(lookup).toHaveBeenCalled();
});
