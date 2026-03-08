import * as git from "isomorphic-git";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import type { PullRequestRecord } from "../types";
import { createMockDurableObjectState } from "../test-utils/mock-durable-object-state";
import { MockR2Bucket } from "../test-utils/mock-r2";
import { loadRepositoryFromStorage } from "./git-repo-loader";
import { PullRequestMergeConflictError, PullRequestMergeService } from "./pull-request-merge-service";
import { StorageService } from "./storage-service";

type FsLike = {
  promises: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    readFile(path: string): Promise<Uint8Array>;
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<{ isDirectory(): boolean }>;
  };
};

function relativePath(base: string, fullPath: string): string {
  return fullPath.startsWith(`${base}/`) ? fullPath.slice(base.length + 1) : fullPath;
}

async function listFilesRecursive(fs: FsLike, root: string): Promise<string[]> {
  const entries = await fs.promises.readdir(root);
  const files: string[] = [];
  for (const name of entries) {
    const fullPath = `${root}/${name}`;
    const stats = await fs.promises.stat(fullPath);
    if (stats.isDirectory()) {
      files.push(...(await listFilesRecursive(fs, fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function persistGitState(fs: FsLike, gitdir: string, bucket: MockR2Bucket): Promise<void> {
  const objectFiles = await listFilesRecursive(fs, `${gitdir}/objects`);
  const refFiles = await listFilesRecursive(fs, `${gitdir}/refs/heads`);
  for (const path of [...objectFiles, ...refFiles, `${gitdir}/HEAD`]) {
    const body = await fs.promises.readFile(path);
    const relative = relativePath(gitdir, path);
    await bucket.put(`alice/demo/${relative}`, body);
  }
}

async function createMergeFixture(kind: "clean" | "conflict"): Promise<{
  bucket: MockR2Bucket;
  storage: StorageService;
  pullRequest: PullRequestRecord;
  mainTip: string;
  featureTip: string;
}> {
  const bucket = new MockR2Bucket();
  const volume = new Volume();
  const fs = createFsFromVolume(volume) as unknown as FsLike;
  const dir = "/repo";
  const gitdir = "/repo/.git";
  const author = {
    name: "alice",
    email: "alice@example.com"
  };

  await fs.promises.mkdir(dir, { recursive: true });
  await git.init({
    fs: fs as never,
    dir,
    defaultBranch: "main"
  });

  await fs.promises.writeFile(`${dir}/README.md`, "# Demo\n");
  await git.add({
    fs: fs as never,
    dir,
    filepath: "README.md"
  });
  const initialCommit = await git.commit({
    fs: fs as never,
    dir,
    message: "initial commit",
    author
  });

  await git.branch({
    fs: fs as never,
    dir,
    ref: "feature"
  });

  let mainTip = initialCommit;
  let featureTip = initialCommit;

  if (kind === "clean") {
    await fs.promises.writeFile(`${dir}/main.txt`, "main change\n");
    await git.add({
      fs: fs as never,
      dir,
      filepath: "main.txt"
    });
    mainTip = await git.commit({
      fs: fs as never,
      dir,
      message: "main change",
      author
    });

    await git.checkout({
      fs: fs as never,
      dir,
      ref: "feature"
    });
    await fs.promises.writeFile(`${dir}/feature.txt`, "feature change\n");
    await git.add({
      fs: fs as never,
      dir,
      filepath: "feature.txt"
    });
    featureTip = await git.commit({
      fs: fs as never,
      dir,
      message: "feature change",
      author
    });
  } else {
    await fs.promises.writeFile(`${dir}/README.md`, "# Demo\nmain update\n");
    await git.add({
      fs: fs as never,
      dir,
      filepath: "README.md"
    });
    mainTip = await git.commit({
      fs: fs as never,
      dir,
      message: "main update",
      author
    });

    await git.checkout({
      fs: fs as never,
      dir,
      ref: "feature"
    });
    await fs.promises.writeFile(`${dir}/README.md`, "# Demo\nfeature update\n");
    await git.add({
      fs: fs as never,
      dir,
      filepath: "README.md"
    });
    featureTip = await git.commit({
      fs: fs as never,
      dir,
      message: "feature update",
      author
    });
  }

  await persistGitState(fs, gitdir, bucket);
  const storage = new StorageService(bucket as unknown as R2Bucket);

  return {
    bucket,
    storage,
    pullRequest: {
      id: "pr-1",
      repository_id: "repo-1",
      number: 1,
      author_id: "user-2",
      author_username: "bob",
      title: "Add feature",
      body: "Introduce feature branch changes",
      state: "open",
      base_ref: "refs/heads/main",
      head_ref: "refs/heads/feature",
      base_oid: mainTip,
      head_oid: featureTip,
      merge_commit_oid: null,
      created_at: 1,
      updated_at: 1,
      closed_at: null,
      merged_at: null
    },
    mainTip,
    featureTip
  };
}

describe("PullRequestMergeService", () => {
  it("creates a single-parent squash commit on the base branch", async () => {
    const { storage, pullRequest, mainTip, featureTip } = await createMergeFixture("clean");
    const service = new PullRequestMergeService(storage);

    const result = await service.squashMergePullRequest({
      owner: "alice",
      repo: "demo",
      pullRequest,
      mergedBy: {
        id: "owner-1",
        username: "alice"
      }
    });

    expect(result.createdCommit).toBe(true);
    expect(result.baseOid).toBe(result.mergeCommitOid);
    expect(result.headOid).toBe(featureTip);
    expect(result.mergeCommitOid).not.toBe(mainTip);
    expect(result.mergeCommitOid).not.toBe(featureTip);

    const loaded = await loadRepositoryFromStorage(storage, "alice", "demo");
    const mainRef = await git.resolveRef({
      fs: loaded.fs as never,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: "refs/heads/main"
    });
    const featureRef = await git.resolveRef({
      fs: loaded.fs as never,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: "refs/heads/feature"
    });
    expect(mainRef).toBe(result.mergeCommitOid);
    expect(featureRef).toBe(featureTip);

    const commit = await git.readCommit({
      fs: loaded.fs as never,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      oid: result.mergeCommitOid
    });
    expect(commit.commit.parent).toEqual([mainTip]);
    expect(commit.commit.message).toContain("Add feature (#1)");
    expect(commit.commit.message).toContain("Introduce feature branch changes");

    const tree = await git.readTree({
      fs: loaded.fs as never,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      oid: commit.commit.tree
    });
    const paths = tree.tree.map((entry) => entry.path).sort();
    expect(paths).toEqual(["README.md", "feature.txt", "main.txt"]);
  });

  it("rejects squash merge when the branches conflict", async () => {
    const { storage, pullRequest, mainTip } = await createMergeFixture("conflict");
    const service = new PullRequestMergeService(storage);

    await expect(
      service.squashMergePullRequest({
        owner: "alice",
        repo: "demo",
        pullRequest,
        mergedBy: {
          id: "owner-1",
          username: "alice"
        }
      })
    ).rejects.toBeInstanceOf(PullRequestMergeConflictError);

    const loaded = await loadRepositoryFromStorage(storage, "alice", "demo");
    const mainRef = await git.resolveRef({
      fs: loaded.fs as never,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: "refs/heads/main"
    });
    expect(mainRef).toBe(mainTip);
  });

  it("updates the durable object snapshot after squash merge", async () => {
    const { bucket, storage, pullRequest } = await createMergeFixture("clean");
    const snapshotState = createMockDurableObjectState();
    const service = new PullRequestMergeService(storage, snapshotState.storage);

    const result = await service.squashMergePullRequest({
      owner: "alice",
      repo: "demo",
      pullRequest,
      mergedBy: {
        id: "owner-1",
        username: "alice"
      }
    });

    bucket.clear();

    const loaded = await loadRepositoryFromStorage(
      storage,
      "alice",
      "demo",
      snapshotState.storage
    );
    const mainRef = await git.resolveRef({
      fs: loaded.fs as never,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: "refs/heads/main"
    });

    expect(mainRef).toBe(result.mergeCommitOid);
  });
});
