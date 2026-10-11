import { requireSession } from "./deps";
import { registerGithubOauthRoutes } from "./github-oauth-routes";
import { registerGithubWebhookRoutes } from "./github-webhook-routes";
import { registerGithubRepositoryRoutes } from "./github-repository-routes";
import { registerGithubSourceRoutes } from "./github-source-routes";
import type { ApiRouter } from "./shared";

export function registerGithubSyncRoutes(router: ApiRouter) {
  registerGithubOauthRoutes(router);
  registerGithubWebhookRoutes(router);
  router.use("/github/sources", requireSession);
  router.use("/github/sources/*", requireSession);
  registerGithubSourceRoutes(router);
  registerGithubRepositoryRoutes(router);
}
