import { expect, it, vi } from "vitest";
import { githubFixture, githubRepo } from "../../test-utils/github-fixture";
import { repositoryState } from "../../test-utils/mock-repository-object-namespace";
import { RepositoryObject } from "../repository-object";
import { discoverSource } from "./discovery";
import { MIRROR_TASK_KEY } from "./mirror-alarm";
import { dispatchMirrorTasks, runScheduler } from "./scheduler";
import { completeTask, retryDelay } from "./task-state";
import type { MirrorTask } from "./types";

it("atomically claims at most four distinct tasks across simultaneous dispatches", async () => {
  const repos = Array.from({ length: 8 }, (_, i) => githubRepo(i + 1));
  const { env, sqlite } = await githubFixture(repos);
  await discoverSource(env, "source");
  await Promise.all([dispatchMirrorTasks(env), dispatchMirrorTasks(env)]);
  const rows = sqlite.prepare("SELECT * FROM github_repositories WHERE state = 'syncing'").all();
  expect(rows).toHaveLength(4);
  expect(new Set(rows.map((row) => row.claim_id)).size).toBe(4);
  expect(rows.every((row) => row.attempts === 1)).toBe(true);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM repositories").get()!.n).toBe(4);
  for (const row of rows) {
    const state = repositoryState(env.REPOSITORY_OBJECTS, String(row.repository_id));
    expect(await state.storage.get(MIRROR_TASK_KEY)).toMatchObject({ claimId: row.claim_id });
    expect(await state.storage.getAlarm()).toBeTypeOf("number");
  }
});

it.each(["repo-1", "x".repeat(101)])("rejects conflicting or invalid names", async (name) => {
  const { env, sqlite, remote } = await githubFixture([githubRepo()]);
  sqlite.prepare("INSERT INTO repositories VALUES (?, ?, ?, ?, ?, ?)")
    .run("existing", "user", "repo-1", null, 1, 1);
  await discoverSource(env, "source");
  sqlite.prepare("UPDATE github_repositories SET local_name = ?").run(name);
  await dispatchMirrorTasks(env);
  expect(remote()).toMatchObject({
    state: "name_conflict", repository_id: null, lease_until: null
  });
  expect(sqlite.prepare("SELECT COUNT(*) n FROM repositories").get()!.n).toBe(1);
});

it("uses the specified backoff and recovers expired leases instead of hot-looping", async () => {
  expect([1, 2, 3, 4, 5, 6, 99].map(retryDelay))
    .toEqual([5, 15, 60, 360, 1440, 1440, 1440].map((n) => n * 60000));
  const { env, sqlite, remote } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  sqlite.exec("UPDATE github_repositories SET lease_until = 1");
  await dispatchMirrorTasks(env);
  expect(remote()).toMatchObject({ state: "failed", attempts: 1, lease_until: null });
  expect(remote().next_sync_at).toBeGreaterThan(Date.now() + 299000);
});

it.each(["claim", "expired", "detached"])("discards a stale alarm task: %s", async (reason) => {
  const { env, remote, sqlite, fetcher } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  const statements = {
    claim: "UPDATE github_repositories SET claim_id = 'replacement'",
    expired: "UPDATE github_repositories SET lease_until = 1",
    detached: "UPDATE github_repositories SET repository_id = NULL"
  };
  sqlite.exec(statements[reason]);
  fetcher.mockClear();
  await new RepositoryObject(state, env).alarm();
  expect(fetcher).not.toHaveBeenCalled();
  expect(await state.storage.get(MIRROR_TASK_KEY)).toBeUndefined();
});

it("requeues changed pushed_at and fences obsolete task completions", async () => {
  const { env, remote, sqlite } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  const task = (await state.storage.get<MirrorTask>(MIRROR_TASK_KEY))!;
  sqlite.exec("UPDATE github_repositories SET pushed_at = 'newer'");
  await completeTask(env, { ...task, claimId: "obsolete" });
  expect(remote().state).toBe("syncing");
  await completeTask(env, task);
  expect(remote()).toMatchObject({
    state: "queued", attempts: 0, lease_until: null,
    last_synced_pushed_at: "2026-10-10T00:00:00Z"
  });
  expect(remote().next_sync_at).toBeLessThanOrEqual(Date.now());
});

it("claims at most five due sources and skips paused or invalid connections", async () => {
  const { env, sqlite, fetcher } = await githubFixture();
  for (let i = 1; i <= 7; i++) {
    sqlite.prepare(`INSERT INTO github_sync_sources (id, connection_id, user_id, owner_github_id,
      owner_login, owner_type, next_discovery_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`source-${i}`, "connection", "user", 100 + i, `owner-${i}`, "organization", 0, 1);
  }
  await runScheduler(env);
  expect(fetcher).toHaveBeenCalledTimes(5);
  await runScheduler(env);
  expect(fetcher).toHaveBeenCalledTimes(8);
  sqlite.exec("UPDATE github_sync_sources SET next_discovery_at = 0, paused = 1");
  await runScheduler(env);
  expect(fetcher).toHaveBeenCalledTimes(8);
  sqlite.exec("UPDATE github_sync_sources SET paused = 0");
  sqlite.exec("UPDATE github_connections SET status = 'invalid'");
  await runScheduler(env);
  expect(fetcher).toHaveBeenCalledTimes(8);
});

it("catches alarm infrastructure errors without platform retries", async () => {
  const { env, remote } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  const spy = vi.spyOn(state.storage, "get").mockRejectedValue(new Error("storage unavailable"));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(new RepositoryObject(state, env).alarm()).resolves.toBeUndefined();
  spy.mockRestore();
  log.mockRestore();
});

it("continues immediately when pushed_at changes during an alarm", async () => {
  const { env, remote, sqlite, fetcher } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const oldPush = remote().claimed_pushed_at;
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  fetcher.mockImplementation(async () => {
    sqlite.exec("UPDATE github_repositories SET pushed_at = 'newer'");
    return new Response("001e# service=git-upload-pack\n00000000");
  });
  await new RepositoryObject(state, env).alarm();
  expect(remote()).toMatchObject({
    state: "syncing", claimed_pushed_at: "newer", last_synced_pushed_at: oldPush, attempts: 1
  });
  await new RepositoryObject(state, env).alarm();
  expect(remote()).toMatchObject({ state: "synced", attempts: 0, lease_until: null });
});

it("discovery does not bypass crash recovery backoff", async () => {
  const { env, remote, sqlite } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  sqlite.exec("UPDATE github_repositories SET lease_until = 1");
  sqlite.exec("UPDATE github_sync_sources SET next_discovery_at = 0");
  await runScheduler(env);
  expect(remote()).toMatchObject({ state: "failed", attempts: 1, lease_until: null });
  expect(remote().next_sync_at).toBeGreaterThan(Date.now());
});
