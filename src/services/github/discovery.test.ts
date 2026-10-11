import { expect, it } from "vitest";
import { githubFixture, githubRepo, githubInstallation } from "../../test-utils/github-fixture";
import { discoverSource } from "./discovery";
import { dispatchMirrorTasks } from "./scheduler";
import { recalculateSource } from "./source-store";
import { MAX_MIRROR_BYTES } from "./types";

it("marks missing after complete pagination and restores reappearing repos", async () => {
  const fixture = await githubFixture([githubRepo()]);
  const { env, remote, repos, fetcher, installations } = fixture;
  await discoverSource(env, "source");
  expect(remote().state).toBe("queued");
  fetcher.mockResolvedValueOnce(Response.json(installations[0]))
    .mockResolvedValueOnce(Response.json({ repositories: [] }, {
      headers: { Link: '<https://api.test/installation/repositories?page=2>; rel="next"' }
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
  const { env, remote, sqlite, repos, seedSource } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const repositoryId = remote().repository_id;
  sqlite.exec(`UPDATE github_repositories SET state = 'synced', lease_until = NULL,
    last_synced_at = 1, last_synced_pushed_at = pushed_at`);
  seedSource("org", githubInstallation(200, true));
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
  sqlite.exec("UPDATE github_installations SET visibility_policy = 'private' WHERE id = 'org'");
  await recalculateSource(env, "org");
  expect(sqlite.prepare("SELECT is_private FROM repositories").get()!.is_private).toBe(1);
});

it.each([
  [401, "failed"], [403, "suspended"], [500, "failed"]
])("records discovery HTTP %s errors at the installation", async (status, expected) => {
  const { env, fetcher, sqlite } = await githubFixture();
  fetcher.mockResolvedValue(new Response("", { status }));
  await discoverSource(env, "source");
  expect(sqlite.prepare("SELECT status FROM github_installations").get()!.status).toBe(expected);
});

it("automatically unbinds deleted installations and preserves local repositories", async () => {
  const { env, remote, installations, sqlite } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const id = remote().repository_id;
  installations.splice(0);
  await discoverSource(env, "source");
  expect(sqlite.prepare("SELECT * FROM github_installations").all()).toEqual([]);
  expect(sqlite.prepare("SELECT * FROM repositories WHERE id = ?").get(id)).toBeDefined();
  expect(sqlite.prepare("SELECT * FROM github_repositories").all()).toEqual([]);
});

it("defers discovery until the rate limit resets", async () => {
  const { env, fetcher, sqlite } = await githubFixture();
  const reset = Math.ceil(Date.now() / 1000) + 7200;
  fetcher.mockResolvedValue(new Response("", { status: 403, headers: {
    "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset)
  } }));
  await discoverSource(env, "source");
  expect(sqlite.prepare("SELECT next_discovery_at FROM github_installations").get()!
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
  sqlite.exec("UPDATE github_installations SET include_forks = 1");
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

it("reads every installation repository page before marking missing", async () => {
  const { env, remote, fetcher, respond } = await githubFixture([githubRepo(9)]);
  await discoverSource(env, "source");
  fetcher.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname !== "/installation/repositories") {
      return respond(input, init);
    }
    return url.searchParams.get("page") === "2"
      ? Response.json({ total_count: 2, repositories: [githubRepo(2)] })
      : Response.json({ total_count: 2, repositories: [githubRepo(1)] }, {
        headers: { Link: '<https://api.test/installation/repositories?page=2>; rel="next"' }
      });
  });
  await discoverSource(env, "source");
  expect(remote(1).state).toBe("queued");
  expect(remote(2).state).toBe("queued");
  expect(remote(9).state).toBe("missing");
});
