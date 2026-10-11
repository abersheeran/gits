import { describe, expect, it, vi } from "vitest";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { MockR2Bucket } from "../test-utils/mock-r2";
import { importTestRepository } from "../test-utils/sqlite-repository";
import { RefStore } from "./git-store/ref-store";
import { testStore } from "./git-store/test-helpers";
import {
  computeCommitSetForPack,
  computeObjectClosureForPack,
  findCommonHaves,
  resolveWants
} from "./git-upload-pack-negotiation";

async function loadSeededRepo() {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const loaded = await importTestRepository(bucket, "alice", "demo");
  return { seeded, loaded };
}

describe("git-upload-pack-negotiation", () => {
  it("recognizes locally stored commits from have lines", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const common = await findCommonHaves({
      store: loaded.store,
      refs: loaded.refs,
      wantCommits: [seeded.latestCommit],
      haves: [seeded.initialCommit]
    });
    expect(common).toEqual([seeded.initialCommit]);
  });

  it("computes depth-limited commit set and shallow boundary", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const selection = await computeCommitSetForPack({
      store: loaded.store,
      refs: loaded.refs,
      wantCommits: [seeded.latestCommit],
      commonOids: [],
      deepen: 1
    });
    expect(selection.commitOids).toEqual([seeded.latestCommit]);
    expect(selection.shallowOids).toEqual([seeded.latestCommit]);
  });

  it("supports deepen-since by excluding older history", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const selection = await computeCommitSetForPack({
      store: loaded.store,
      refs: loaded.refs,
      wantCommits: [seeded.latestCommit],
      commonOids: [],
      deepenSince: 9_999_999_999
    });
    expect(selection.commitOids).toEqual([]);
    expect(selection.shallowOids).toEqual([]);
  });

  it("supports deepen-not by excluding commits reachable from specified refs", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const selection = await computeCommitSetForPack({
      store: loaded.store,
      refs: loaded.refs,
      wantCommits: [seeded.latestCommit],
      commonOids: [],
      deepenNot: ["refs/heads/feature"]
    });
    expect(selection.commitOids).toEqual([]);
  });

  it("resolves wants and expands commit object closure", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const resolved = await resolveWants({
      store: loaded.store,
      refs: loaded.refs,
      wants: [seeded.latestCommit]
    });
    expect(resolved.commitWants).toEqual([seeded.latestCommit]);

    const selection = await computeCommitSetForPack({
      store: loaded.store,
      refs: loaded.refs,
      wantCommits: resolved.commitWants,
      commonOids: [seeded.initialCommit]
    });
    expect(selection.commitOids).toEqual([seeded.latestCommit]);

    const objects = await computeObjectClosureForPack({
      store: loaded.store,
      refs: loaded.refs,
      commitOids: selection.commitOids,
      extraOids: resolved.extraObjectWants
    });
    expect(objects).toContain(seeded.latestCommit);
    expect(objects.length).toBeGreaterThan(1);
  });

  it("does not include gitlink commit oids from tree entries", async () => {
    const commitOid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const rootTreeOid = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const nestedTreeOid = "cccccccccccccccccccccccccccccccccccccccc";
    const blobOid = "dddddddddddddddddddddddddddddddddddddddd";
    const gitlinkOid = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    const { store, storage } = testStore();
    const readCommitSpy = vi.spyOn(store, "readCommit").mockImplementation(() => {
      return {
        oid: commitOid,
        commit: {
          message: "fixture",
          tree: rootTreeOid,
          parent: [],
          author: {
            name: "alice",
            email: "alice@example.com",
            timestamp: 1,
            timezoneOffset: 0
          },
          committer: {
            name: "alice",
            email: "alice@example.com",
            timestamp: 1,
            timezoneOffset: 0
          }
        },
        payload: ""
      };
    });
    const readTreeSpy = vi.spyOn(store, "readTree").mockImplementation((oid) => {
      if (oid === rootTreeOid) {
        return {
          oid: rootTreeOid,
          tree: [
            { mode: "040000", path: "sub", oid: nestedTreeOid, type: "tree" as const },
            { mode: "160000", path: "vendor", oid: gitlinkOid, type: "commit" as const }
          ]
        };
      }
      if (oid === nestedTreeOid) {
        return {
          oid: nestedTreeOid,
          tree: [{ mode: "100644", path: "file.txt", oid: blobOid, type: "blob" as const }]
        };
      }
      throw new Error(`unexpected oid: ${oid}`);
    });

    const headerSpy = vi.spyOn(store, "readHeader").mockReturnValue({ type: "blob", size: 1 });
    try {
      const objects = await computeObjectClosureForPack({
        store,
        refs: new RefStore(storage),
        commitOids: [commitOid]
      });

      expect(objects).toContain(commitOid);
      expect(objects).toContain(rootTreeOid);
      expect(objects).toContain(nestedTreeOid);
      expect(objects).toContain(blobOid);
      expect(objects).not.toContain(gitlinkOid);
    } finally {
      readCommitSpy.mockRestore();
      readTreeSpy.mockRestore();
      headerSpy.mockRestore();
    }
  });

  it("applies blob:none object filter", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const selection = await computeCommitSetForPack({
      store: loaded.store,
      refs: loaded.refs,
      wantCommits: [seeded.latestCommit],
      commonOids: []
    });

    const fullObjects = await computeObjectClosureForPack({
      store: loaded.store,
      refs: loaded.refs,
      commitOids: selection.commitOids
    });
    const filteredObjects = await computeObjectClosureForPack({
      store: loaded.store,
      refs: loaded.refs,
      commitOids: selection.commitOids,
      filter: {
        blobNone: true
      }
    });

    expect(filteredObjects.length).toBeLessThan(fullObjects.length);
    for (const oid of filteredObjects) {
      const object = loaded.store.readHeader(oid)!;
      expect(object.type).not.toBe("blob");
    }
  });
});

