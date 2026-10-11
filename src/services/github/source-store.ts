import type { AppBindings } from "../../types";
import { GithubClient, GithubError, safeError } from "./github-client";
import { decryptToken } from "./token-crypto";
import { MAX_MIRROR_BYTES, type ConnectionRow, type SourceRow } from "./types";

export async function sourceConnection(env: AppBindings, sourceId: string) {
  const source = await env.DB.prepare("SELECT * FROM github_sync_sources WHERE id = ?")
    .bind(sourceId).first<SourceRow>();
  const connection = source ? await env.DB.prepare("SELECT * FROM github_connections WHERE id = ?")
    .bind(source.connection_id).first<ConnectionRow>() : null;
  return { source, connection };
}

export async function connectionClient(env: AppBindings, connection: ConnectionRow) {
  const token = await decryptToken(
    connection.token_ciphertext, env.GITHUB_TOKEN_ENCRYPTION_KEY ?? ""
  );
  return new GithubClient(token, env.githubHttp);
}

export async function invalidateConnection(env: AppBindings, id: string, message: string) {
  await env.DB.prepare(
    `UPDATE github_connections SET status = 'invalid', last_error = ?, updated_at = ?
     WHERE id = ?`
  ).bind(message, Date.now(), id).run();
}

export async function recordSourceError(
  env: AppBindings, source: SourceRow, error: unknown, claimId: string
) {
  const message = safeError(error);
  if (error instanceof GithubError && error.kind === "unauthorized") {
    await invalidateConnection(env, source.connection_id, message);
  }
  const status = error instanceof GithubError && error.kind === "sso_required"
    ? "sso_required" : "failed";
  const next = error instanceof GithubError && error.kind === "rate_limited"
    ? error.resetAt! : Date.now() + source.interval_minutes * 60000;
  await env.DB.prepare(
    `UPDATE github_sync_sources SET status = ?, last_error = ?, next_discovery_at = ?,
     lease_until = NULL, claim_id = NULL WHERE id = ? AND claim_id = ?`
  ).bind(status, message, next, source.id, claimId).run();
}

export function sourceRecalculation(db: D1Database, sourceId: string, now: number) {
  const included = `CASE
    WHEN selection = 'include' THEN 1 WHEN selection = 'exclude' THEN 0
    ELSE (is_fork = 0 OR s.include_forks = 1)
      AND (is_archived = 0 OR s.include_archived = 1) END`;
  return [
    db.prepare(
      `UPDATE github_repositories SET state = 'queued', next_sync_at = ?
       FROM github_sync_sources s WHERE source_id = s.id AND s.id = ?
         AND included = 0 AND (${included}) = 1 AND missing_since IS NULL
         AND github_repositories.state != 'syncing'
         AND size_kb * 1024 <= ?
         AND (github_repositories.lease_until IS NULL OR github_repositories.lease_until < ?)`
    ).bind(now, sourceId, MAX_MIRROR_BYTES, now),
    db.prepare(
      `UPDATE github_repositories SET included = (${included})
       FROM github_sync_sources s WHERE source_id = s.id AND s.id = ?`
    ).bind(sourceId),
    db.prepare(
      `UPDATE github_repositories SET state = 'too_large', lease_until = NULL, claim_id = NULL
       WHERE source_id = ? AND size_kb * 1024 > ? AND selection != 'exclude'`
    ).bind(sourceId, MAX_MIRROR_BYTES),
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
       WHERE source_id = ? AND (lease_until IS NULL OR lease_until < ?)`
    ).bind(MAX_MIRROR_BYTES, now, sourceId, now),
    db.prepare(
      `UPDATE repositories SET description = g.description,
         is_private = CASE WHEN s.visibility_policy = 'private' THEN 1 ELSE g.is_private END
       FROM github_repositories g JOIN github_sync_sources s ON s.id = g.source_id
       WHERE repositories.id = g.repository_id AND s.id = ?`
    ).bind(sourceId)
  ];
}

export async function recalculateSource(env: AppBindings, id: string) {
  await env.DB.batch(sourceRecalculation(env.DB, id, Date.now()));
}
