import {
  registerPullRequestCommandRoutes
} from "./pull-request-command-routes";
import {
  registerPullRequestQueryRoutes
} from "./pull-request-query-routes";
import {
  registerPullRequestReviewRoutes
} from "./pull-request-review-routes";
import type { ApiRouter } from "./shared";

export function registerPullRequestRoutes(router: ApiRouter): void {
  registerPullRequestQueryRoutes(router);
  registerPullRequestReviewRoutes(router);
  registerPullRequestCommandRoutes(router);
}
