import type { AppBindings } from "../../types";
import { GithubClient, GithubError } from "./github-client";
import type { GithubInstallation, GithubOwner } from "./types";

type Skipped = { login: string; reason: "not_owner" | "not_admin" | "taken" };

export async function bindInstallations(env: AppBindings, userId: string, client: GithubClient) {
  const user = await client.user();
  const installations = (await client.installations())
    .filter((installation) => String(installation.app_id) === env.GITHUB_APP_ID);
  const skipped: Skipped[] = [];
  const eligible: GithubInstallation[] = [];
  for (const installation of installations) {
    const account = installation.account;
    if (account.type === "User" && account.id !== user.id) {
      skipped.push({ login: account.login, reason: "not_owner" });
      continue;
    }
    if (account.type === "Organization" && !await isAdmin(client, account.login)) {
      skipped.push({ login: account.login, reason: "not_admin" });
      continue;
    }
    if (account.type === "User" || account.type === "Organization") {
      eligible.push(installation);
    }
  }
  const newSources: string[] = [];
  let bound = 0;
  for (const installation of eligible) {
    const id = crypto.randomUUID();
    const row = await upsertInstallation(env, userId, user, installation, id);
    if (!row) {
      skipped.push({ login: installation.account.login, reason: "taken" });
    } else {
      bound++;
      if (row.id === id) {
        newSources.push(id);
      }
    }
  }
  return { bound, skipped, newSources };
}

async function isAdmin(client: GithubClient, login: string): Promise<boolean> {
  try {
    const membership = await client.get<{ state: string; role: string }>(
      `/user/memberships/orgs/${encodeURIComponent(login)}`
    );
    return membership.state === "active" && membership.role === "admin";
  } catch (error) {
    if (error instanceof GithubError && ["not_found", "forbidden"].includes(error.kind)) {
      return false;
    }
    throw error;
  }
}

async function upsertInstallation(
  env: AppBindings, userId: string, user: GithubOwner, installation: GithubInstallation, id: string
) {
  const now = Date.now();
  const account = installation.account;
  const organization = account.type === "Organization";
  return env.DB.prepare(
    `INSERT INTO github_installations (id, installation_id, user_id, account_id, account_login,
     account_type, avatar_url, repository_selection, linked_by_github_id, linked_by_login,
     name_prefix, suspended, next_discovery_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(installation_id) DO UPDATE SET account_id = excluded.account_id,
       account_login = excluded.account_login, account_type = excluded.account_type,
       avatar_url = excluded.avatar_url, repository_selection = excluded.repository_selection,
       updated_at = excluded.updated_at
     WHERE github_installations.user_id = excluded.user_id RETURNING id`
  ).bind(id, installation.id, userId, account.id, account.login,
    organization ? "organization" : "user", account.avatar_url, installation.repository_selection,
    user.id, user.login, organization ? `${account.login}.` : "",
    Number(installation.suspended_at !== null), now, now, now).first<{ id: string }>();
}
