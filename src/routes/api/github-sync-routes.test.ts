import { afterEach, beforeEach, expect, it, vi } from "vitest";
import app from "../../app";
import type { AppBindings } from "../../types";
import { AuthService } from "../../services/auth-service";
import { discoverSource } from "../../services/github/discovery";
import { dispatchMirrorTasks } from "../../services/github/scheduler";
import {
  githubFixture, githubRepo, githubUser, githubToken
} from "../../test-utils/github-fixture";
import { repositoryState } from "../../test-utils/mock-repository-object-namespace";

beforeEach(() => {
  vi.spyOn(AuthService.prototype, "verifySessionToken").mockImplementation(async (token) =>
    token === "bob" ? { id: "other", username: "bob" } : { id: "user", username: "alice" });
  vi.spyOn(AuthService.prototype, "verifyAccessToken")
    .mockResolvedValue({ id: "user", username: "alice" });
});
afterEach(() => vi.restoreAllMocks());

async function request(
  env: AppBindings, path: string, method = "GET", body?: unknown, user = "alice"
) {
  return app.fetch(new Request(`http://localhost/api${path}`, {
    method,
    headers: {
      ...(user ? { authorization: `Bearer ${user}` } : {}),
      "Content-Type": "application/json"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
}

it("validates tokens and returns exact connection and configuration shapes", async () => {
  const { env, sqlite, fetcher } = await githubFixture();
  const response = await request(env, "/github/connections", "POST", { token: githubToken });
  expect(response.status).toBe(201);
  const { connection } = await response.json();
  expect(Object.keys(connection).sort()).toEqual([
    "id", "githubLogin", "githubUserId", "avatarUrl", "tokenKind", "status", "lastError",
    "createdAt", "updatedAt", "sources"
  ].sort());
  expect(connection).toMatchObject({ githubLogin: "upstream", tokenKind: "classic", sources: [] });
  const saved = sqlite.prepare("SELECT token_ciphertext FROM github_connections WHERE id = ?")
    .get(connection.id)!;
  expect(saved.token_ciphertext).not.toContain(githubToken);
  const list = await (await request(env, "/github/connections")).json();
  expect(list.configured).toBe(true);
  expect(list.connections).toHaveLength(2);
  expect(Object.keys(list.connections[0].sources[0]).sort()).toEqual([
    "id", "connectionId", "ownerLogin", "ownerType", "avatarUrl", "status", "lastError",
    "lastDiscoveredAt", "repositoryCount", "syncedCount", "attentionCount"
  ].sort());
  expect((await request(env, "/github/connections", "GET", undefined, "bob")).status).toBe(200);
  expect((await (await request(env, "/github/connections", "GET", undefined, "bob")).json())
    .connections).toEqual([]);
  expect((await request(env, "/github/connections", "POST", {}, "")).status).toBe(401);
  expect((await request(env, "/github/connections", "GET", undefined, "")).status).toBe(401);
  fetcher.mockResolvedValueOnce(new Response("", { status: 401 }));
  const invalid = await request(env, "/github/connections", "POST", { token: githubToken });
  expect(invalid.status).toBe(400);
  delete env.GITHUB_TOKEN_ENCRYPTION_KEY;
  expect(await (await request(env, "/github/connections")).json())
    .toEqual({ configured: false, connections: [] });
  const disabled = await request(env, "/github/connections", "POST", { token: githubToken });
  expect(disabled.status).toBe(503);
});

it("replaces only the same account token, resumes discovery, and lists live owners", async () => {
  const { env, sqlite, fetcher } = await githubFixture();
  sqlite.exec("UPDATE github_connections SET status = 'invalid'");
  const replacement = await request(env, "/github/connections/connection", "PATCH", {
    token: "github_pat_new"
  });
  expect(replacement.status).toBe(200);
  expect((await replacement.json()).connection.status).toBe("active");
  expect(sqlite.prepare("SELECT next_discovery_at FROM github_sync_sources").get()!
    .next_discovery_at).toBeGreaterThan(1);
  fetcher.mockResolvedValueOnce(Response.json({ ...githubUser, id: 999 }));
  expect((await request(env, "/github/connections/connection", "PATCH", {
    token: "github_pat_other"
  })).status).toBe(409);
  const owners = await (await request(env, "/github/connections/connection/owners")).json();
  expect(owners).toEqual({ owners: [
    { login: "upstream", type: "user", githubId: 10, avatarUrl: null, sourceId: "source" },
    { login: "team", type: "organization", githubId: 20,
      avatarUrl: "https://example.com/team.png", sourceId: null }
  ] });
  const duplicate = await (await request(env, "/github/connections", "POST", {
    token: "github_pat_other_resource"
  })).json();
  const otherOwners = await (await request(env,
    `/github/connections/${duplicate.connection.id}/owners`)).json();
  expect(otherOwners.owners[0].sourceId).toBeNull();
});

it("creates and updates sources with exact response and pagination shapes", async () => {
  const { env, repos } = await githubFixture([githubRepo()]);
  const created = await request(env, "/github/sources", "POST", {
    connectionId: "connection", ownerLogin: "team", paused: true
  });
  expect(created.status).toBe(201);
  const { source } = await created.json();
  expect(source).toMatchObject({ namePrefix: "team.", paused: true, repositoryCount: 0 });
  expect(Object.keys(source).sort()).toEqual([
    "id", "connectionId", "ownerLogin", "ownerType", "avatarUrl", "status", "lastError",
    "lastDiscoveredAt", "repositoryCount", "syncedCount", "attentionCount", "namePrefix",
    "includeForks", "includeArchived", "visibilityPolicy", "intervalMinutes", "paused", "counts"
  ].sort());
  expect((await request(env, "/github/sources", "POST", {
    connectionId: "connection", ownerLogin: "team"
  })).status).toBe(409);
  expect((await request(env, `/github/sources/${source.id}`, "PATCH", {
    includeForks: true, visibilityPolicy: "private", intervalMinutes: 15, paused: false
  })).status).toBe(200);
  const synced = await request(env, `/github/sources/${source.id}/sync`, "POST");
  expect((await synced.json()).source.repositoryCount).toBe(1);
  expect((await request(env, `/github/sources/${source.id}`)).status).toBe(200);
  const list = await (await request(env, `/github/sources/${source.id}/repositories`)).json();
  expect(list).toMatchObject({ page: 1, perPage: 50, total: 1, hasNextPage: false });
  expect(Object.keys(list.items[0]).sort()).toEqual([
    "githubRepoId", "fullName", "htmlUrl", "description", "isPrivate", "isFork", "isArchived",
    "sizeKb", "selection", "localName", "repository", "state", "lastError", "lastSyncedAt"
  ].sort());
  expect((await request(env, `/github/sources/${source.id}/repositories/1`, "PATCH", {
    selection: "exclude", localName: "chosen"
  })).status).toBe(200);
  const excluded = await (await request(env,
    `/github/sources/${source.id}/repositories?status=excluded`)).json();
  expect(excluded.items[0]).toMatchObject({
    repository: null, selection: "exclude", localName: "chosen"
  });
  expect((await request(env, `/github/sources/${source.id}/repositories/1`, "PATCH", {
    localName: "invalid/name"
  })).status).toBe(400);
  repos.push(...Array.from({ length: 51 }, (_, i) => githubRepo(i + 2)));
  await discoverSource(env, source.id);
  const page = await (await request(env,
    `/github/sources/${source.id}/repositories?page=2`)).json();
  expect(page).toMatchObject({ total: 52, page: 2, hasNextPage: false });
  expect(page.items).toHaveLength(2);
});

const privateEndpoints: Array<[string, string, unknown?]> = [
  ["PATCH", "/github/connections/connection", { token: githubToken }],
  ["DELETE", "/github/connections/connection"],
  ["GET", "/github/connections/connection/owners"],
  ["POST", "/github/sources", { connectionId: "connection", ownerLogin: "team" }],
  ["GET", "/github/sources/source"],
  ["PATCH", "/github/sources/source", { paused: true }],
  ["DELETE", "/github/sources/source"],
  ["POST", "/github/sources/source/sync"],
  ["GET", "/github/sources/source/repositories"],
  ["PATCH", "/github/sources/source/repositories/1", { selection: "include" }]
];
it.each(privateEndpoints)("returns 404 for another user's %s %s", async (method, path, body) => {
  const { env } = await githubFixture([githubRepo()]);
  expect((await request(env, path, method, body, "bob")).status).toBe(404);
});

it.each(["source", "connection"])("removes a %s and preserves local repositories", async (kind) => {
  const { env, remote, sqlite } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const id = remote().repository_id!;
  const state = repositoryState(env.REPOSITORY_OBJECTS, id);
  const path = kind === "source" ? "/github/sources/source" : "/github/connections/connection";
  expect((await request(env, path, "DELETE")).status).toBe(200);
  expect(await state.storage.getAlarm()).toBeNull();
  expect(sqlite.prepare("SELECT COUNT(*) n FROM repositories").get()!.n).toBe(1);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM github_repositories").get()!.n).toBe(0);
});

it("enforces mirror read-only rules and restores writes after stopping", async () => {
  const { env, remote, sqlite } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const base = "/repos/alice/repo-1";
  for (const [method, suffix, payload] of [
    ["PATCH", "", { description: "new" }], ["PATCH", "", { isPrivate: true }],
    ["POST", "/branches", { branchName: "feature", sourceOid: "a".repeat(40) }],
    ["PATCH", "/default-branch", { branchName: "feature" }],
    ["DELETE", "/branches/feature", undefined]
  ] as const) {
    expect((await request(env, base + suffix, method, payload)).status).toBe(409);
  }
  expect((await request(env, base + "/mirror/sync", "POST", undefined, "bob")).status).toBe(403);
  expect((await request(env, base + "/mirror", "DELETE", undefined, "bob")).status).toBe(403);
  expect((await request(env, base + "/mirror/sync", "POST")).status).toBe(200);
  const detail = await (await request(env, base)).json();
  expect(Object.keys(detail.repository).sort()).toEqual([
    "id", "owner_id", "owner_username", "name", "description", "is_private", "created_at"
  ].sort());
  expect(Object.keys(detail.mirror).sort()).toEqual([
    "sourceId", "fullName", "htmlUrl", "state", "lastSyncedAt", "lastError"
  ].sort());
  expect((await (await request(env, "/repos")).json()).repositories[0].is_mirror).toBe(1);
  const push = async (method: "GET" | "POST") => app.fetch(new Request(
    "http://localhost/alice/repo-1.git/" + (method === "GET"
      ? "info/refs?service=git-receive-pack" : "git-receive-pack"), {
      method, headers: { authorization: `Basic ${btoa("alice:token")}`,
        "Content-Type": "application/x-git-receive-pack-request" }
    }), env);
  for (const method of ["GET", "POST"] as const) {
    const response = await push(method);
    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe(
      "This repository is a read-only mirror of upstream/repo-1 on GitHub."
    );
  }
  expect((await request(env, base, "PATCH", { name: "renamed" })).status).toBe(200);
  const renamed = await request(env, "/repos/alice/renamed", "PATCH", { name: "repo-1" });
  expect(renamed.status).toBe(200);
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  expect((await request(env, base + "/mirror", "DELETE")).status).toBe(200);
  expect(await state.storage.getAlarm()).toBeNull();
  expect(remote()).toMatchObject({ selection: "exclude", state: "excluded", repository_id: null });
  expect((await push("GET")).status).toBe(200);
  expect((await request(env, base, "PATCH", { description: "ordinary" })).status).toBe(200);
  const repository = sqlite.prepare("SELECT description FROM repositories").get()!;
  expect(repository.description).toBe("ordinary");
});

it("deleting a mirror excludes its remote before deleting local data", async () => {
  const { env, remote, sqlite } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  expect((await request(env, "/repos/alice/repo-1", "DELETE")).status).toBe(200);
  expect(remote()).toMatchObject({ selection: "exclude", included: 0, repository_id: null });
  expect(sqlite.prepare("SELECT COUNT(*) n FROM repositories").get()!.n).toBe(0);
});
