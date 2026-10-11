import type { AppBindings } from "../../types";
import { fetchMirror } from "../git-fetch-client";
import type { ObjectStore } from "../git-store/object-store";
import type { RefStore } from "../git-store/ref-store";
import { GithubError, safeError } from "./github-client";
import { deferSource, suspendSource } from "./source-store";
import { completeTask, failTask } from "./task-state";
import { clearInstallationToken, installationToken } from "./app-auth";
import { MAX_MIRROR_BYTES, type MirrorTask, type RemoteRow } from "./types";

export const MIRROR_TASK_KEY = "mirror-sync-task";

type TaskRow = RemoteRow & {
  owner: string;
  name: string;
  installation_id: number;
};

async function currentTask(env: AppBindings, task: MirrorTask) {
  return env.DB.prepare(
    `SELECT g.*, r.name, u.username AS owner, s.installation_id
     FROM github_repositories g
     JOIN github_installations s ON s.id = g.source_id
     JOIN repositories r ON r.id = g.repository_id JOIN users u ON u.id = r.owner_id
     WHERE g.id = ? AND g.claim_id = ? AND g.repository_id = ? AND g.lease_until >= ?
       AND g.state = 'syncing' AND g.size_kb * 1024 <= ?
       AND s.paused = 0 AND s.suspended = 0`
  ).bind(task.remoteId, task.claimId, task.repositoryId, Date.now(), MAX_MIRROR_BYTES)
    .first<TaskRow>();
}

export async function executeMirrorTask(args: {
  env: AppBindings;
  task: MirrorTask;
  store: ObjectStore;
  refs: RefStore;
  ready: (owner: string, repo: string) => Promise<void>;
}) {
  const { env, task } = args;
  const row = await currentTask(env, task);
  if (!row) {
    return;
  }
  let token = "";
  try {
    await args.ready(row.owner, row.name);
    token = await installationToken(env, row.installation_id);
    await fetchMirror({
      store: args.store,
      refs: args.refs,
      fullName: row.full_name,
      login: "x-access-token",
      token,
      ...(env.githubHttp ? { http: env.githubHttp } : {}),
      beforeUpdate: async () => {
        if (!await currentTask(env, task)) {
          throw new Error("Mirror task was cancelled or its lease expired");
        }
      }
    });
    await completeTask(env, task);
  } catch (error) {
    const message = safeError(error, token);
    await failTask(env, task, row.attempts, message);
    if (error instanceof GithubError) {
      if (error.kind === "rate_limited") {
        await deferSource(env, row.source_id, error.resetAt!);
      }
      if (error.kind === "unauthorized") {
        clearInstallationToken(env, row.installation_id);
      }
      if (error.kind === "installation_suspended") {
        await suspendSource(env, row.source_id, message);
      }
      if (error.kind === "installation_deleted") {
        return row.source_id;
      }
    }
  }
}
