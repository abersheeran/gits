import { registerGithubSyncRoutes } from "./github-sync-routes";
import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { registerPlatformRoutes } from "./platform-routes";
import { registerRepositoryAdminRoutes } from "./repository-admin-routes";
import { registerRepositoryBrowserRoutes } from "./repository-browser-routes";

const router = new Hono<AppEnv>();

registerPlatformRoutes(router);
registerGithubSyncRoutes(router);
registerRepositoryBrowserRoutes(router);
registerRepositoryAdminRoutes(router);

export default router;
