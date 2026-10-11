import { registerSessionRoutes } from "./session-routes";
import { registerGithubSyncRoutes } from "./github-sync-routes";
import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { registerPlatformRoutes } from "./platform-routes";
import { registerRepositoryAdminRoutes } from "./repository-admin-routes";
import { registerRepositoryBrowserRoutes } from "./repository-browser-routes";

const router = new Hono<AppEnv>();

router.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  const origin = c.req.header("origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      ((origin && origin !== new URL(c.req.url).origin) ||
       c.req.header("sec-fetch-site") === "cross-site")) {
    return c.json({ message: "Cross-origin request rejected" }, 403);
  }
  await next();
});
registerPlatformRoutes(router);
registerSessionRoutes(router);
registerGithubSyncRoutes(router);
registerRepositoryBrowserRoutes(router);
registerRepositoryAdminRoutes(router);

export default router;
