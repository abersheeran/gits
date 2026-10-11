import {
  mirrorView, remoteSelect, remoteView, type RemoteViewRow
} from "../../services/github/presentation";
import { stopMirror } from "../../services/github/removal";
import { dispatchMirrorTasks } from "../../services/github/scheduler";
import { recalculateSource } from "../../services/github/source-store";
import type { RemoteRow } from "../../services/github/types";
import { HTTPException, mustSessionUser, RepositoryService, requireSession } from "./deps";
import { ownSource, requireGithubConfiguration } from "./github-support";
import { assertRepositoryName, parseJsonObject, parsePage, type ApiRouter } from "./shared";

export function registerGithubRepositoryRoutes(router: ApiRouter) {
  router.get("/github/sources/:sourceId/repositories", async (c) => {
    const source = await ownSource(c, c.req.param("sourceId"));
    const status = c.req.query("status") ?? "all";
    const filters: Record<string, string> = {
      all: "1", synced: "g.state = 'synced'", excluded: "g.state = 'excluded'",
      attention: "g.state IN ('failed', 'too_large', 'name_conflict', 'missing')"
    };
    if (!Object.hasOwn(filters, status)) {
      throw new HTTPException(400, { message: "Invalid repository status filter" });
    }
    const page = parsePage(c.req.query("page"));
    const where = `g.source_id = ? AND ${filters[status]}`;
    const [rows, count] = await Promise.all([
      c.env.DB.prepare(`${remoteSelect} WHERE ${where} ORDER BY g.full_name LIMIT 50 OFFSET ?`)
        .bind(source.id, (page - 1) * 50).all<RemoteViewRow>(),
      c.env.DB.prepare(`SELECT COUNT(*) total FROM github_repositories g WHERE ${where}`)
        .bind(source.id).first<{ total: number }>()
    ]);
    const total = count?.total ?? 0;
    return c.json({
      items: rows.results.map(remoteView), page, perPage: 50, total, hasNextPage: page * 50 < total
    });
  });

  router.patch("/github/sources/:sourceId/repositories/:githubRepoId", async (c) => {
    const source = await ownSource(c, c.req.param("sourceId"));
    requireGithubConfiguration(c.env);
    const row = await c.env.DB.prepare(
      "SELECT * FROM github_repositories WHERE source_id = ? AND github_repo_id = ?"
    ).bind(source.id, c.req.param("githubRepoId")).first<RemoteRow>();
    if (!row) {
      throw new HTTPException(404, { message: "GitHub repository not found" });
    }
    const payload = await parseJsonObject(c.req.raw);
    const selection = payload.selection ?? row.selection;
    if (typeof selection !== "string" || !["auto", "include", "exclude"].includes(selection)) {
      throw new HTTPException(400, { message: "Invalid repository selection" });
    }
    let localName = row.local_name;
    if (payload.localName !== undefined) {
      if (payload.localName !== null && typeof payload.localName !== "string") {
        throw new HTTPException(400, { message: "Invalid local repository name" });
      }
      localName = payload.localName as string | null;
      if (localName !== null) {
        assertRepositoryName(localName);
      }
    }
    if (selection === "exclude") {
      await stopMirror(c.env, row);
    }
    await c.env.DB.prepare(
      `UPDATE github_repositories SET selection = ?, local_name = ?,
       state = CASE WHEN state = 'name_conflict' AND ? THEN 'queued'
         WHEN ? = 'include' AND state NOT IN ('syncing', 'too_large', 'missing')
         THEN 'queued' ELSE state END,
       next_sync_at = CASE WHEN ? = 'include' OR ? THEN ? ELSE next_sync_at END
       WHERE id = ?`
    ).bind(selection, localName, Number(payload.localName !== undefined), selection,
      selection, Number(payload.localName !== undefined), Date.now(), row.id).run();
    await recalculateSource(c.env, source.id);
    await dispatchMirrorTasks(c.env);
    const updated = await c.env.DB.prepare(`${remoteSelect} WHERE g.id = ?`)
      .bind(row.id).first<RemoteViewRow>();
    return c.json({ repository: remoteView(updated!) });
  });

  router.post("/repos/:owner/:repo/mirror/sync", requireSession, async (c) => {
    const service = new RepositoryService(c.env.DB);
    const repo = await service.findRepository(c.req.param("owner"), c.req.param("repo"));
    if (!repo) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    if (repo.owner_id !== mustSessionUser(c).id) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    requireGithubConfiguration(c.env);
    const remote = await service.findMirror(repo.id);
    if (!remote) {
      throw new HTTPException(404, { message: "Repository is not a mirror" });
    }
    await c.env.DB.prepare(
      `UPDATE github_repositories SET state = 'queued', next_sync_at = ?
       WHERE id = ? AND (lease_until IS NULL OR lease_until < ?)
       AND state NOT IN ('too_large', 'missing')`
    ).bind(Date.now(), remote.id, Date.now()).run();
    await dispatchMirrorTasks(c.env);
    return c.json({ mirror: mirrorView((await service.findMirror(repo.id))!) });
  });

  router.delete("/repos/:owner/:repo/mirror", requireSession, async (c) => {
    const service = new RepositoryService(c.env.DB);
    const repo = await service.findRepository(c.req.param("owner"), c.req.param("repo"));
    if (!repo) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    if (repo.owner_id !== mustSessionUser(c).id) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    requireGithubConfiguration(c.env);
    const remote = await service.findMirror(repo.id);
    if (!remote) {
      throw new HTTPException(404, { message: "Repository is not a mirror" });
    }
    await stopMirror(c.env, remote);
    return c.json({ ok: true });
  });
}
