import { githubConfigured } from "./config";
import { HTTPException } from "hono/http-exception";
import type { AppBindings } from "../../types";
import { createInitializedRepository } from "../repository-creation";
import { createRepositoryObjectClient } from "../repository-object-client";
import { RepositoryService } from "../repository-service";
import { discoverSource } from "./discovery";
import { safeError } from "./github-client";
import { failTask } from "./task-state";
import { LEASE_MS, MAX_MIRROR_BYTES, type RemoteRow, type SourceRow } from "./types";

async function scheduleTask(env: AppBindings, remote: RemoteRow) {
  const task = {
    repositoryId: remote.repository_id ?? "",
    remoteId: remote.id,
    claimId: remote.claim_id!
  };
  try {
    if (!task.repositoryId) {
      const source = await env.DB.prepare("SELECT * FROM github_installations WHERE id = ?")
        .bind(remote.source_id).first<SourceRow>();
      const user = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
        .bind(remote.user_id).first<{ username: string }>();
      if (!source || !user) {
        return;
      }
      const name = remote.local_name ?? source.name_prefix + remote.full_name.split("/").pop()!;
      const created = await createInitializedRepository(env, {
        ownerId: remote.user_id,
        owner: user.username,
        name,
        ...(remote.description !== null ? { description: remote.description } : {}),
        isPrivate: source.visibility_policy === "private" || Boolean(remote.is_private)
      });
      task.repositoryId = created.id;
      const linked = await env.DB.prepare(
        `UPDATE github_repositories SET repository_id = ?
         WHERE id = ? AND claim_id = ? AND repository_id IS NULL AND lease_until >= ?
         RETURNING id`
      ).bind(created.id, remote.id, task.claimId, Date.now()).all();
      if (!linked.results.length) {
        await createRepositoryObjectClient(env).deleteRepository({
          repositoryId: created.id, owner: user.username, repo: name
        });
        await new RepositoryService(env.DB).deleteRepositoryById(created.id);
        return;
      }
    }
    await createRepositoryObjectClient(env).scheduleMirrorSync(task);
  } catch (error) {
    const conflict = error instanceof HTTPException && [400, 409].includes(error.status);
    await failTask(env, task, remote.attempts, safeError(error),
      conflict ? "name_conflict" : "failed");
  }
}

export async function dispatchMirrorTasks(env: AppBindings) {
  if (!githubConfigured(env)) {
    return;
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE github_repositories SET state = 'failed', last_error = 'Sync lease expired',
       next_sync_at = ? + CASE attempts WHEN 1 THEN 300000 WHEN 2 THEN 900000
         WHEN 3 THEN 3600000 WHEN 4 THEN 21600000 ELSE 86400000 END,
       lease_until = NULL, claim_id = NULL
     WHERE state = 'syncing' AND lease_until < ?`
  ).bind(now, now).run();
  const claimed = await env.DB.prepare(
    `UPDATE github_repositories SET state = 'syncing', lease_until = ?,
       claim_id = lower(hex(randomblob(16))), attempts = attempts + 1,
       claimed_pushed_at = pushed_at, claimed_at = MAX(?, sync_requested_at)
     WHERE id IN (
       SELECT g.id FROM github_repositories g
       JOIN github_installations s ON s.id = g.source_id
       WHERE g.included = 1 AND g.next_sync_at <= ?
         AND (g.lease_until IS NULL OR g.lease_until < ?)
         AND g.state IN ('queued', 'synced', 'failed') AND g.size_kb * 1024 <= ?
         AND s.paused = 0 AND s.suspended = 0
         AND (s.rate_limit_until IS NULL OR s.rate_limit_until <= ?)
       ORDER BY g.next_sync_at, g.id
       LIMIT MAX(0, ? - (SELECT COUNT(*) FROM github_repositories WHERE lease_until >= ?))
     ) AND (lease_until IS NULL OR lease_until < ?) RETURNING *`
  ).bind(now + LEASE_MS, now, now, now, MAX_MIRROR_BYTES, now, 4, now, now).all<RemoteRow>();
  await Promise.all(claimed.results.map((remote) => scheduleTask(env, remote)));
}

export async function runScheduler(env: AppBindings) {
  if (!githubConfigured(env)) {
    return;
  }
  const now = Date.now();
  const sources = await env.DB.prepare(
    `UPDATE github_installations SET lease_until = ?, claim_id = lower(hex(randomblob(16))),
       next_discovery_at = ?
     WHERE id IN (SELECT s.id FROM github_installations s
       WHERE s.paused = 0 AND s.next_discovery_at <= ?
         AND (s.rate_limit_until IS NULL OR s.rate_limit_until <= ?)
         AND (s.lease_until IS NULL OR s.lease_until < ?)
       ORDER BY s.next_discovery_at LIMIT 5)
     AND (lease_until IS NULL OR lease_until < ?) RETURNING id, claim_id`
  ).bind(now + LEASE_MS, now + LEASE_MS, now, now, now, now)
    .all<{ id: string; claim_id: string }>();
  for (const source of sources.results) {
    await discoverSource(env, source.id, source.claim_id);
  }
  await dispatchMirrorTasks(env);
}
