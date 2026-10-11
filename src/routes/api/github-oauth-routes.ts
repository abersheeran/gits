import { getCookie } from "hono/cookie";
import { githubConfigured } from "../../services/github/config";
import { discoverSource } from "../../services/github/discovery";
import {
  authorizeGithub, finishGithubOauth, OAUTH_COOKIE, verifyOauthState
} from "../../services/github/oauth";
import { dispatchMirrorTasks } from "../../services/github/scheduler";
import { deleteCookie, optionalSession, setCookie } from "./deps";
import { sessionCookieSecure, type ApiRouter } from "./shared";

export function registerGithubOauthRoutes(router: ApiRouter) {
  router.get("/github/authorize", optionalSession, async (c) => {
    const user = c.get("sessionUser");
    if (!user || !c.get("sessionId")) {
      return c.redirect("/login", 302);
    }
    if (!githubConfigured(c.env)) {
      return c.redirect("/sync?error=not_configured", 302);
    }
    const result = await authorizeGithub(c.env, new URL(c.req.url).origin, user.id, c.get("sessionId")!);
    setCookie(c, OAUTH_COOKIE, result.cookie, {
      path: "/api/github", httpOnly: true, sameSite: "Lax",
      secure: sessionCookieSecure(c.req.url), maxAge: 600
    });
    return c.redirect(result.url, 302);
  });

  router.get("/github/setup", optionalSession, (c) => {
    if (c.req.query("setup_action") === "request") {
      return c.redirect("/sync?error=pending_approval", 302);
    }
    return c.redirect(c.get("sessionUser") ? "/api/github/authorize" : "/login", 302);
  });

  router.get("/github/oauth/callback", optionalSession, async (c) => {
    const cookie = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: "/api/github" });
    if (c.req.query("error") === "access_denied") {
      return c.redirect("/sync?error=denied", 302);
    }
    if (!githubConfigured(c.env)) {
      return c.redirect("/sync?error=not_configured", 302);
    }
    const user = c.get("sessionUser");
    const verifier = await verifyOauthState(c.env, cookie, c.req.query("state"), user?.id, c.get("sessionId"));
    if (!verifier || !user) {
      return c.redirect("/sync?error=state", 302);
    }
    try {
      const code = c.req.query("code");
      if (!code || c.req.query("error")) {
        throw new Error();
      }
      const result = await finishGithubOauth(
        c.env, new URL(c.req.url).origin, user.id, code, verifier
      );
      c.executionCtx.waitUntil((async () => {
        for (const id of result.newSources) {
          await discoverSource(c.env, id);
        }
        if (result.newSources.length) {
          await dispatchMirrorTasks(c.env);
        }
      })().catch(() => {
        console.error("GitHub installation discovery failed after binding");
      }));
      const params = new URLSearchParams({ bound: String(result.bound) });
      for (const skipped of result.skipped) {
        params.append("skipped", `${skipped.login}:${skipped.reason}`);
      }
      return c.redirect(`/sync?${params}`, 302);
    } catch {
      return c.redirect("/sync?error=github", 302);
    }
  });
}
