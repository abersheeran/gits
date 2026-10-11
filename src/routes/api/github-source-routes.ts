import { githubConfigured, githubWebBase } from "../../services/github/config";
import { discoverSource } from "../../services/github/discovery";
import { sourceView } from "../../services/github/presentation";
import { removeGithubSource } from "../../services/github/removal";
import { dispatchMirrorTasks } from "../../services/github/scheduler";
import { recalculateSource } from "../../services/github/source-store";
import type { SourceRow } from "../../services/github/types";
import { mustSessionUser } from "./deps";
import { ownSource, requireGithubConfiguration, sourceSettings } from "./github-support";
import { parseJsonObject, type ApiRouter } from "./shared";

export function registerGithubSourceRoutes(router: ApiRouter) {
  router.get("/github/sources", async (c) => {
    if (!githubConfigured(c.env)) {
      return c.json({ configured: false, installUrl: null, sources: [] });
    }
    const rows = await c.env.DB.prepare(
      "SELECT * FROM github_installations WHERE user_id = ? ORDER BY created_at, id"
    ).bind(mustSessionUser(c).id).all<SourceRow>();
    const sources = await Promise.all(rows.results.map(async (row) =>
      (await sourceView(c.env.DB, row)).summary));
    const installUrl = `${githubWebBase(c.env)}/apps/${encodeURIComponent(c.env.GITHUB_APP_SLUG!)}`
      + "/installations/new";
    return c.json({ configured: true, installUrl, sources });
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
      `UPDATE github_installations SET name_prefix = ?, include_forks = ?, include_archived = ?,
       visibility_policy = ?, paused = ?, next_discovery_at = ?, updated_at = ? WHERE id = ?`
    ).bind(settings.namePrefix, Number(settings.includeForks), Number(settings.includeArchived),
      settings.visibilityPolicy, Number(settings.paused), Date.now(), Date.now(),
      row.id).run();
    await recalculateSource(c.env, row.id);
    await dispatchMirrorTasks(c.env);
    return c.json({ source: (await sourceView(c.env.DB, await ownSource(c, row.id))).detail });
  });

  router.delete("/github/sources/:sourceId", async (c) => {
    const row = await ownSource(c, c.req.param("sourceId"));
    requireGithubConfiguration(c.env);
    await removeGithubSource(c.env, row.id);
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
