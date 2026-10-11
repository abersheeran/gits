import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../services/auth-service";
import { RefStore } from "../services/git-store/ref-store";
import { runGit, startAppServer } from "../test-utils/git-cli-server";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import {
  createEnv,
  createPrivateOwnedRepositoryDb,
  createPublicRepositoryDb
} from "../test-utils/git-integration-fixture";
import { MockR2Bucket } from "../test-utils/mock-r2";
import { repositoryState } from "../test-utils/mock-repository-object-namespace";

describe("Git smart-http compatibility with git CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supports git clone for public repositories", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");
    const env = createEnv(db, bucket as unknown as R2Bucket);
    const server = await startAppServer(env);
    const tempRoot = await mkdtemp(join(tmpdir(), "gits-cli-clone-"));
    const cloneDir = join(tempRoot, "clone");

    try {
      await runGit(["clone", `${server.origin}/alice/demo.git`, cloneDir], tempRoot);
      const readme = await readFile(join(cloneDir, "README.md"), "utf8");
      expect(readme).toContain("# Demo");
    } finally {
      await server.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("supports authenticated git push to private repositories", async () => {
    const bucket = new MockR2Bucket();
    await bucket.put("alice/private-demo/HEAD", "ref: refs/heads/main\n");
    const db = createPrivateOwnedRepositoryDb("alice", "private-demo");
    const env = createEnv(db, bucket as unknown as R2Bucket);
    const verifyTokenSpy = vi
      .spyOn(AuthService.prototype, "verifyAccessToken")
      .mockImplementation(async (token: string) => {
        if (token === "pat-ok") {
          return { id: "user-1", username: "alice" };
        }
        return null;
      });

    const server = await startAppServer(env);
    const tempRoot = await mkdtemp(join(tmpdir(), "gits-cli-push-"));
    const workDir = join(tempRoot, "work");

    try {
      await runGit(["init", "-b", "main", workDir], tempRoot);
      await runGit(["config", "user.name", "Alice"], workDir);
      await runGit(["config", "user.email", "alice@example.com"], workDir);
      await writeFile(join(workDir, "README.md"), "# private\n", "utf8");
      await runGit(["add", "README.md"], workDir);
      await runGit(["commit", "-m", "initial private commit"], workDir);
      const localCommit = (await runGit(["rev-parse", "HEAD"], workDir)).trim();
      const origin = server.origin.replace("http://", "http://alice:pat-ok@");
      const remoteUrl = `${origin}/alice/private-demo.git`;
      await runGit(["remote", "add", "origin", remoteUrl], workDir);
      await runGit(["push", "origin", "main"], workDir);

      expect(verifyTokenSpy).toHaveBeenCalled();
      const state = repositoryState(env.REPOSITORY_OBJECTS, "repo-private-1");
      const refs = new RefStore(state.storage).listRefs("refs/heads/");
      expect(refs).toHaveLength(1);
      expect(refs[0]?.name).toBe("refs/heads/main");
      expect(refs[0]?.oid).toBe(localCommit);
    } finally {
      await server.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("supports authenticated git pull from private repositories", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "private-pull");
    const db = createPrivateOwnedRepositoryDb("alice", "private-pull");
    const env = createEnv(db, bucket as unknown as R2Bucket);
    vi.spyOn(AuthService.prototype, "verifyAccessToken").mockImplementation(
      async (token: string) => {
        if (token === "pat-ok") {
          return { id: "user-1", username: "alice" };
        }
        return null;
      }
    );

    const server = await startAppServer(env);
    const tempRoot = await mkdtemp(join(tmpdir(), "gits-cli-pull-"));
    const workDir = join(tempRoot, "work");
    const mirrorDir = join(tempRoot, "mirror");

    try {
      const origin = server.origin.replace("http://", "http://alice:pat-ok@");
      const remoteUrl = `${origin}/alice/private-pull.git`;
      await runGit(["clone", remoteUrl, workDir], tempRoot);
      const beforePull = (await runGit(["rev-parse", "HEAD"], workDir)).trim();

      await runGit(["clone", remoteUrl, mirrorDir], tempRoot);
      await runGit(["config", "user.name", "Alice"], mirrorDir);
      await runGit(["config", "user.email", "alice@example.com"], mirrorDir);
      const readmePath = join(mirrorDir, "README.md");
      const readmeContent = await readFile(readmePath, "utf8");
      await writeFile(readmePath, `${readmeContent}\nupdate from mirror\n`, "utf8");
      await runGit(["add", "README.md"], mirrorDir);
      await runGit(["commit", "-m", "update from mirror"], mirrorDir);
      const pushedCommit = (await runGit(["rev-parse", "HEAD"], mirrorDir)).trim();
      await runGit(["push", "origin", "main"], mirrorDir);

      await runGit(["pull", "origin", "main"], workDir);
      const afterPull = (await runGit(["rev-parse", "HEAD"], workDir)).trim();
      const pulledReadme = await readFile(join(workDir, "README.md"), "utf8");

      expect(afterPull).not.toBe(beforePull);
      expect(afterPull).toBe(pushedCommit);
      expect(pulledReadme).toContain("update from mirror");
    } finally {
      await server.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