it("includes the terminal object of an annotated tag that does not point to a commit", async () => {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const blob = store.writeFullObject("blob", new TextEncoder().encode("tagged content"));
  const tag = store.writeFullObject(
    "tag",
    new TextEncoder().encode(`object ${blob}\ntype blob\ntag data\ntagger A <a@a> 1 +0000\n\ntag\n`)
  );
  const wants = await resolveWants({ store, refs, wants: [tag] });
  expect(wants.commitWants).toEqual([]);
  expect(wants.extraObjectWants).toEqual([tag, blob]);
});

it("accepts locally stored have commits even when unrelated to the want", async () => {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const encoder = new TextEncoder();
  const tree = store.writeFullObject("tree", new Uint8Array());
  const commit = (message: string) =>
    store.writeFullObject(
      "commit",
      encoder.encode(
        `tree ${tree}\nauthor A <a@a> 1 +0000\ncommitter A <a@a> 1 +0000\n\n${message}\n`
      )
    );
  const want = commit("wanted history");
  const unrelated = commit("unrelated history");
  const blob = store.writeFullObject("blob", encoder.encode("not a commit"));
  const tag = store.writeFullObject(
    "tag",
    encoder.encode(`object ${unrelated}\ntype commit\ntag tag\n\nmessage\n`)
  );
  const haves = [unrelated, blob, tag, "f".repeat(40), unrelated.toUpperCase(), want];
  expect(await findCommonHaves({ store, refs, wantCommits: [want], haves })).toEqual([
    unrelated,
    want
  ]);
  expect(await findCommonHaves({ store, refs, wantCommits: [], haves: [unrelated] })).toEqual([
    unrelated
  ]);
  expect(
    await findCommonHaves({ store, refs, wantCommits: [want], haves, maxHaveLines: 1 })
  ).toEqual([unrelated]);
});
