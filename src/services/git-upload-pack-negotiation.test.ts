import * as git from "isomorphic-git";
import { describe, expect, it, vi } from "vitest";
import { loadRepositoryFromStorage } from "./git-repo-loader";
import { StorageService } from "./storage-service";
import {
  computeCommitSetForPack,
  computeObjectClosureForPack,
  findCommonHaves,
  resolveWants
} from "./git-upload-pack-negotiation";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { MockR2Bucket } from "../test-utils/mock-r2";

async function loadSeededRepo() {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const storage = new StorageService(bucket as unknown as R2Bucket);
  const loaded = await loadRepositoryFromStorage(storage, "alice", "demo");
  return { seeded, loaded };
}

describe("git-upload-pack-negotiation", () => {
  it("finds common ancestors from have lines", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const common = await findCommonHaves({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      wantCommits: [seeded.latestCommit],
      haves: [seeded.initialCommit]
    });
    expect(common).toEqual([seeded.initialCommit]);
  });

  it("computes depth-limited commit set and shallow boundary", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const selection = await computeCommitSetForPack({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
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
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
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
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      wantCommits: [seeded.latestCommit],
      commonOids: [],
      deepenNot: ["refs/heads/feature"]
    });
    expect(selection.commitOids).toEqual([]);
  });

  it("resolves wants and expands commit object closure", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const resolved = await resolveWants({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      wants: [seeded.latestCommit]
    });
    expect(resolved.commitWants).toEqual([seeded.latestCommit]);

    const selection = await computeCommitSetForPack({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      wantCommits: resolved.commitWants,
      commonOids: [seeded.initialCommit]
    });
    expect(selection.commitOids).toEqual([seeded.latestCommit]);

    const objects = await computeObjectClosureForPack({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
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

    const readCommitSpy = vi.spyOn(git, "readCommit").mockImplementation(async () => {
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
    const readTreeSpy = vi.spyOn(git, "readTree").mockImplementation(async ({ oid }) => {
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

    try {
      const objects = await computeObjectClosureForPack({
        fs: {},
        dir: "/repo",
        gitdir: "/repo/.git",
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
    }
  });

  it("applies blob:none object filter", async () => {
    const { seeded, loaded } = await loadSeededRepo();
    const selection = await computeCommitSetForPack({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      wantCommits: [seeded.latestCommit],
      commonOids: []
    });

    const fullObjects = await computeObjectClosureForPack({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      commitOids: selection.commitOids
    });
    const filteredObjects = await computeObjectClosureForPack({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      commitOids: selection.commitOids,
      filter: {
        blobNone: true
      }
    });

    expect(filteredObjects.length).toBeLessThan(fullObjects.length);
    for (const oid of filteredObjects) {
      const object = await git.readObject({
        fs: loaded.fs as never,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        oid
      });
      expect(object.type).not.toBe("blob");
    }
  });
});
