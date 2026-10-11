import { randomBytes } from "node:crypto";
import { deflate, inflate } from "pako";
import { afterEach, expect, it, vi } from "vitest";
import { seedSampleRepositoryToR2 } from "../../test-utils/git-fixture";
import { MockR2Bucket } from "../../test-utils/mock-r2";
import { StorageService } from "../storage-service";
import { importLegacyRepository } from "./legacy-import";
import { MAX_RESOLVE_BYTES, objectHash, objectHeader } from "./object-format";
import { oidToBytes } from "./oid";
import { RefStore } from "./ref-store";
import { allGitObjects, gitRepo, insertDelta, makePack, testStore } from "./test-helpers";

const repos: ReturnType<typeof gitRepo>[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const repo of repos.splice(0)) {
    repo.close();
  }
});

function fixture() {
  const bucket = new MockR2Bucket();
  const source = new StorageService(bucket as unknown as R2Bucket);
  return { ...testStore(), bucket, source };
}

it("imports the existing sample fixture without changing R2 or KV", async () => {
  const { storage, store, bucket, source } = fixture();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
  await storage.put("repository-snapshot/test", "snapshot");
  const before = (await bucket.list({ prefix: "alice/demo/" })).objects.map((item) => item.key);
  const result = await importLegacyRepository({
    storage,
    store,
    source,
    owner: "alice",
    repo: "demo"
  });
  const refs = new RefStore(storage);
  expect(refs.listRefs()).toEqual([
    { name: "refs/heads/feature", oid: seeded.latestCommit },
    { name: "refs/heads/main", oid: seeded.latestCommit }
  ]);
  expect(refs.getHead()).toBe(await source.readHead("alice", "demo"));
  expect(store.has(seeded.latestCommit)).toBe(true);
  expect(store.has(seeded.initialCommit)).toBe(true);
  let count = 0;
  for (const key of before.filter((key) => /objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(key))) {
    const object = inflate(new Uint8Array(await (await bucket.get(key))!.arrayBuffer()));
    const end = object.indexOf(0);
    const [type] = new TextDecoder().decode(object.subarray(0, end)).split(" ");
    const oid = key.split("/").slice(-2).join("");
    expect(store.read(oid)).toEqual({ type, content: object.subarray(end + 1) });
    count++;
  }
  expect(result).toEqual({ objectCount: count, refCount: 2, skippedRefs: [] });
  expect(storage.sql.exec("SELECT value FROM meta WHERE key = 'initialized'").one().value).toBe(
    "1"
  );
  expect((await bucket.list({ prefix: "alice/demo/" })).objects.map((item) => item.key)).toEqual(
    before
  );
  expect(await storage.get("repository-snapshot/test")).toBe("snapshot");
});

it("retries multiple thin packs in upload order until all bases become available", async () => {
  const repo = gitRepo();
  repos.push(repo);
  const content = randomBytes(100 * 1024);
  const commits: string[] = [];
  const packs: Uint8Array[] = [];
  for (let i = 0; i < 3; i++) {
    content.writeUInt32BE(i + 10, i * 30);
    repo.write("file.bin", content);
    repo.git(["add", "."]);
    repo.git(["commit", "-m", `v${i}`]);
    const oid = repo.git(["rev-parse", "HEAD"]).toString().trim();
    const previous = commits.at(-1);
    packs.push(
      repo.git(
        ["pack-objects", "--stdout", "--thin", "--revs"],
        `${oid}\n${previous ? `^${previous}\n` : ""}`
      )
    );
    commits.push(oid);
  }
  const { storage, store, bucket, source } = fixture();
  vi.useFakeTimers({ toFake: ["Date"] });
  for (const [index, pack] of [...packs].reverse().entries()) {
    vi.setSystemTime(1000 + index * 1000);
    await bucket.put(`alice/demo/objects/pack/${index}.pack`, pack);
  }
  await bucket.put("alice/demo/objects/pack/ignored.idx", "ignored");
  await bucket.put(
    "alice/demo/packed-refs",
    "# pack-refs with: peeled\n" +
      commits[0] +
      " refs/heads/main\n" +
      commits[0] +
      " refs/tags/v1\n^" +
      commits[0] +
      "\n"
  );
  await bucket.put("alice/demo/refs/heads/main", commits[2]! + "\n");
  const getStream = vi.spyOn(source, "getStream");
  await importLegacyRepository({ storage, store, source, owner: "alice", repo: "demo" });
  expect(getStream.mock.calls.filter(([key]) => key.endsWith(".pack")).length).toBeGreaterThan(3);
  for (const object of allGitObjects(repo)) {
    expect(store.read(object.oid)).toEqual({ type: object.type, content: object.content });
  }
  expect(store.sql.exec("SELECT COUNT(*) AS n FROM objects").one().n).toBe(
    allGitObjects(repo).length
  );
  const refs = new RefStore(storage);
  expect(refs.getRef("refs/heads/main")).toBe(commits[2]);
  expect(refs.getRef("refs/tags/v1")).toBe(commits[0]);
  expect(refs.getHead()).toBe("ref: refs/heads/main");
});

it(
  "imports HEAD-only empty repositories and selects a fallback " + "branch when HEAD is absent",
  async () => {
    const first = fixture();
    await first.bucket.put("a/b/HEAD", "ref: refs/heads/trunk\n");
    expect(await importLegacyRepository({ ...first, owner: "a", repo: "b" })).toEqual({
      objectCount: 0,
      refCount: 0,
      skippedRefs: []
    });
    expect(new RefStore(first.storage).getHead()).toBe("ref: refs/heads/trunk");
    const second = fixture();
    const oid = second.store.writeFullObject("blob", new Uint8Array());
    await second.bucket.put("a/b/refs/heads/trunk", oid);
    await importLegacyRepository({ ...second, owner: "a", repo: "b" });
    expect(new RefStore(second.storage).getHead()).toBe("ref: refs/heads/trunk");
  }
);

