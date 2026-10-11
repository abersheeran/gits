import * as git from "isomorphic-git";
import { afterEach, expect, it, vi } from "vitest";
import { AuthService } from "../services/auth-service";
import { RefStore } from "../services/git-store/ref-store";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import {
  createEnv,
  createIsomorphicGitHttpClient,
  createPrivateOwnedRepositoryDb,
  createPublicRepositoryDb
} from "../test-utils/git-integration-fixture";
import { cleanupTestGitFs, createTestGitFs } from "../test-utils/git-test-fs";
import { MockR2Bucket } from "../test-utils/mock-r2";
import { repositoryState } from "../test-utils/mock-repository-object-namespace";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTestGitFs();
});

it("is compatible with isomorphic-git fetch client", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const env = createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket);

  const { fs, dir } = createTestGitFs();
  await fs.promises.mkdir(dir, { recursive: true });
  await git.init({
    fs: fs as never,
    dir: dir,
    defaultBranch: "main"
  });
  await git.addRemote({
    fs: fs as never,
    dir: dir,
    remote: "origin",
    url: "http://localhost/alice/demo.git",
    force: true
  });

  const result = await git.fetch({
    fs: fs as never,
    http: createIsomorphicGitHttpClient(env) as never,
    dir: dir,
    remote: "origin",
    ref: "main",
    singleBranch: true,
    depth: 1
  });

  expect(result.fetchHead).toBe(seeded.latestCommit);
});

it("supports authenticated push to private repository", async () => {
  const bucket = new MockR2Bucket();
  const listSpy = vi.spyOn(bucket, "list");
  await bucket.put("alice/private-demo/HEAD", "ref: refs/heads/main\n");
  const env = createEnv(
    createPrivateOwnedRepositoryDb("alice", "private-demo"),
    bucket as unknown as R2Bucket
  );
  const prepareSpy = vi.spyOn(env.DB, "prepare");

  vi.spyOn(AuthService.prototype, "verifyAccessToken").mockImplementation(async (token) => {
    if (token === "pat-ok") {
      return { id: "user-1", username: "alice" };
    }
    return null;
  });

  const { fs, dir } = createTestGitFs();
  await fs.promises.mkdir(dir, { recursive: true });
  await git.init({
    fs: fs as never,
    dir: dir,
    defaultBranch: "main"
  });
  await fs.promises.writeFile(`${dir}/README.md`, "# private\n");
  await git.add({
    fs: fs as never,
    dir: dir,
    filepath: "README.md"
  });
  const localCommit = await git.commit({
    fs: fs as never,
    dir: dir,
    message: "initial private commit",
    author: {
      name: "Alice",
      email: "alice@example.com"
    }
  });
  await git.addRemote({
    fs: fs as never,
    dir: dir,
    remote: "origin",
    url: "http://localhost/alice/private-demo.git",
    force: true
  });

  const result = await git.push({
    fs: fs as never,
    http: createIsomorphicGitHttpClient(env) as never,
    dir: dir,
    remote: "origin",
    ref: "main",
    onAuth: async () => ({
      username: "alice",
      password: "pat-ok"
    })
  });

  expect(result.ok).toBe(true);
  expect(result.refs["refs/heads/main"]?.ok).toBe(true);
  expect(prepareSpy).toHaveBeenCalled();
  expect(prepareSpy.mock.calls.every(([sql]) => /^\s*SELECT\b/i.test(sql))).toBe(true);

  const state = repositoryState(env.REPOSITORY_OBJECTS, "repo-private-1");
  const refs = new RefStore(state.storage).listRefs("refs/heads/");
  expect(refs).toHaveLength(1);
  expect(refs[0]?.name).toBe("refs/heads/main");
  expect(refs[0]?.oid).toBe(localCommit);
  expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM objects").one().n).toBeGreaterThan(0);
  expect((await bucket.list({ prefix: "alice/private-demo/" })).objects).toEqual([]);
  expect(
    listSpy.mock.calls.filter(
      ([options]) => (options as R2ListOptions | undefined)?.prefix === "alice/private-demo/"
    )
  ).toHaveLength(3);
});
