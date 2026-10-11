import type { AppBindings } from "../../types";
import { clearInstallationToken } from "./app-auth";
import { GithubError, safeError } from "./github-client";
import { removeGithubSource } from "./removal";
import { DISCOVERY_INTERVAL_MS, MAX_MIRROR_BYTES, type SourceRow } from "./types";

export async function findSource(env: AppBindings, id: string) {
  return env.DB.prepare("SELECT * FROM github_installations WHERE id = ?")
    .bind(id).first<SourceRow>();
}

export async function suspendSource(env: AppBindings, id: string, message: string | null = null) {
  await env.DB.prepare(
    `UPDATE github_installations SET suspended = 1, status = 'suspended', last_error = ?,
     next_discovery_at = ?, lease_until = NULL, claim_id = NULL, updated_at = ? WHERE id = ?`
  ).bind(message, Date.now() + DISCOVERY_INTERVAL_MS, Date.now(), id).run();
}

export async function deferSource(env: AppBindings, id: string, resetAt: number) {
  await env.DB.prepare(
    `UPDATE github_installations SET rate_limit_until = MAX(COALESCE(rate_limit_until, 0), ?)
     WHERE id = ?`
  ).bind(resetAt, id).run();
}

export async function recordSourceError(
  env: AppBindings, source: SourceRow, error: unknown, claimId: string
) {
  const message = safeError(error);
  if (error instanceof GithubError) {
    if (error.kind === "installation_deleted") {
      await removeGithubSource(env, source.id);
      return;
    }
    if (error.kind === "installation_suspended") {
      await suspendSource(env, source.id, message);
      return;
    }
    if (error.kind === "unauthorized") {
      clearInstallationToken(env, source.installation_id);
    }
    if (error.kind === "rate_limited") {
      await deferSource(env, source.id, error.resetAt!);
    }
  }
  const next = error instanceof GithubError && error.kind === "rate_limited"
    ? error.resetAt! : Date.now() + DISCOVERY_INTERVAL_MS;
  await env.DB.prepare(
    `UPDATE github_installations SET status = 'failed', last_error = ?,
     next_discovery_at = CASE WHEN next_discovery_at = 0 THEN 0 ELSE ? END,
     lease_until = NULL, claim_id = NULL, updated_at = ? WHERE id = ? AND claim_id = ?`
  ).bind(message, next, Date.now(), source.id, claimId).run();
}

export function sourceRecalculation(db: D1Database, sourceId: string, now: number, claimId?: string) {
  const source = claimId === undefined ? "?"
    : "(SELECT id FROM github_installations WHERE id = ? AND claim_id = ?)";
  const sourceArgs = claimId === undefined ? [sourceId] : [sourceId, claimId];
  const included = `CASE
    WHEN selection = 'include' THEN 1 WHEN selection = 'exclude' THEN 0
    ELSE (is_fork = 0 OR s.include_forks = 1)
      AND (is_archived = 0 OR s.include_archived = 1) END`;
  return [
    db.prepare(
      `UPDATE github_repositories SET state = 'queued', next_sync_at = ?
       FROM github_installations s WHERE source_id = s.id AND s.id = ${source}
         AND included = 0 AND (${included}) = 1 AND missing_since IS NULL
         AND github_repositories.state != 'syncing'
         AND size_kb * 1024 <= ?
         AND (github_repositories.lease_until IS NULL OR github_repositories.lease_until < ?)`
    ).bind(now, ...sourceArgs, MAX_MIRROR_BYTES, now),
    db.prepare(
      `UPDATE github_repositories SET included = (${included})
       FROM github_installations s WHERE source_id = s.id AND s.id = ${source}`
    ).bind(...sourceArgs),
    db.prepare(
      `UPDATE github_repositories SET state = 'too_large', lease_until = NULL, claim_id = NULL
       WHERE source_id = ${source} AND size_kb * 1024 > ? AND selection != 'exclude'`
    ).bind(...sourceArgs, MAX_MIRROR_BYTES),
    db.prepare(
      `UPDATE github_repositories SET
         state = CASE
           WHEN selection = 'exclude' THEN 'excluded'
           WHEN size_kb * 1024 > ? THEN 'too_large'
           WHEN missing_since IS NOT NULL THEN 'missing'
           WHEN included = 0 AND repository_id IS NULL THEN 'excluded'
           WHEN included = 1 AND state IN ('excluded', 'too_large', 'missing') THEN 'queued'
           ELSE state END,
         next_sync_at = CASE WHEN included = 1
           AND state IN ('excluded', 'too_large', 'missing') THEN ? ELSE next_sync_at END
       WHERE source_id = ${source} AND (lease_until IS NULL OR lease_until < ?)`
    ).bind(MAX_MIRROR_BYTES, now, ...sourceArgs, now),
    db.prepare(
      `UPDATE repositories SET description = g.description,
         is_private = CASE WHEN s.visibility_policy = 'private' THEN 1 ELSE g.is_private END
       FROM github_repositories g JOIN github_installations s ON s.id = g.source_id
       WHERE repositories.id = g.repository_id AND s.id = ${source}`
    ).bind(...sourceArgs)
  ];
}

export async function recalculateSource(env: AppBindings, id: string) {
  await env.DB.batch(sourceRecalculation(env.DB, id, Date.now()));
}
