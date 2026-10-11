import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../../types";
import { HTTPException, mustSessionUser, requireSession } from "./deps";
import type { ApiRouter } from "./shared";
import { SessionService } from "../../services/session-service";

// A PAT cannot manage browser sessions or choose which session to keep.
const requireLogin: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireSession(c, async () => {
    if (!c.get("sessionId")) throw new HTTPException(403, { message: "Login required" });
    await next();
  });
};

export function registerSessionRoutes(router: ApiRouter): void {
  router.get("/auth/sessions", requireLogin, async (c) => {
    const page = Number(c.req.query("page") ?? "1");
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
      throw new HTTPException(400, { message: "Invalid page" });
    }
    return c.json(await new SessionService(c.env.DB)
      .list(mustSessionUser(c).id, c.get("sessionId")!, page));
  });
  router.delete("/auth/sessions", requireLogin, async (c) => {
    await new SessionService(c.env.DB).revokeOthers(mustSessionUser(c).id, c.get("sessionId")!);
    return c.json({ ok: true });
  });
  router.delete("/auth/sessions/:sessionId", requireLogin, async (c) => {
    if (c.req.param("sessionId") === c.get("sessionId")) {
      throw new HTTPException(400, { message: "Use logout for the current session" });
    }
    const revoked = await new SessionService(c.env.DB)
      .revoke(mustSessionUser(c).id, c.req.param("sessionId"));
    if (!revoked) throw new HTTPException(404, { message: "Session not found" });
    return c.json({ ok: true });
  });
}
