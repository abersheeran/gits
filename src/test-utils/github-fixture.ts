import { vi } from "vitest";
import type { AppBindings } from "../types";
import type { GithubRepository } from "../services/github/github-client";
import type { GithubInstallation, RemoteRow } from "../services/github/types";
import { createMockRepositoryObjectNamespace } from "./mock-repository-object-namespace";
import { MockR2Bucket } from "./mock-r2";
import { sqliteD1 } from "./sqlite-d1";
import { workerdFetch } from "./workerd-fetch";
import { githubAppKeys } from "./github-app-keys";

export const githubUser = { id: 10, login: "upstream", avatar_url: null, type: "User" } as const;
export const githubOrg = {
  id: 20, login: "team", avatar_url: "https://example.com/team.png", type: "Organization"
} as const;
export const installationAccessToken = "ghs_installation_test";
export const oauthUserToken = "ghu_ephemeral_test";

export function githubRepo(id = 1, patch: Partial<GithubRepository> = {}): GithubRepository {
  return {
    id, name: `repo-${id}`, full_name: `upstream/repo-${id}`,
    html_url: `https://github.com/upstream/repo-${id}`, description: "GitHub description",
    private: false, fork: false, archived: false, size: 1,
    default_branch: "main", pushed_at: "2026-10-10T00:00:00Z", ...patch
  };
}

export function githubInstallation(id = 100, organization = false): GithubInstallation {
  return {
    id, app_id: 789, account: organization ? githubOrg : githubUser,
    repository_selection: "all", suspended_at: null
  };
}

export async function githubFixture(repos: GithubRepository[] = []) {
  const { db, sqlite } = sqliteD1();
  const installations = [githubInstallation()];
  const respond: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/user") {
      return Response.json(githubUser);
    }
    if (path === "/user/installations") {
      return Response.json({ total_count: installations.length, installations });
    }
    if (path.startsWith("/user/memberships/orgs/")) {
      return Response.json({ state: "active", role: "admin" });
    }
    if (path.endsWith("/access_tokens")) {
      return Response.json({
        token: installationAccessToken, expires_at: new Date(Date.now() + 3600000).toISOString()
      });
    }
    if (path.startsWith("/app/installations/")) {
      const installation = installations.find((item) => item.id === Number(path.split("/").pop()));
      return installation ? Response.json(installation) : new Response("", { status: 404 });
    }
    if (path === "/installation/repositories") {
      return Response.json({ total_count: repos.length, repositories: repos });
    }
    if (path === "/login/oauth/access_token") {
      return Response.json({ access_token: oauthUserToken });
    }
    throw new Error(`Unexpected GitHub test request: ${path}`);
  };
  const fetcher = vi.fn<typeof fetch>(respond);
  const env: AppBindings = {
    DB: db, GIT_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    REPOSITORY_OBJECTS: createMockRepositoryObjectNamespace(() => env),
    GITHUB_APP_ID: "789", GITHUB_APP_SLUG: "gits-test",
    GITHUB_APP_CLIENT_ID: `test-client-${crypto.randomUUID()}`,
    GITHUB_APP_CLIENT_SECRET: "test-client-secret",
    GITHUB_APP_WEBHOOK_SECRET: "test-webhook-secret",
    GITHUB_APP_PRIVATE_KEY: (await githubAppKeys()).privateKey,
    githubHttp: {
      fetch: workerdFetch(fetcher), apiBaseUrl: "https://api.test",
      webBaseUrl: "https://web.test", gitBaseUrl: "https://git.test"
    }
  };
  sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)")
    .run("user", "alice", "alice@example.com", "hash", 1);
  sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)")
    .run("other", "bob", "bob@example.com", "hash", 1);
  function seedSource(id: string, installation: GithubInstallation, user = "user") {
    const account = installation.account;
    if (!installations.some((item) => item.id === installation.id)) {
      installations.push(installation);
    }
    sqlite.prepare(
      `INSERT INTO github_installations (id, installation_id, user_id, account_id, account_login,
       account_type, avatar_url, repository_selection, linked_by_github_id, linked_by_login,
       next_discovery_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, installation.id, user, account.id, account.login,
      account.type === "Organization" ? "organization" : "user", account.avatar_url,
      installation.repository_selection, githubUser.id, githubUser.login, 0, 1, 1);
  }
  seedSource("source", installations[0]!);
  const remote = (id = 1) => sqlite.prepare(
    "SELECT * FROM github_repositories WHERE github_repo_id = ?"
  ).get(id) as RemoteRow;
  return { env, db, sqlite, fetcher, respond, repos, installations, seedSource, remote };
}
