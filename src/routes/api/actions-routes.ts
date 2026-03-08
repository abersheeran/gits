import { registerActionsRunRoutes } from "./actions-run-routes";
import { registerActionsSessionRoutes } from "./actions-session-routes";
import { registerActionsWorkflowRoutes } from "./actions-workflow-routes";
import type { ApiRouter } from "./shared";

export function registerActionsRoutes(router: ApiRouter): void {
  registerActionsWorkflowRoutes(router);
  registerActionsRunRoutes(router);
  registerActionsSessionRoutes(router);
}
