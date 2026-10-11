import type { AppBindings } from "../../types";
import { createRepositoryObjectClient } from "../repository-object-client";
import type { RemoteRow } from "./types";

export async function stopMirror(env: AppBindings, remote: RemoteRow) {
  await env.DB.prepare(
    `UPDATE github_repositories SET selection = 'exclude', included = 0, state = 'excluded',
       repository_id = NULL, lease_until = NULL, claim_id = NULL, last_error = NULL
     WHERE id = ?`
  ).bind(remote.id).run();
  if (remote.repository_id) {
    await createRepositoryObjectClient(env).cancelMirrorSync(remote.repository_id);
  }
}

export async function removeGithubResource(
  env: AppBindings, kind: "connection" | "source", id: string
) {
  const predicate = kind === "connection"
    ? "source_id IN (SELECT id FROM github_sync_sources WHERE connection_id = ?)"
    : "source_id = ?";
  const sourcePredicate = kind === "connection" ? "connection_id = ?" : "id = ?";
  await env.DB.prepare(
    `UPDATE github_sync_sources SET paused = 1, lease_until = NULL, claim_id = NULL
     WHERE ${sourcePredicate}`
  ).bind(id).run();
  const rows = await env.DB.prepare(
    `SELECT repository_id FROM github_repositories WHERE ${predicate} AND repository_id IS NOT NULL`
  ).bind(id).all<{ repository_id: string }>();
  await env.DB.prepare(
    `UPDATE github_repositories SET claim_id = NULL, lease_until = NULL, included = 0
     WHERE ${predicate}`
  ).bind(id).run();
  const client = createRepositoryObjectClient(env);
  for (let offset = 0; offset < rows.results.length; offset += 20) {
    await Promise.allSettled(rows.results.slice(offset, offset + 20)
      .map((row) => client.cancelMirrorSync(row.repository_id)));
  }
  const table = kind === "connection" ? "github_connections" : "github_sync_sources";
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
}