it(
  "fails without initializing or publishing refs when old data is " + "corrupt or incomplete",
  async () => {
    const args = fixture();
    const missing = "a".repeat(40);
    await args.bucket.put("a/b/refs/heads/main", missing);
    await expect(importLegacyRepository({ ...args, owner: "a", repo: "b" })).rejects.toThrow(
      /missing object/
    );
    expect(new RefStore(args.storage).listRefs()).toEqual([]);
    expect(args.storage.sql.exec("SELECT * FROM meta WHERE key = 'initialized'").toArray()).toEqual(
      []
    );
    await args.bucket.delete("a/b/refs/heads/main");
    await args.bucket.put(
      `a/b/objects/aa/${"a".repeat(38)}`,
      deflate(new TextEncoder().encode("blob 3\0abc"))
    );
    await expect(importLegacyRepository({ ...args, owner: "a", repo: "b" })).rejects.toThrow(/OID/);
    expect((await args.bucket.list({ prefix: "a/b/" })).objects).toHaveLength(1);
  }
);

it("streams and verifies oversized full loose objects without full resolution", async () => {
  const args = fixture();
  const content = new Uint8Array(MAX_RESOLVE_BYTES + 1).fill(120);
  const oid = objectHash("blob", content);
  await args.bucket.put(
    `a/b/objects/${oid.slice(0, 2)}/${oid.slice(2)}`,
    deflate(Buffer.concat([objectHeader("blob", content.length), content]))
  );
  await args.bucket.put("a/b/refs/tags/data", oid);
  await importLegacyRepository({ ...args, owner: "a", repo: "b" });
  expect(args.store.readPrefix(oid, 5).content).toEqual(new Uint8Array(5).fill(120));
}, 20000);

it(
  "fails unresolved legacy thin packs without initializing and " +
    "detects corrupted stored payloads",
  async () => {
    const args = fixture();
    const missing = "b".repeat(40);
    const pack = makePack([
      { type: 7, base: oidToBytes(missing), content: insertDelta(1, new Uint8Array([2])) }
    ]);
    await args.bucket.put("a/b/objects/pack/thin.pack", pack);
    await expect(importLegacyRepository({ ...args, owner: "a", repo: "b" })).rejects.toMatchObject({
      oid: missing
    });
    expect(args.storage.sql.exec("SELECT * FROM meta WHERE key = 'initialized'").toArray()).toEqual(
      []
    );
    await args.bucket.delete("a/b/objects/pack/thin.pack");
    const oid = args.store.writeFullObject("blob", new Uint8Array([1]));
    const changed = deflate(new Uint8Array([2]));
    args.storage.sql.exec(
      "UPDATE objects SET data = ?, stored_size = ? WHERE oid = ?",
      changed,
      changed.length,
      oidToBytes(oid)
    );
    await expect(importLegacyRepository({ ...args, owner: "a", repo: "b" })).rejects.toThrow(
      /OID mismatch/
    );
  }
);

it("skips unserviceable loose and packed refs and still initializes the repository", async () => {
  const args = fixture();
  const seeded = await seedSampleRepositoryToR2(args.bucket, "alice", "demo");
  const refs: Record<string, string> = {
    "refs/remotes/origin/main": seeded.latestCommit,
    "refs/notes/commits": seeded.latestCommit,
    "refs/heads/bad..name": seeded.latestCommit,
    "refs/heads/alias": "ref: refs/heads/main",
    "refs/tags/alias": "ref: refs/heads/main",
    "refs/heads/broken": "not-an-oid"
  };
  for (const [name, value] of Object.entries(refs)) {
    await args.bucket.put(`alice/demo/${name}`, value);
  }
  await args.bucket.put(
    "alice/demo/packed-refs",
    [
      `${seeded.latestCommit} refs/tags/good`,
      `${seeded.latestCommit} refs/remotes/packed/main`,
      `${seeded.latestCommit} refs/tags/.bad`,
      `${seeded.initialCommit} refs/heads/alias`,
      ""
    ].join("\n")
  );
  const result = await importLegacyRepository({ ...args, owner: "alice", repo: "demo" });
  expect(result.skippedRefs.map((ref) => ref.name).sort()).toEqual(
    [...Object.keys(refs), "refs/remotes/packed/main", "refs/tags/.bad"].sort()
  );
  expect(result.skippedRefs.find((ref) => ref.name === "refs/heads/alias")?.reason).toBe(
    "symbolic ref"
  );
  expect(new RefStore(args.storage).listRefs().map((ref) => ref.name)).toEqual([
    "refs/heads/feature",
    "refs/heads/main",
    "refs/tags/good"
  ]);
  expect(
    args.storage.sql.exec("SELECT value FROM meta WHERE key = 'initialized'").one().value
  ).toBe("1");
});

it("falls back from an unsupported HEAD target and retains atomic publication", async () => {
  const args = fixture();
  await seedSampleRepositoryToR2(args.bucket, "alice", "demo");
  await args.bucket.put("alice/demo/HEAD", "ref: refs/remotes/origin/main");
  const transaction = vi.spyOn(args.storage, "transactionSync");
  const result = await importLegacyRepository({ ...args, owner: "alice", repo: "demo" });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(result.skippedRefs).toContainEqual({
    name: "HEAD",
    value: "ref: refs/remotes/origin/main",
    reason: "symbolic ref"
  });
  expect(new RefStore(args.storage).getHead()).toBe("ref: refs/heads/main");
});
