import type { AppBindings } from "../../types";
import {
  connectionClient, recordSourceError, sourceConnection, sourceRecalculation
} from "./source-store";
import { LEASE_MS, MAX_MIRROR_BYTES } from "./types";

export async function discoverSource(env: AppBindings, sourceId: string, claimId?: string) {
  if (!env.GITHUB_TOKEN_ENCRYPTION_KEY) {
    return;
  }
  const now = Date.now();
  const claim = claimId ?? crypto.randomUUID();
  if (!claimId) {
    const result = await env.DB.prepare(
      `UPDATE github_sync_sources SET lease_until = ?, claim_id = ?
       WHERE id = ? AND paused = 0 AND (lease_until IS NULL OR lease_until < ?)
       AND connection_id IN (SELECT id FROM github_connections WHERE status = 'active')
       RETURNING id`
    ).bind(now + LEASE_MS, claim, sourceId, now).all();
    if (!result.results.length) {
      return;
    }
  }
  const { source, connection } = await sourceConnection(env, sourceId);
  if (!source || !connection || source.claim_id !== claim) {
    return;
  }
  try {
    const client = await connectionClient(env, connection);
    const repositories = await client.repositories(source.owner_type, source.owner_login);
    const statements = repositories.map((repo) => env.DB.prepare(
      `INSERT INTO github_repositories
       (id, source_id, user_id, github_repo_id, full_name, html_url, description,
        is_private, is_fork, is_archived, size_kb, default_branch, pushed_at,
        last_seen_at, discovery_id, next_sync_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM github_sync_sources WHERE id = ? AND claim_id = ?)
       ON CONFLICT(user_id, github_repo_id) DO UPDATE SET
         source_id = excluded.source_id, full_name = excluded.full_name,
         html_url = excluded.html_url, description = excluded.description,
         is_private = excluded.is_private, is_fork = excluded.is_fork,
         is_archived = excluded.is_archived, size_kb = excluded.size_kb,
         default_branch = excluded.default_branch, pushed_at = excluded.pushed_at,
         last_seen_at = excluded.last_seen_at, discovery_id = excluded.discovery_id,
         missing_since = NULL`
    ).bind(
      crypto.randomUUID(), source.id, source.user_id, repo.id, repo.full_name, repo.html_url,
      repo.description, Number(repo.private || repo.visibility === "internal"), Number(repo.fork),
      Number(repo.archived), repo.size, repo.default_branch, repo.pushed_at, now, claim, now,
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
         AND EXISTS (SELECT 1 FROM github_sync_sources WHERE id = ? AND claim_id = ?)`
      ).bind(now, source.id, claim, source.id, claim),
      ...sourceRecalculation(env.DB, source.id, now),
      env.DB.prepare(
        `UPDATE github_repositories SET state = 'queued', next_sync_at = ?
         WHERE source_id = ? AND included = 1 AND missing_since IS NULL
         AND size_kb * 1024 <= ? AND (lease_until IS NULL OR lease_until < ?)
         AND (last_synced_at IS NULL OR pushed_at IS NOT last_synced_pushed_at)
         AND state NOT IN ('name_conflict', 'syncing')
         AND (state != 'failed' OR next_sync_at <= ? OR pushed_at IS NOT claimed_pushed_at)`
      ).bind(now, source.id, MAX_MIRROR_BYTES, now, now),
      env.DB.prepare(
        `UPDATE github_sync_sources SET status = 'ok', last_error = NULL,
           last_discovered_at = ?, next_discovery_at = ?, lease_until = NULL, claim_id = NULL
         WHERE id = ? AND claim_id = ?`
      ).bind(now, now + source.interval_minutes * 60000, source.id, claim)
    ]);
  } catch (error) {
    await recordSourceError(env, source, error, claim);
  }
}
