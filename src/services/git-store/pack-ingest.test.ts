import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StreamingInflate } from "./inflate";
import {
  GitMissingObjectError,
  GitObjectTooLargeError,
  GitPackTooLargeError,
  MAX_RESOLVE_BYTES,
  objectHash
} from "./object-format";
import { oidToBytes } from "./oid";
import { ingestPack } from "./pack-ingest";
import {
  allGitObjects,
  chunks,
  gitRepo,
  insertDelta,
  makePack,
  sizeVarint,
  testStore
} from "./test-helpers";

const text = new TextEncoder();
const repos: ReturnType<typeof gitRepo>[] = [];

function repoFixture(versions = 8) {
  const repo = gitRepo();
  repos.push(repo);
  const content = randomBytes(80 * 1024);
  for (let i = 0; i < versions; i++) {
    content.writeUInt32BE(i, i * 100);
    repo.write("file.bin", content);
    repo.git(["add", "."]);
    repo.git(["commit", "-m", `version ${i}`]);
  }
  return repo;
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.close();
  }
});

export function packTypes(pack: Uint8Array): number[] {
  const count = new DataView(pack.buffer, pack.byteOffset, pack.byteLength).getUint32(8);
  const types: number[] = [];
  let offset = 12;
  for (let i = 0; i < count; i++) {
    let byte = pack[offset++]!;
    const type = (byte >> 4) & 7;
    types.push(type);
    while (byte & 128) {
      byte = pack[offset++]!;
    }
    if (type === 7) {
      offset += 20;
    }
    if (type === 6) {
      do {
        byte = pack[offset++]!;
      } while (byte & 128);
    }
    const decoder = new StreamingInflate(() => {
    });
    offset += decoder.push(pack.subarray(offset));
    decoder.finish();
  }
  return types;
}

function compareAll(
  store: ReturnType<typeof testStore>["store"],
  repo: ReturnType<typeof gitRepo>
) {
  const objects = allGitObjects(repo);
  expect(store.sql.exec("SELECT COUNT(*) AS n FROM objects").one().n).toBe(objects.length);
  for (const object of objects) {
    expect(store.read(object.oid)).toEqual({ type: object.type, content: object.content });
  }
}

