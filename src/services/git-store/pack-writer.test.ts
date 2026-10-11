import { afterEach, expect, it, vi } from "vitest";
import { GitObjectNotFoundError, objectHash } from "./object-format";
import { oidToBytes } from "./oid";
import { ingestPack } from "./pack-ingest";
import { createPackStream } from "./pack-writer";
import { allGitObjects, chunks, gitRepo, insertDelta, makePack, testStore } from "./test-helpers";

const repos: ReturnType<typeof gitRepo>[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.close();
  }
});

async function bytes(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const text = new TextEncoder();

it("streams all objects into a new git repository accepted by index-pack and fsck", async () => {
  const source = gitRepo();
  repos.push(source);
  const content = Array.from({ length: 2000 }, (_, i) => `${i} line\n`).join("");
  for (let i = 0; i < 5; i++) {
    source.write("file", content + i);
    source.git(["add", "."]);
    source.git(["commit", "-m", String(i)]);
  }
  const { store } = testStore();
  await ingestPack(store, chunks(source.git(["pack-objects", "--stdout", "--all"])));
  const { count, stream } = createPackStream(store, { kind: "all", maxRowid: store.maxRowid() });
  expect(count).toBe(allGitObjects(source).length);
  const dest = gitRepo();
  repos.push(dest);
  dest.git(["index-pack", "--stdin"], await bytes(stream));
  const tip = source.git(["rev-parse", "HEAD"]).toString().trim();
  dest.git(["update-ref", "refs/heads/main", tip]);
  expect(() => dest.git(["fsck", "--full"])).not.toThrow();
  expect(allGitObjects(dest)).toEqual(allGitObjects(source));
});

it("uses the same blob filter boundary, stable rowid snapshot, and pull backpressure", async () => {
  const { store } = testStore();
  const small = store.writeFullObject("blob", text.encode("123"));
  store.writeFullObject("blob", text.encode("1234"));
  const tree = store.writeFullObject("tree", new Uint8Array());
  const maxRowid = store.maxRowid();
  const spy = vi.spyOn(store, "readPayload");
  const selected = createPackStream(store, { kind: "all", maxRowid, blobMaxSize: 3 });
  await Promise.resolve();
  expect(spy).not.toHaveBeenCalled();
  store.writeFullObject("blob", text.encode("x"));
  const target = testStore().store;
  await ingestPack(target, chunks(await bytes(selected.stream)));
  expect(selected.count).toBe(2);
  expect(target.has(small)).toBe(true);
  expect(target.has(tree)).toBe(true);
  const noBlobs = createPackStream(store, { kind: "all", maxRowid, excludeBlobs: true });
  expect(noBlobs.count).toBe(1);
  const other = testStore().store;
  await ingestPack(other, chunks(await bytes(noBlobs.stream)));
  expect(other.has(tree)).toBe(true);
});

it("deduplicates selected OIDs and expands deltas whose bases are excluded", async () => {
  const base = text.encode("original");
  const target = text.encode("modified");
  const oid = objectHash("blob", target);
  const { store } = testStore();
  await ingestPack(
    store,
    chunks(
      makePack([
        { type: 3, content: base },
        {
          type: 7,
          base: oidToBytes(objectHash("blob", base)),
          content: insertDelta(base.length, target)
        }
      ])
    )
  );
  expect(store.getRow(oid).depth).toBe(1);
  const selected = createPackStream(store, { kind: "oids", oids: [oid, oid] });
  expect(selected.count).toBe(1);
  const pack = await bytes(selected.stream);
  expect((pack[12]! >> 4) & 7).toBe(3);
  const repo = gitRepo();
  repos.push(repo);
  repo.git(["index-pack", "--stdin"], pack);
  expect(allGitObjects(repo)).toEqual([{ oid, type: "blob", content: target }]);
});

it("supports empty packs and cancels without reading payloads", async () => {
  const { store } = testStore();
  const empty = createPackStream(store, { kind: "all", maxRowid: 0 });
  expect(empty.count).toBe(0);
  await expect(ingestPack(testStore().store, chunks(await bytes(empty.stream)))).resolves.toEqual({
    objectCount: 0,
    startRowid: 0
  });
  const oid = store.writeFullObject("blob", text.encode("cancel"));
  const spy = vi.spyOn(store, "readPayload");
  await createPackStream(store, { kind: "oids", oids: [oid] }).stream.cancel();
  expect(spy).not.toHaveBeenCalled();
});

it("coalesces small entries into bounded output chunks", async () => {
  const { store, storage } = testStore();
  for (let i = 0; i < 2000; i++) {
    store.writeFullObject("blob", text.encode(`small file ${i}: content repeated for a test`));
  }
  const maxRowid = store.maxRowid();
  const { stream } = createPackStream(store, { kind: "all", maxRowid });
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
  }
  expect(chunks.length).toBeLessThan(10);
  expect(chunks.slice(0, -1).every((chunk) => chunk.length >= 64 * 1024)).toBe(true);
});

it("expands a small delta when the blob size filter excludes its larger base", async () => {
  const { store } = testStore();
  const base = text.encode("a larger original");
  const target = text.encode("tiny");
  const oid = objectHash("blob", target);
  await ingestPack(
    store,
    chunks(
      makePack([
        { type: 3, content: base },
        {
          type: 7,
          base: oidToBytes(objectHash("blob", base)),
          content: insertDelta(base.length, target)
        }
      ])
    )
  );
  const output = createPackStream(store, {
    kind: "all",
    maxRowid: store.maxRowid(),
    blobMaxSize: target.length
  });
  expect(output.count).toBe(1);
  const decoded = testStore().store;
  await ingestPack(decoded, chunks(await bytes(output.stream)));
  expect(decoded.getRow(oid).base_oid).toBe(null);
  expect(decoded.read(oid).content).toEqual(target);
});

it("reports missing selected OIDs explicitly", () => {
  const { store } = testStore();
  expect(() =>
    createPackStream(store, {
      kind: "oids",
      oids: ["f".repeat(40)]
    })
  ).toThrow(GitObjectNotFoundError);
});
