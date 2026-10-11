import { clearInstallationToken } from "./app-auth";
import type { AppBindings } from "../../types";
import { createRepositoryObjectClient } from "../repository-object-client";
import type { RemoteRow } from "./types";

export async function stopMirror(env: AppBindings, remote: RemoteRow) {
  await env.DB.prepare(
    `UPDATE github_repositories SET selection = 'exclude', included = 0, state = 'excluded',
       repository_id = NULL, visibility_override = NULL,
       lease_until = NULL, claim_id = NULL, last_error = NULL
     WHERE id = ?`
  ).bind(remote.id).run();
  if (remote.repository_id) {
    await createRepositoryObjectClient(env).cancelMirrorSync(remote.repository_id);
  }
}

export async function removeGithubSource(env: AppBindings, id: string) {
  const source = await env.DB.prepare(
    "SELECT installation_id FROM github_installations WHERE id = ?"
  )
    .bind(id).first<{ installation_id: number }>();
  if (!source) {
    return;
  }
  clearInstallationToken(env, source.installation_id);
  await env.DB.prepare(
    `UPDATE github_installations SET paused = 1, lease_until = NULL, claim_id = NULL WHERE id = ?`
  ).bind(id).run();
  const rows = await env.DB.prepare(
    `SELECT repository_id FROM github_repositories
     WHERE source_id = ? AND repository_id IS NOT NULL`
  ).bind(id).all<{ repository_id: string }>();
  await env.DB.prepare(
    `UPDATE github_repositories SET claim_id = NULL, lease_until = NULL, included = 0
     WHERE source_id = ?`
  ).bind(id).run();
  const client = createRepositoryObjectClient(env);
  for (let offset = 0; offset < rows.results.length; offset += 20) {
    await Promise.allSettled(rows.results.slice(offset, offset + 20)
      .map((row) => client.cancelMirrorSync(row.repository_id)));
  }
  await env.DB.prepare("DELETE FROM github_installations WHERE id = ?").bind(id).run();
}
