import { registerActionsCallbackRoutes } from "./actions-callback-routes";
import { registerActionsSessionRoutes } from "./actions-session-routes";
import { registerActionsWorkflowRoutes } from "./actions-workflow-routes";
import { registerRunnerRoutes } from "./runner-routes";
import type { ApiRouter } from "./shared";

export function registerActionsRoutes(router: ApiRouter): void {
  registerActionsCallbackRoutes(router);
  registerRunnerRoutes(router);
  registerActionsWorkflowRoutes(router);
  registerActionsSessionRoutes(router);
}