describe("streaming pack ingest", () => {
  it("imports a real repack with OFS_DELTA and preserves every object", async () => {
    const repo = repoFixture();
    repo.git(["repack", "-adf"]);
    const path = readdirSync(join(repo.dir, ".git/objects/pack")).find((name) =>
      name.endsWith(".pack")
    )!;
    const pack = readFileSync(join(repo.dir, ".git/objects/pack", path));
    expect(packTypes(pack)).toContain(6);
    const { store } = testStore();
    const progress: number[] = [];
    const result = await ingestPack(store, chunks(pack, 37), {
      onProgress: (value) => progress.push(value)
    });
    expect(result.startRowid).toBe(0);
    expect(progress.at(-1)).toBe(result.objectCount);
    compareAll(store, repo);
    const second = await ingestPack(store, chunks(pack));
    expect(second.startRowid).toBe(result.objectCount);
    compareAll(store, repo);
  });
  it("imports REF_DELTA and a thin pack against existing objects", async () => {
    const repo = repoFixture();
    const pack = repo.git(["pack-objects", "--stdout", "--all"]);
    expect(packTypes(pack)).toContain(7);
    const first = testStore().store;
    await ingestPack(first, chunks(pack));
    compareAll(first, repo);
    const base = repo.git(["rev-parse", "HEAD~1"]).toString().trim();
    const thin = repo.git(["pack-objects", "--stdout", "--thin", "--revs"], `HEAD\n^${base}\n`);
    expect(packTypes(thin)).toContain(7);
    const { store } = testStore();
    await ingestPack(store, chunks(repo.git(["pack-objects", "--stdout", "--revs"], base + "\n")));
    await ingestPack(store, chunks(thin));
    compareAll(store, repo);
    await expect(ingestPack(testStore().store, chunks(thin))).rejects.toBeInstanceOf(
      GitMissingObjectError
    );
  });
  it("streams a random binary payload larger than 3 MB into SQL chunks", async () => {
    const repo = repoFixture(1);
    repo.write("large.bin", randomBytes(3 * 1024 * 1024 + 512));
    repo.git(["add", "."]);
    repo.git(["commit", "-m", "large"]);
    const pack = repo.git(["pack-objects", "--stdout", "--all"]);
    const { store } = testStore();
    await ingestPack(store, chunks(pack));
    expect(
      store.sql.exec("SELECT COUNT(*) AS n FROM object_chunks").one().n
    ).toBeGreaterThanOrEqual(4);
    compareAll(store, repo);
  }, 20000);
  it("resolves forward REF_DELTA dependencies and bounds delta depth at 50", async () => {
    const contents = Array.from({ length: 62 }, (_, i) =>
      new TextEncoder().encode(`version ${String(i).padStart(3, "0")}`)
    );
    const entries = contents.map((content, i) =>
      i === 0
        ? { type: 3, content }
        : {
            type: 7,
            content: insertDelta(contents[i - 1]!.length, content),
            base: oidToBytes(objectHash("blob", contents[i - 1]!))
          }
    );
    const { store } = testStore();
    await ingestPack(store, chunks(makePack(entries), 1));
    for (const content of contents) {
      expect(store.read(objectHash("blob", content)).content).toEqual(content);
    }
    expect(store.sql.exec("SELECT MAX(depth) AS depth FROM objects").one().depth).toBe(50);
    expect(store.getRow(objectHash("blob", contents[51]!)).depth).toBe(0);
    const forward = testStore().store;
    await ingestPack(forward, chunks(makePack([entries[2]!, entries[1]!, entries[0]!], 3)));
    expect(forward.read(objectHash("blob", contents[2]!)).content).toEqual(contents[2]);
  });
  it("keeps Git-generated long file history readable", async () => {
    const repo = repoFixture(65);
    const pack = repo.git(["pack-objects", "--stdout", "--all", "--depth=100", "--window=100"]);
    expect(packTypes(pack)).toContain(7);
    const { store } = testStore();
    await ingestPack(store, chunks(pack));
    expect(store.sql.exec("SELECT MAX(depth) AS n FROM objects").one().n).toBeLessThanOrEqual(50);
    compareAll(store, repo);
  }, 20000);
  it(
    "rejects checksums, count mismatches, trailing bytes, oversize " + "packs and missing bases",
    async () => {
      const valid = makePack([{ type: 3, content: new Uint8Array([1, 2, 3]) }]);
      const badChecksum = Buffer.from(valid);
      badChecksum[badChecksum.length - 1]! ^= 1;
      await expect(ingestPack(testStore().store, chunks(badChecksum))).rejects.toThrow(/checksum/);
      for (const count of [0, 2, 2000001]) {
        const badCount = Buffer.from(valid);
        badCount.writeUInt32BE(count, 8);
        createHash("sha1")
          .update(badCount.subarray(0, -20))
          .digest()
          .copy(badCount, badCount.length - 20);
        await expect(ingestPack(testStore().store, chunks(badCount))).rejects.toThrow();
      }
      await expect(
        ingestPack(testStore().store, chunks(Buffer.concat([valid, Buffer.from([0])])))
      ).rejects.toThrow(/Extra/);
      await expect(
        ingestPack(testStore().store, chunks(valid), { maxBytes: valid.length - 1 })
      ).rejects.toThrow(/maxBytes/);
      await expect(ingestPack(testStore().store, chunks(valid.subarray(0, -1)))).rejects.toThrow(
        /Truncated/
      );
      const missing = "a".repeat(40);
      const delta = makePack([
        { type: 7, base: oidToBytes(missing), content: insertDelta(1, new Uint8Array([2])) }
      ]);
      await expect(ingestPack(testStore().store, chunks(delta))).rejects.toMatchObject({
        oid: missing
      });
    }
  );
  it("rejects oversized delta targets before allocation and clears abandoned chunks", async () => {
    const { store } = testStore();
    const base = store.writeFullObject("blob", new Uint8Array([1]));
    store.sql.exec("INSERT INTO object_chunks VALUES (900, 0, ?)", new Uint8Array([1]));
    const pack = makePack([
      {
        type: 7,
        base: oidToBytes(base),
        content: Uint8Array.from([1, ...sizeVarint(MAX_RESOLVE_BYTES + 1)])
      }
    ]);
    await expect(ingestPack(store, chunks(pack))).rejects.toThrow(GitObjectTooLargeError);
    expect(store.sql.exec("SELECT * FROM object_chunks WHERE chunk_id = 900").toArray()).toEqual(
      []
    );
  });
});

it("exports a distinct size-limit error with the configured limit", async () => {
  const pack = makePack([{ type: 3, content: text.encode("data") }]);
  await expect(
    ingestPack(testStore().store, chunks(pack), { maxBytes: pack.length - 1 })
  ).rejects.toBeInstanceOf(GitPackTooLargeError);
  await expect(
    ingestPack(testStore().store, chunks(pack), { maxBytes: pack.length - 1 })
  ).rejects.toMatchObject({ maxBytes: pack.length - 1 });
});

it("spools a forward delta's decoded instructions in bounded SQL chunks", async () => {
  const { store, storage } = testStore();
  const base = text.encode("base");
  const target = randomBytes(1024 * 1024 + 123);
  const oid = objectHash("blob", target);
  await ingestPack(
    store,
    chunks(
      makePack([
        {
          type: 7,
          base: oidToBytes(objectHash("blob", base)),
          content: insertDelta(base.length, target)
        },
        { type: 3, content: base }
      ])
    )
  );
  expect(objectHash("blob", store.read(oid).content)).toBe(oid);
  expect(
    storage.sql
      .exec(
        `SELECT COUNT(*) AS n FROM object_chunks
     WHERE chunk_id NOT IN (SELECT chunk_id FROM objects WHERE chunk_id IS NOT NULL)`
      )
      .one().n
  ).toBe(0);
});
