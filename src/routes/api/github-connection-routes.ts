import { GithubClient } from "../../services/github/github-client";
import { connectionView } from "../../services/github/presentation";
import { removeGithubResource } from "../../services/github/removal";
import { connectionClient } from "../../services/github/source-store";
import { encryptToken } from "../../services/github/token-crypto";
import type { ConnectionRow } from "../../services/github/types";
import { HTTPException, mustSessionUser } from "./deps";
import { githubRequest, ownConnection, requireGithubConfiguration } from "./github-support";
import { assertString, parseJsonObject, type ApiRouter } from "./shared";

export function registerGithubConnectionRoutes(router: ApiRouter) {
  router.get("/github/connections", async (c) => {
    if (!c.env.GITHUB_TOKEN_ENCRYPTION_KEY) {
      return c.json({ configured: false, connections: [] });
    }
    const rows = await c.env.DB.prepare(
      "SELECT * FROM github_connections WHERE user_id = ? ORDER BY created_at, id"
    ).bind(mustSessionUser(c).id).all<ConnectionRow>();
    const connections = await Promise.all(rows.results.map((row) => connectionView(c.env.DB, row)));
    return c.json({ configured: true, connections });
  });

  router.post("/github/connections", async (c) => {
    const secret = requireGithubConfiguration(c.env);
    const payload = await parseJsonObject(c.req.raw);
    const token = assertString(payload.token, "token");
    const client = new GithubClient(token, c.env.githubHttp);
    const validated = await githubRequest(c.env, () => client.validateToken());
    const id = crypto.randomUUID();
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO github_connections (id, user_id, github_user_id, github_login, avatar_url,
       token_kind, token_ciphertext, scopes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, mustSessionUser(c).id, validated.user.id, validated.user.login,
      validated.user.avatar_url, validated.tokenKind, await encryptToken(token, secret),
      JSON.stringify(validated.scopes), now, now).run();
    return c.json({ connection: await connectionView(c.env.DB, await ownConnection(c, id)) }, 201);
  });

  router.patch("/github/connections/:connectionId", async (c) => {
    const row = await ownConnection(c, c.req.param("connectionId"));
    const secret = requireGithubConfiguration(c.env);
    const token = assertString((await parseJsonObject(c.req.raw)).token, "token");
    const client = new GithubClient(token, c.env.githubHttp);
    const validated = await githubRequest(c.env, () => client.validateToken());
    if (validated.user.id !== row.github_user_id) {
      throw new HTTPException(409, { message: "The token belongs to a different GitHub account" });
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE github_connections SET github_login = ?, avatar_url = ?, token_kind = ?,
         token_ciphertext = ?, scopes = ?, status = 'active', last_error = NULL, updated_at = ?
         WHERE id = ?`
      ).bind(validated.user.login, validated.user.avatar_url, validated.tokenKind,
        await encryptToken(token, secret), JSON.stringify(validated.scopes), Date.now(), row.id),
      c.env.DB.prepare(
        `UPDATE github_sync_sources SET next_discovery_at = ?, status = 'ok', last_error = NULL
         WHERE connection_id = ?`
      ).bind(Date.now(), row.id)
    ]);
    return c.json({ connection: await connectionView(c.env.DB, await ownConnection(c, row.id)) });
  });

  router.delete("/github/connections/:connectionId", async (c) => {
    const row = await ownConnection(c, c.req.param("connectionId"));
    requireGithubConfiguration(c.env);
    await removeGithubResource(c.env, "connection", row.id);
    return c.json({ ok: true });
  });

  router.get("/github/connections/:connectionId/owners", async (c) => {
    const row = await ownConnection(c, c.req.param("connectionId"));
    requireGithubConfiguration(c.env);
    const owners = await githubRequest(c.env, async () => {
      const client = await connectionClient(c.env, row);
      const { user } = await client.user();
      const organizations = await client.organizations();
      const sources = await c.env.DB.prepare(
        "SELECT id, owner_github_id FROM github_sync_sources WHERE connection_id = ?"
      ).bind(row.id).all<{ id: string; owner_github_id: number }>();
      const ids = new Map(sources.results.map((source) => [source.owner_github_id, source.id]));
      return [user, ...organizations].map((owner, index) => ({
        login: owner.login,
        type: index === 0 ? "user" : "organization",
        githubId: owner.id,
        avatarUrl: owner.avatar_url,
        sourceId: ids.get(owner.id) ?? null
      }));
    }, row);
    return c.json({ owners });
  });
}
