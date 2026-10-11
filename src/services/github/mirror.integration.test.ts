import { randomBytes } from "node:crypto";
import { workerdFetch } from "../../test-utils/workerd-fetch";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  githubFixture, githubRepo, installationAccessToken
} from "../../test-utils/github-fixture";
import { runGit, startAppServer } from "../../test-utils/git-cli-server";
import { startGitHttpBackend } from "../../test-utils/git-http-backend";
import { repositoryState } from "../../test-utils/mock-repository-object-namespace";
import { RepositoryObject } from "../repository-object";
import { AuthService } from "../auth-service";
import { stopMirror } from "./removal";
import { ObjectStore } from "../git-store/object-store";
import { RefStore } from "../git-store/ref-store";
import { discoverSource } from "./discovery";
import { dispatchMirrorTasks } from "./scheduler";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "gits-github-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "upstream"));
  const bare = join(root, "upstream", "repo-1.git");
  await runGit(["init", "--bare", "-b", "main", bare], root);
  const server = await startGitHttpBackend(root);
  cleanups.push(server.close);
  const fixture = await githubFixture([githubRepo()]);
  const { env, fetcher, sqlite, remote, respond } = fixture;
  env.githubHttp!.gitBaseUrl = server.origin;
  const realFetch = workerdFetch(fetch);
  fetcher.mockImplementation(async (input, init) => {
    if (String(input).startsWith(server.origin)) {
      expect(new Headers(init?.headers).has("Git-Protocol")).toBe(false);
      expect(new Headers(init?.headers).get("Authorization"))
        .toBe(`Basic ${btoa(`x-access-token:${installationAccessToken}`)}`);
      return realFetch(input, init);
    }
    return respond(input, init);
  });
  const sync = async () => {
    await discoverSource(env, "source");
    sqlite.exec("UPDATE github_repositories SET next_sync_at = 0");
    await dispatchMirrorTasks(env);
    const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
    await new RepositoryObject(state, env).alarm();
    expect(remote().last_error).toBeNull();
    expect(remote().state).toBe("synced");
    return { state, store: new ObjectStore(state.storage.sql), refs: new RefStore(state.storage) };
  };
  return { ...fixture, root, bare, sync };
}

it("imports, incrementally fetches, force-aligns and clones a valid repository", async () => {
  const { env, root, bare, sync, fetcher, remote } = await setup();
  const work = join(root, "work");
  await runGit(["init", "-b", "main", work], root);
  await runGit(["config", "user.name", "Alice"], work);
  await runGit(["config", "user.email", "alice@example.com"], work);
  const binary = randomBytes(2 * 1024 * 1024 + 8192);
  await writeFile(join(work, "binary.dat"), binary);
  await writeFile(join(work, "README.md"), "first\n");
  await runGit(["add", "."], work);
  await runGit(["commit", "-m", "initial"], work);
  const initial = (await runGit(["rev-parse", "HEAD"], work)).trim();
  await runGit(["branch", "other"], work);
  await runGit(["tag", "-a", "v1", "-m", "annotated tag"], work);
  await runGit(["push", "--mirror", bare], work);
  const { refs, store } = await sync();
  expect(refs.listRefs()).toHaveLength(3);
  expect(store.readHeader(refs.getRef("refs/tags/v1")!)?.type).toBe("tag");
  const firstCount = store.maxRowid();
  const appServer = await startAppServer(env);
  cleanups.push(appServer.close);
  const clone = join(root, "clone");
  await runGit(["clone", `${appServer.origin}/alice/repo-1.git`, clone], root);
  expect(await readFile(join(clone, "binary.dat"))).toEqual(binary);
  await runGit(["fsck", "--full"], clone);

  await writeFile(join(work, "README.md"), "second\n");
  await runGit(["add", "."], work);
  await runGit(["commit", "-m", "incremental"], work);
  const second = (await runGit(["rev-parse", "HEAD"], work)).trim();
  await runGit(["push", bare, "main"], work);
  await sync();
  expect(refs.getRef("refs/heads/main")).toBe(second);
  expect(store.maxRowid() - firstCount).toBe(3);
  const uploadCalls = fetcher.mock.calls.filter(
    ([input]) => String(input).endsWith("/git-upload-pack")
  );
  expect(uploadCalls).toHaveLength(2);
  const negotiation = new TextDecoder().decode(uploadCalls[1]![1]!.body as Uint8Array);
  expect(negotiation).toContain(`have ${initial}`);
  expect(negotiation).not.toContain("thin-pack");

  await runGit(["reset", "--hard", initial], work);
  await runGit(["branch", "-f", "other", second], work);
  await runGit(["push", "--force", bare, "main", "other", ":refs/tags/v1"], work);
  await runGit(["symbolic-ref", "HEAD", "refs/heads/other"], bare);
  await runGit(["push", bare, ":refs/heads/main"], work);
  await sync();
  expect(refs.listRefs()).toEqual([{ name: "refs/heads/other", oid: second }]);
  expect(refs.getHead()).toBe("ref: refs/heads/other");
  expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith("/git-upload-pack")))
    .toHaveLength(2);
  const finalClone = join(root, "final-clone");
  await runGit(["clone", `${appServer.origin}/alice/repo-1.git`, finalClone], root);
  await runGit(["fsck", "--full"], finalClone);
  expect((await runGit(["rev-parse", "HEAD"], finalClone)).trim()).toBe(second);

  await stopMirror(env, remote());
  const auth = new AuthService(env.DB);
  const token = await auth.createAccessToken({ userId: "user", name: "test" });
  const pushUrl = appServer.origin.replace("http://", `http://alice:${token.token}@`)
    + "/alice/repo-1.git";
  await runGit(["config", "user.name", "Alice"], finalClone);
  await runGit(["config", "user.email", "alice@example.com"], finalClone);
  await writeFile(join(finalClone, "ordinary.txt"), "push after stopping sync");
  await runGit(["add", "."], finalClone);
  await runGit(["commit", "-m", "ordinary repository"], finalClone);
  await runGit(["push", pushUrl, "HEAD:refs/heads/other"], finalClone);
  await runGit(["fsck", "--full"], finalClone);
}, 60000);

it("imports an empty Git repository without requesting a pack", async () => {
  const { sync, fetcher } = await setup();
  const { refs, store } = await sync();
  expect(refs.listRefs()).toEqual([]);
  expect(store.maxRowid()).toBe(0);
  expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith("/git-upload-pack")))
    .toHaveLength(0);
});

it("records git 401 without leaking installation tokens", async () => {
  const { env, remote, sqlite, fetcher } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  fetcher.mockResolvedValue(new Response(installationAccessToken, { status: 401 }));
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  await new RepositoryObject(state, env).alarm();
  expect(remote()).toMatchObject({ state: "failed", lease_until: null });
  expect(remote().last_error).not.toContain(installationAccessToken);

});
