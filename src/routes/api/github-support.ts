import type { Context } from "hono";
import type { AppBindings, AppEnv } from "../../types";
import { mustSessionUser } from "../../middleware/auth";
import { GithubError, safeError } from "../../services/github/github-client";
import { invalidateConnection } from "../../services/github/source-store";
import type { ConnectionRow, SourceRow } from "../../services/github/types";
import { HTTPException } from "./deps";
import { assertOptionalBoolean, assertOptionalString } from "./validation";

export function requireGithubConfiguration(env: AppBindings) {
  if (!env.GITHUB_TOKEN_ENCRYPTION_KEY) {
    throw new HTTPException(503, { message: "GitHub synchronization is not configured" });
  }
  return env.GITHUB_TOKEN_ENCRYPTION_KEY;
}

export async function ownConnection(c: Context<AppEnv>, id: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM github_connections WHERE id = ? AND user_id = ?"
  )
    .bind(id, mustSessionUser(c).id).first<ConnectionRow>();
  if (!row) {
    throw new HTTPException(404, { message: "GitHub connection not found" });
  }
  return row;
}

export async function ownSource(c: Context<AppEnv>, id: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM github_sync_sources WHERE id = ? AND user_id = ?"
  )
    .bind(id, mustSessionUser(c).id).first<SourceRow>();
  if (!row) {
    throw new HTTPException(404, { message: "GitHub sync source not found" });
  }
  return row;
}

export async function githubRequest<T>(
  env: AppBindings, operation: () => Promise<T>, connection?: ConnectionRow
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (connection && error instanceof GithubError && error.kind === "unauthorized") {
      await invalidateConnection(env, connection.id, safeError(error));
    }
    throw new HTTPException(400, { message: safeError(error) });
  }
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
  const intervalMinutes = payload.intervalMinutes ?? source?.interval_minutes ?? 60;
  if (typeof intervalMinutes !== "number" || ![15, 60, 360, 1440].includes(intervalMinutes)) {
    throw new HTTPException(400, { message: "Invalid discovery interval" });
  }
  return {
    namePrefix,
    includeForks: assertOptionalBoolean(payload.includeForks, "includeForks")
      ?? Boolean(source?.include_forks),
    includeArchived: assertOptionalBoolean(payload.includeArchived, "includeArchived")
      ?? Boolean(source?.include_archived ?? 1),
    visibilityPolicy,
    intervalMinutes,
    paused: assertOptionalBoolean(payload.paused, "paused") ?? Boolean(source?.paused)
  };
}
