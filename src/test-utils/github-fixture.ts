import { workerdFetch } from "./workerd-fetch";
import { vi } from "vitest";
import type { AppBindings } from "../types";
import { encryptToken } from "../services/github/token-crypto";
import type { GithubRepository } from "../services/github/github-client";
import type { RemoteRow } from "../services/github/types";
import { createMockRepositoryObjectNamespace } from "./mock-repository-object-namespace";
import { MockR2Bucket } from "./mock-r2";
import { sqliteD1 } from "./sqlite-d1";

export const githubUser = { id: 10, login: "upstream", avatar_url: null };
export const githubOrg = { id: 20, login: "team", avatar_url: "https://example.com/team.png" };
export const githubToken = "ghp_test_secret";

export function githubRepo(id = 1, patch: Partial<GithubRepository> = {}): GithubRepository {
  return {
    id, name: `repo-${id}`, full_name: `upstream/repo-${id}`,
    html_url: `https://github.com/upstream/repo-${id}`, description: "GitHub description",
    private: false, fork: false, archived: false, size: 1,
    default_branch: "main", pushed_at: "2026-10-10T00:00:00Z", ...patch
  };
}

export async function githubFixture(repos: GithubRepository[] = []) {
  const { db, sqlite } = sqliteD1();
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/user") {
      return Response.json(githubUser, { headers: { "X-OAuth-Scopes": "repo, read:org" } });
    }
    if (url.pathname === "/user/orgs") {
      return Response.json([githubOrg]);
    }
    if (url.pathname === "/orgs/team") {
      return Response.json(githubOrg);
    }
    return Response.json(repos);
  });
  const env: AppBindings = {
    DB: db, GIT_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    REPOSITORY_OBJECTS: createMockRepositoryObjectNamespace(() => env),
    JWT_SECRET: "test-jwt", GITHUB_TOKEN_ENCRYPTION_KEY: "test-encryption-key",
    githubHttp: {
      fetch: workerdFetch(fetcher), apiBaseUrl: "https://api.test", gitBaseUrl: "https://git.test"
    }
  };
  sqlite.prepare(
    "INSERT INTO users VALUES (?, ?, ?, ?, ?)"
  ).run("user", "alice", "alice@example.com", "hash", 1);
  sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)")
    .run("other", "bob", "bob@example.com", "hash", 1);
  await db.prepare(
    `INSERT INTO github_connections (id, user_id, github_user_id, github_login,
     token_kind, token_ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind("connection", "user", 10, "upstream", "classic",
    await encryptToken(githubToken, env.GITHUB_TOKEN_ENCRYPTION_KEY!), 1, 1).run();
  sqlite.prepare(
    `INSERT INTO github_sync_sources (id, connection_id, user_id, owner_github_id,
     owner_login, owner_type, next_discovery_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("source", "connection", "user", 10, "upstream", "user", 0, 1);
  const remote = (id = 1) => sqlite.prepare(
    "SELECT * FROM github_repositories WHERE github_repo_id = ?"
  ).get(id) as RemoteRow;
  return { env, db, sqlite, fetcher, repos, remote };
}
