import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AuthService } from "../services/auth-service";
import { runGit, startAppServer } from "../test-utils/git-cli-server";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { createEnv, createPublicRepositoryDb } from "../test-utils/git-integration-fixture";
import { MockR2Bucket } from "../test-utils/mock-r2";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
  vi.restoreAllMocks();
});

async function fixture(options: Parameters<typeof startAppServer>[1] = {}) {
  const bucket = new MockR2Bucket();
  const env = createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket);
  vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue({
    id: "user-1",
    username: "alice"
  });
  const root = await mkdtemp(join(tmpdir(), "gits-streaming-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const server = await startAppServer(env, options);
  cleanups.push(server.close);
  const remote = `${server.origin.replace("http://", "http://alice:pat-ok@")}/alice/demo.git`;
  return { root, remote, bucket };
}

async function worktree(root: string, remote: string) {
  const dir = join(root, "work");
  await runGit(["init", "-b", "main", dir], root);
  await runGit(["config", "user.name", "Alice"], dir);
  await runGit(["config", "user.email", "alice@example.com"], dir);
  await runGit(["remote", "add", "origin", remote], dir);
  return dir;
}

async function commit(dir: string, message: string) {
  await runGit(["add", "."], dir);
  await runGit(["commit", "-m", message], dir);
}

it("pushes chunked large-file history and clones a valid repository", async () => {
  let chunked = false;
  const { root, remote } = await fixture({
    onRequest(request) {
      if (
        request.url?.endsWith("/git-receive-pack") &&
        request.headers["transfer-encoding"] === "chunked"
      ) {
        chunked = true;
      }
    }
  });
  const dir = await worktree(root, remote);
  const large = randomBytes(5 * 1024 * 1024);
  const changing = randomBytes(3 * 1024 * 1024);
  await writeFile(join(dir, "large.bin"), large);
  await writeFile(join(dir, "changing.bin"), changing);
  await commit(dir, "large initial files");
  for (let i = 0; i < 3; i++) {
    changing.writeUInt32BE(i + 1, i * 1024);
    await writeFile(join(dir, "changing.bin"), changing);
    await commit(dir, `change ${i}`);
  }
  await runGit(["push", "origin", "main"], dir);
  expect(chunked).toBe(true);
  const clone = join(root, "clone");
  await runGit(["clone", remote, clone], root);
  await runGit(["fsck", "--full"], clone);
  expect((await runGit(["rev-parse", "HEAD"], clone)).trim()).toBe(
    (await runGit(["rev-parse", "HEAD"], dir)).trim()
  );
  for (const [name, original] of [
    ["large.bin", large],
    ["changing.bin", changing]
  ] as const) {
    const actual = await readFile(join(clone, name));
    expect(createHash("sha256").update(actual).digest("hex")).toBe(
      createHash("sha256").update(original).digest("hex")
    );
  }
}, 60000);

it("fetches only the changed path after a one-file update in a 200-file repository", async () => {
  const counts: number[] = [];
  const { root, remote } = await fixture({ onPack: (count) => counts.push(count) });
  const dir = await worktree(root, remote);
  await mkdir(join(dir, "nested"));
  for (let i = 0; i < 200; i++) {
    await writeFile(join(dir, "nested", `file-${i}`), `contents ${i}\n`);
  }
  await commit(dir, "200 files");
  await runGit(["push", "origin", "main"], dir);
  const clone = join(root, "old-clone");
  await runGit(["clone", remote, clone], root);
  await writeFile(join(dir, "nested", "file-17"), "only this file changed\n");
  await commit(dir, "one file");
  await runGit(["push", "origin", "main"], dir);
  counts.length = 0;
  await runGit(["fetch", "origin"], clone);
  expect(counts.length).toBeGreaterThan(0);
  expect(counts.every((count) => count > 0 && count <= 4)).toBe(true);
  expect((await runGit(["rev-parse", "origin/main"], clone)).trim()).toBe(
    (await runGit(["rev-parse", "HEAD"], dir)).trim()
  );
  await runGit(["fsck", "--full"], clone);
}, 30000);

it("supports shallow and blob-filtered clones with checkout", async () => {
  const { root, remote, bucket } = await fixture();
  await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const shallow = join(root, "shallow");
  await runGit(["clone", "--depth", "1", remote, shallow], root);
  expect((await runGit(["rev-list", "--count", "HEAD"], shallow)).trim()).toBe("1");
  expect(await readFile(join(shallow, "README.md"), "utf8")).toContain("Updated");
  const partial = join(root, "partial");
  await runGit(["clone", "--filter=blob:none", remote, partial], root);
  expect(await readFile(join(partial, "src", "app.txt"), "utf8")).toContain("hello");
  expect((await runGit(["config", "remote.origin.promisor"], partial)).trim()).toBe("true");
  await runGit(["fsck", "--full"], partial);
}, 30000);

it("migrates a legacy repository on first clone and clones again after R2 removal", async () => {
  const { root, remote, bucket } = await fixture();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
  expect((await bucket.list({ prefix: "alice/demo/" })).objects.length).toBeGreaterThan(0);
  await runGit(["clone", remote, join(root, "first")], root);
  expect((await bucket.list({ prefix: "alice/demo/" })).objects).toEqual([]);
  const second = join(root, "second");
  await runGit(["clone", remote, second], root);
  expect((await runGit(["rev-parse", "HEAD"], second)).trim()).toBe(seeded.latestCommit);
  await runGit(["fsck", "--full"], second);
}, 30000);

it("checks out 300 files from a partial clone using gzip upload-pack requests", async () => {
  let gzipRequests = 0;
  const { root, remote } = await fixture({
    onRequest(request) {
      if (
        request.url?.endsWith("/git-upload-pack") &&
        request.headers["content-encoding"] === "gzip"
      ) {
        gzipRequests++;
      }
    }
  });
  const dir = await worktree(root, remote);
  await mkdir(join(dir, "nested"));
  for (let index = 0; index < 300; index++) {
    await writeFile(join(dir, "nested", `file-${index}`), `unique contents ${index}\n`);
  }
  await commit(dir, "300 files");
  await runGit(["push", "origin", "main"], dir);
  const clone = join(root, "partial-300");
  await runGit(["clone", "--filter=blob:none", remote, clone], root);
  expect(gzipRequests).toBeGreaterThan(0);
  for (let index = 0; index < 300; index++) {
    const path = join("nested", `file-${index}`);
    expect(await readFile(join(clone, path), "utf8")).toBe(await readFile(join(dir, path), "utf8"));
  }
  await runGit(["fsck", "--full"], clone);
}, 30000);
