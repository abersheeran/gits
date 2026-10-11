import { HTTPException } from "hono/http-exception";
import type { AppBindings } from "../../types";
import { discoverSource } from "./discovery";
import { removeGithubSource } from "./removal";
import { dispatchMirrorTasks } from "./scheduler";
import { suspendSource } from "./source-store";
import type { SourceRow } from "./types";

const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024;

type WebhookPayload = {
  installation?: { id?: number };
  repository?: { id?: number };
  action?: string;
};

export async function verifyWebhook(request: Request, secret: string): Promise<Uint8Array> {
  const signature = request.headers.get("X-Hub-Signature-256");
  if (!signature || !/^sha256=[a-f\d]{64}$/i.test(signature)) {
    throw new HTTPException(401, { message: "Invalid GitHub webhook signature" });
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      length += chunk.value.length;
      if (length > MAX_WEBHOOK_BYTES) {
        throw new HTTPException(413, { message: "GitHub webhook payload exceeds 25 MiB" });
      }
      chunks.push(chunk.value);
    }
  } finally {
    await reader?.cancel();
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const signed = Uint8Array.from(signature.slice(7).match(/../g)!, (hex) => parseInt(hex, 16));
  if (!await crypto.subtle.verify("HMAC", key, signed, bytes)) {
    throw new HTTPException(401, { message: "Invalid GitHub webhook signature" });
  }
  return bytes;
}

export async function processWebhook(env: AppBindings, event: string, payload: WebhookPayload) {
  if (!payload?.installation?.id) {
    return;
  }
  const source = await env.DB.prepare(
    "SELECT * FROM github_installations WHERE installation_id = ?"
  )
    .bind(payload.installation.id).first<SourceRow>();
  if (!source) {
    return;
  }
  if (event === "installation") {
    if (payload.action === "deleted") {
      await removeGithubSource(env, source.id);
      return;
    }
    if (payload.action === "suspend") {
      await suspendSource(env, source.id);
      return;
    }
    if (!["unsuspend", "new_permissions_accepted"].includes(payload.action ?? "")) {
      return;
    }
    await env.DB.prepare(
      "UPDATE github_installations SET suspended = 0, status = 'ok', updated_at = ? WHERE id = ?"
    ).bind(Date.now(), source.id).run();
  } else if (event === "push") {
    const now = Date.now();
    const row = await env.DB.prepare(
      `UPDATE github_repositories SET sync_requested_at = MAX(?, sync_requested_at, COALESCE(claimed_at + 1, 0)),
       state = CASE WHEN included = 1 AND state NOT IN ('too_large', 'name_conflict', 'missing')
         AND (lease_until IS NULL OR lease_until < ?) THEN 'queued' ELSE state END,
       next_sync_at = CASE WHEN lease_until IS NULL OR lease_until < ? THEN ? ELSE next_sync_at END
       WHERE source_id = ? AND github_repo_id = ? RETURNING id`
    ).bind(now, now, now, now, source.id, payload.repository?.id ?? 0).first();
    if (row) {
      await dispatchMirrorTasks(env);
      return;
    }
  } else if (event !== "repository" && event !== "installation_repositories") {
    return;
  }
  await discoverSource(env, source.id);
  await dispatchMirrorTasks(env);
}
