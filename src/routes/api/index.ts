import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { registerActionsRoutes } from "./actions-routes";
import { registerIssueRoutes } from "./issue-routes";
import { registerPlatformRoutes } from "./platform-routes";
import { registerPullRequestRoutes } from "./pull-request-routes";
import { registerRepositoryAdminRoutes } from "./repository-admin-routes";
import { registerRepositoryBrowserRoutes } from "./repository-browser-routes";
import { registerRepositoryMetadataRoutes } from "./repository-metadata-routes";

const router = new Hono<AppEnv>();

registerPlatformRoutes(router);
registerRepositoryBrowserRoutes(router);
registerIssueRoutes(router);
registerPullRequestRoutes(router);
registerRepositoryMetadataRoutes(router);
registerActionsRoutes(router);
registerRepositoryAdminRoutes(router);

export default router;
