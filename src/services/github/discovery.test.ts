import { expect, it } from "vitest";
import { githubFixture, githubRepo } from "../../test-utils/github-fixture";
import { discoverSource } from "./discovery";
import { dispatchMirrorTasks } from "./scheduler";
import { recalculateSource } from "./source-store";
import { MAX_MIRROR_BYTES } from "./types";

it("marks missing after complete pagination and restores reappearing repos", async () => {
  const fixture = await githubFixture([githubRepo()]);
  const { env, remote, repos, fetcher } = fixture;
  await discoverSource(env, "source");
  expect(remote().state).toBe("queued");
  fetcher.mockResolvedValueOnce(Response.json([], {
    headers: { Link: "<https://api.test/user/repos?page=2>; rel=\"next\"" }
  })).mockResolvedValueOnce(new Response("oops", { status: 500 }));
  await discoverSource(env, "source");
  expect(remote().missing_since).toBeNull();
  repos.splice(0);
  await discoverSource(env, "source");
  expect(remote()).toMatchObject({ state: "missing", missing_since: expect.any(Number) });
  repos.push(githubRepo());
  await discoverSource(env, "source");
  expect(remote()).toMatchObject({ state: "queued", missing_since: null });
});

it("applies filters, manual selection and the size limit", async () => {
  const { env, remote, sqlite, repos } = await githubFixture([
    githubRepo(1, { fork: true }), githubRepo(2, { archived: true }),
    githubRepo(3, { size: MAX_MIRROR_BYTES / 1024 + 1 })
  ]);
  await discoverSource(env, "source");
  expect(remote(1)).toMatchObject({ included: 0, state: "excluded" });
  expect(remote(2)).toMatchObject({ included: 1, state: "queued" });
  expect(remote(3).state).toBe("too_large");
  sqlite.exec("UPDATE github_repositories SET selection = 'include' WHERE github_repo_id = 1");
  sqlite.exec("UPDATE github_repositories SET selection = 'exclude' WHERE github_repo_id = 2");
  await recalculateSource(env, "source");
  expect(remote(1)).toMatchObject({ included: 1, state: "queued" });
  expect(remote(2)).toMatchObject({ included: 0, state: "excluded" });
  repos[2]!.size = 1;
  await discoverSource(env, "source");
  expect(remote(3).state).toBe("queued");
});

it("transfers by ID and updates metadata without renaming", async () => {
  const { env, remote, sqlite, repos } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const repositoryId = remote().repository_id;
  sqlite.exec(`UPDATE github_repositories SET state = 'synced', lease_until = NULL,
    last_synced_at = 1, last_synced_pushed_at = pushed_at`);
  sqlite.prepare(`INSERT INTO github_sync_sources (id, connection_id, user_id, owner_github_id,
    owner_login, owner_type, next_discovery_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("org", "connection", "user", 20, "team", "organization", 0, 1);
  repos[0] = githubRepo(1, {
    full_name: "team/renamed", description: "new description", visibility: "internal",
    pushed_at: "new-push"
  });
  await discoverSource(env, "org");
  expect(remote()).toMatchObject({
    source_id: "org", repository_id: repositoryId, state: "queued"
  });
  expect(sqlite.prepare("SELECT * FROM repositories WHERE id = ?").get(repositoryId))
    .toMatchObject({ name: "repo-1", description: "new description", is_private: 1 });
  repos[0]!.visibility = "public";
  await discoverSource(env, "org");
  expect(sqlite.prepare("SELECT is_private FROM repositories").get()!.is_private).toBe(0);
  sqlite.exec("UPDATE github_sync_sources SET visibility_policy = 'private' WHERE id = 'org'");
  await recalculateSource(env, "org");
  expect(sqlite.prepare("SELECT is_private FROM repositories").get()!.is_private).toBe(1);
});

it.each([
  [401, {}, "failed", "invalid"],
  [403, { "X-GitHub-SSO": "required" }, "sso_required", "active"],
  [500, {}, "failed", "active"]
])("records discovery HTTP %s errors at the appropriate scope", async (status, headers, s, c) => {
  const { env, fetcher, sqlite } = await githubFixture();
  fetcher.mockResolvedValue(new Response("", { status, headers }));
  await discoverSource(env, "source");
  expect(sqlite.prepare("SELECT status FROM github_sync_sources").get()!.status).toBe(s);
  expect(sqlite.prepare("SELECT status FROM github_connections").get()!.status).toBe(c);
});

it("defers discovery until the rate limit resets", async () => {
  const { env, fetcher, sqlite } = await githubFixture();
  const reset = Math.ceil(Date.now() / 1000) + 7200;
  fetcher.mockResolvedValue(new Response("", { status: 403, headers: {
    "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset)
  } }));
  await discoverSource(env, "source");
  expect(sqlite.prepare("SELECT next_discovery_at FROM github_sync_sources").get()!
    .next_discovery_at).toBe(reset * 1000);
});

it("filter edits preserve linked mirrors and re-inclusion queues them", async () => {
  const { env, sqlite, remote, repos } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const repositoryId = remote().repository_id;
  sqlite.exec(`UPDATE github_repositories SET state = 'synced', lease_until = NULL,
    last_synced_at = 1, last_synced_pushed_at = pushed_at, is_fork = 1`);
  await recalculateSource(env, "source");
  expect(remote()).toMatchObject({ included: 0, state: "synced", repository_id: repositoryId });
  sqlite.exec("UPDATE github_sync_sources SET include_forks = 1");
  await recalculateSource(env, "source");
  expect(remote()).toMatchObject({ included: 1, state: "queued", repository_id: repositoryId });
  await dispatchMirrorTasks(env);
  repos[0]!.size = MAX_MIRROR_BYTES / 1024 + 1;
  await discoverSource(env, "source");
  expect(remote()).toMatchObject({ state: "too_large", claim_id: null, lease_until: null });
});

it("preserves failure backoff across unchanged discoveries", async () => {
  const { env, remote, sqlite } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const retry = Date.now() + 86400000;
  sqlite.prepare(`UPDATE github_repositories SET state = 'failed', lease_until = NULL,
    next_sync_at = ?`).run(retry);
  await discoverSource(env, "source");
  expect(remote()).toMatchObject({ state: "failed", next_sync_at: retry });
});
