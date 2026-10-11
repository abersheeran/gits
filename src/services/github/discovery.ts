import { getInstallation, installationClient } from "./app-auth";
import { githubConfigured } from "./config";
import type { AppBindings } from "../../types";
import {
  findSource, recordSourceError, sourceRecalculation, suspendSource
} from "./source-store";
import { DISCOVERY_INTERVAL_MS, LEASE_MS, MAX_MIRROR_BYTES } from "./types";

export async function discoverSource(env: AppBindings, sourceId: string, claimId?: string) {
  if (!githubConfigured(env)) {
    return;
  }
  const now = Date.now();
  const claim = claimId ?? crypto.randomUUID();
  if (!claimId) {
    // Keep a request arriving during an active discovery due for the next cron.
    await env.DB.prepare(
      "UPDATE github_installations SET next_discovery_at = 0 WHERE id = ?"
    ).bind(sourceId).run();
    const result = await env.DB.prepare(
      `UPDATE github_installations SET lease_until = ?, claim_id = ?, next_discovery_at = ?
       WHERE id = ? AND paused = 0 AND (lease_until IS NULL OR lease_until < ?)
       AND (rate_limit_until IS NULL OR rate_limit_until <= ?)
       RETURNING id`
    ).bind(now + LEASE_MS, claim, now + LEASE_MS, sourceId, now, now).all();
    if (!result.results.length) {
      return;
    }
  }
  const source = await findSource(env, sourceId);
  if (!source || source.claim_id !== claim) {
    return;
  }
  try {
    const installation = await getInstallation(env, source.installation_id);
    const updated = await env.DB.prepare(
      `UPDATE github_installations SET account_id = ?, account_login = ?, account_type = ?,
       avatar_url = ?, repository_selection = ?, suspended = ?, updated_at = ?
       WHERE id = ? AND claim_id = ? RETURNING id`
    ).bind(installation.account.id, installation.account.login,
      installation.account.type === "Organization" ? "organization" : "user",
      installation.account.avatar_url, installation.repository_selection,
      Number(installation.suspended_at !== null), now, source.id, claim).first();
    if (!updated) {
      return;
    }
    if (installation.suspended_at) {
      await suspendSource(env, source.id);
      return;
    }
    const client = await installationClient(env, source.installation_id);
    const repositories = await client.repositories();
    const statements = repositories.map((repo) => env.DB.prepare(
      `INSERT INTO github_repositories
       (id, source_id, user_id, github_repo_id, full_name, html_url, description,
        is_private, is_fork, is_archived, size_kb, default_branch, pushed_at,
        last_seen_at, discovery_id, next_sync_at, sync_requested_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM github_installations WHERE id = ? AND claim_id = ?)
       ON CONFLICT(user_id, github_repo_id) DO UPDATE SET
         source_id = excluded.source_id, full_name = excluded.full_name,
         html_url = excluded.html_url, description = excluded.description,
         is_private = excluded.is_private, is_fork = excluded.is_fork,
         is_archived = excluded.is_archived, size_kb = excluded.size_kb,
         default_branch = excluded.default_branch,
         sync_requested_at = CASE WHEN github_repositories.pushed_at IS NOT excluded.pushed_at
           THEN MAX(excluded.sync_requested_at, COALESCE(claimed_at + 1, 0), sync_requested_at)
           ELSE sync_requested_at END,
         pushed_at = excluded.pushed_at,
         last_seen_at = excluded.last_seen_at, discovery_id = excluded.discovery_id,
         missing_since = NULL`
    ).bind(
      crypto.randomUUID(), source.id, source.user_id, repo.id, repo.full_name, repo.html_url,
      repo.description, Number(repo.private || repo.visibility === "internal"), Number(repo.fork),
      Number(repo.archived), repo.size, repo.default_branch, repo.pushed_at, now, claim, now, now,
      source.id, claim
    ));
    for (let offset = 0; offset < statements.length; offset += 40) {
      await env.DB.batch(statements.slice(offset, offset + 40));
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE github_repositories SET state = 'missing',
           missing_since = COALESCE(missing_since, ?), lease_until = NULL, claim_id = NULL
         WHERE source_id = ? AND discovery_id IS NOT ?
         AND EXISTS (SELECT 1 FROM github_installations WHERE id = ? AND claim_id = ?)`
      ).bind(now, source.id, claim, source.id, claim),
      ...sourceRecalculation(env.DB, source.id, now, claim),
      env.DB.prepare(
        `UPDATE github_repositories SET state = 'queued', next_sync_at = ?
         WHERE source_id = ? AND included = 1 AND missing_since IS NULL
         AND size_kb * 1024 <= ? AND (lease_until IS NULL OR lease_until < ?)
         AND (last_synced_at IS NULL OR pushed_at IS NOT last_synced_pushed_at)
         AND state NOT IN ('name_conflict', 'syncing')
         AND (state != 'failed' OR next_sync_at <= ? OR pushed_at IS NOT claimed_pushed_at)
         AND EXISTS (SELECT 1 FROM github_installations WHERE id = ? AND claim_id = ?)`
      ).bind(now, source.id, MAX_MIRROR_BYTES, now, now, source.id, claim),
      env.DB.prepare(
        `UPDATE github_installations SET status = 'ok', last_error = NULL,
           last_discovered_at = ?, next_discovery_at = CASE WHEN next_discovery_at = lease_until
             THEN ? ELSE next_discovery_at END, lease_until = NULL, claim_id = NULL
         WHERE id = ? AND claim_id = ?`
      ).bind(now, now + DISCOVERY_INTERVAL_MS, source.id, claim)
    ]);
  } catch (error) {
    await recordSourceError(env, source, error, claim);
  }
}
