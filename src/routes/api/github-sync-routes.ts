import { requireSession } from "./deps";
import { registerGithubConnectionRoutes } from "./github-connection-routes";
import { registerGithubRepositoryRoutes } from "./github-repository-routes";
import { registerGithubSourceRoutes } from "./github-source-routes";
import type { ApiRouter } from "./shared";

export function registerGithubSyncRoutes(router: ApiRouter) {
  router.use("/github/*", requireSession);
  registerGithubConnectionRoutes(router);
  registerGithubSourceRoutes(router);
  registerGithubRepositoryRoutes(router);
}
