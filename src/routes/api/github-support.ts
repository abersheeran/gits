import type { Context } from "hono";
import type { AppBindings, AppEnv } from "../../types";
import { mustSessionUser } from "../../middleware/auth";
import { githubConfigured } from "../../services/github/config";
import type { SourceRow } from "../../services/github/types";
import { HTTPException } from "./deps";
import { assertOptionalBoolean, assertOptionalString } from "./validation";

export function requireGithubConfiguration(env: AppBindings) {
  if (!githubConfigured(env)) {
    throw new HTTPException(503, { message: "GitHub synchronization is not configured" });
  }
}

export async function ownSource(c: Context<AppEnv>, id: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM github_installations WHERE id = ? AND user_id = ?"
  )
    .bind(id, mustSessionUser(c).id).first<SourceRow>();
  if (!row) {
    throw new HTTPException(404, { message: "GitHub sync source not found" });
  }
  return row;
}

export function sourceSettings(payload: Record<string, unknown>, source?: SourceRow) {
  const namePrefix = assertOptionalString(payload.namePrefix, "namePrefix")
    ?? source?.name_prefix ?? "";
  if (namePrefix.length > 100 || !/^[A-Za-z0-9._-]*$/.test(namePrefix)) {
    throw new HTTPException(400, { message: "Invalid repository name prefix" });
  }
  const visibilityPolicy = payload.visibilityPolicy ?? source?.visibility_policy ?? "follow";
  if (visibilityPolicy !== "follow" && visibilityPolicy !== "private") {
    throw new HTTPException(400, { message: "Invalid visibility policy" });
  }
  return {
    namePrefix,
    includeForks: assertOptionalBoolean(payload.includeForks, "includeForks")
      ?? Boolean(source?.include_forks),
    includeArchived: assertOptionalBoolean(payload.includeArchived, "includeArchived")
      ?? Boolean(source?.include_archived ?? 1),
    visibilityPolicy,
    paused: assertOptionalBoolean(payload.paused, "paused") ?? Boolean(source?.paused)
  };
}
