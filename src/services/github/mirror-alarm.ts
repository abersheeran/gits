import type { AppBindings } from "../../types";
import { fetchMirror } from "../git-fetch-client";
import type { ObjectStore } from "../git-store/object-store";
import type { RefStore } from "../git-store/ref-store";
import { GithubError, safeError } from "./github-client";
import { invalidateConnection } from "./source-store";
import { completeTask, failTask } from "./task-state";
import { decryptToken } from "./token-crypto";
import { MAX_MIRROR_BYTES, type MirrorTask, type RemoteRow } from "./types";

export const MIRROR_TASK_KEY = "mirror-sync-task";

type TaskRow = RemoteRow & {
  owner: string;
  name: string;
  github_login: string;
  token_ciphertext: string;
  connection_id: string;
};

async function currentTask(env: AppBindings, task: MirrorTask) {
  return env.DB.prepare(
    `SELECT g.*, r.name, u.username AS owner, c.github_login, c.token_ciphertext, c.id connection_id
     FROM github_repositories g
     JOIN github_sync_sources s ON s.id = g.source_id
     JOIN github_connections c ON c.id = s.connection_id
     JOIN repositories r ON r.id = g.repository_id JOIN users u ON u.id = r.owner_id
     WHERE g.id = ? AND g.claim_id = ? AND g.repository_id = ? AND g.lease_until >= ?
       AND g.state = 'syncing' AND g.size_kb * 1024 <= ?`
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
    token = await decryptToken(row.token_ciphertext, env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "");
    await fetchMirror({
      store: args.store,
      refs: args.refs,
      fullName: row.full_name,
      login: row.github_login,
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
    if (error instanceof GithubError && error.kind === "unauthorized") {
      await invalidateConnection(env, row.connection_id, message);
    }
    await failTask(env, task, row.attempts, message);
  }
}
