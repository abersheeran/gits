import type { AppBindings } from "../../types";
import type { MirrorTask } from "./types";

export function retryDelay(attempts: number): number {
  const minutes = [5, 15, 60, 360, 1440];
  return minutes[Math.min(Math.max(attempts - 1, 0), minutes.length - 1)]! * 60000;
}

export async function failTask(
  env: AppBindings, task: MirrorTask, attempts: number, message: string,
  state: "failed" | "name_conflict" = "failed"
) {
  await env.DB.prepare(
    `UPDATE github_repositories SET state = ?, last_error = ?, next_sync_at = ?,
       lease_until = NULL, claim_id = NULL
     WHERE id = ? AND claim_id = ?`
  ).bind(state, message, Date.now() + retryDelay(attempts), task.remoteId, task.claimId).run();
}

export async function completeTask(env: AppBindings, task: MirrorTask) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE github_repositories SET
       state = CASE WHEN pushed_at IS claimed_pushed_at THEN 'synced' ELSE 'queued' END,
       next_sync_at = CASE WHEN pushed_at IS claimed_pushed_at THEN ? ELSE ? END,
       last_synced_pushed_at = claimed_pushed_at, last_synced_at = ?, last_error = NULL,
       attempts = 0, lease_until = NULL, claim_id = NULL
     WHERE id = ? AND claim_id = ? AND repository_id = ? AND lease_until >= ?`
  ).bind(now + 86400000, now, now, task.remoteId, task.claimId, task.repositoryId, now).run();
}
