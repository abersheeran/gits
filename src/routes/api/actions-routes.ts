import { registerActionsCallbackRoutes } from "./actions-callback-routes";
import { registerActionsSessionRoutes } from "./actions-session-routes";
import { registerActionsWorkflowRoutes } from "./actions-workflow-routes";
import type { ApiRouter } from "./shared";

export function registerActionsRoutes(router: ApiRouter): void {
  registerActionsCallbackRoutes(router);
  registerActionsWorkflowRoutes(router);
  registerActionsSessionRoutes(router);
}
