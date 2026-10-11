import { discoverSource } from "../../services/github/discovery";
import { sourceView } from "../../services/github/presentation";
import { removeGithubResource } from "../../services/github/removal";
import { dispatchMirrorTasks } from "../../services/github/scheduler";
import { connectionClient, recalculateSource } from "../../services/github/source-store";
import { HTTPException, mustSessionUser } from "./deps";
import {
  githubRequest, ownConnection, ownSource, requireGithubConfiguration, sourceSettings
} from "./github-support";
import { assertString, isUniqueConstraintError, parseJsonObject, type ApiRouter } from "./shared";

export function registerGithubSourceRoutes(router: ApiRouter) {
  router.post("/github/sources", async (c) => {
    requireGithubConfiguration(c.env);
    const payload = await parseJsonObject(c.req.raw);
    const connection = await ownConnection(c, assertString(payload.connectionId, "connectionId"));
    const login = assertString(payload.ownerLogin, "ownerLogin");
    const type = login.toLowerCase() === connection.github_login.toLowerCase()
      ? "user" : "organization";
    const owner = await githubRequest(c.env, async () => {
      const client = await connectionClient(c.env, connection);
      return type === "user" ? (await client.user()).user : client.organization(login);
    }, connection);
    const settings = sourceSettings({
      ...payload, namePrefix: payload.namePrefix ?? (type === "user" ? "" : `${owner.login}.`)
    });
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await c.env.DB.prepare(
        `INSERT INTO github_sync_sources (id, connection_id, user_id, owner_github_id,
         owner_login, owner_type, avatar_url, name_prefix, include_forks, include_archived,
         visibility_policy, interval_minutes, paused, next_discovery_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, connection.id, mustSessionUser(c).id, owner.id, owner.login, type, owner.avatar_url,
        settings.namePrefix, Number(settings.includeForks), Number(settings.includeArchived),
        settings.visibilityPolicy, settings.intervalMinutes, Number(settings.paused), now, now
      ).run();
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HTTPException(409, { message: "This GitHub owner already has a sync source" });
      }
      throw error;
    }
    await discoverSource(c.env, id);
    await dispatchMirrorTasks(c.env);
    return c.json({ source: (await sourceView(c.env.DB, await ownSource(c, id))).detail }, 201);
  });

  router.get("/github/sources/:sourceId", async (c) => {
    const row = await ownSource(c, c.req.param("sourceId"));
    return c.json({ source: (await sourceView(c.env.DB, row)).detail });
  });

  router.patch("/github/sources/:sourceId", async (c) => {
    const row = await ownSource(c, c.req.param("sourceId"));
    requireGithubConfiguration(c.env);
    const settings = sourceSettings(await parseJsonObject(c.req.raw), row);
    await c.env.DB.prepare(
      `UPDATE github_sync_sources SET name_prefix = ?, include_forks = ?, include_archived = ?,
       visibility_policy = ?, interval_minutes = ?, paused = ?, next_discovery_at = ? WHERE id = ?`
    ).bind(settings.namePrefix, Number(settings.includeForks), Number(settings.includeArchived),
      settings.visibilityPolicy, settings.intervalMinutes, Number(settings.paused), Date.now(),
      row.id).run();
    await recalculateSource(c.env, row.id);
    await dispatchMirrorTasks(c.env);
    return c.json({ source: (await sourceView(c.env.DB, await ownSource(c, row.id))).detail });
  });

  router.delete("/github/sources/:sourceId", async (c) => {
    const row = await ownSource(c, c.req.param("sourceId"));
    requireGithubConfiguration(c.env);
    await removeGithubResource(c.env, "source", row.id);
    return c.json({ ok: true });
  });

  router.post("/github/sources/:sourceId/sync", async (c) => {
    const row = await ownSource(c, c.req.param("sourceId"));
    requireGithubConfiguration(c.env);
    await discoverSource(c.env, row.id);
    await dispatchMirrorTasks(c.env);
    return c.json({ source: (await sourceView(c.env.DB, await ownSource(c, row.id))).detail });
  });
}
