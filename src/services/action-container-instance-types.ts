import type { ActionContainerInstanceType, AppBindings } from "../types";

export const ACTION_CONTAINER_INSTANCE_TYPES = [
  "lite",
  "basic",
  "standard-1",
  "standard-2",
  "standard-3",
  "standard-4"
] as const satisfies readonly ActionContainerInstanceType[];

export function getActionRunnerNamespace(
  env: Pick<
    AppBindings,
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
  >,
  instanceType: ActionContainerInstanceType
): DurableObjectNamespace | undefined {
  switch (instanceType) {
    case "lite":
      return env.ACTIONS_RUNNER;
    case "basic":
      return env.ACTIONS_RUNNER_BASIC;
    case "standard-1":
      return env.ACTIONS_RUNNER_STANDARD_1;
    case "standard-2":
      return env.ACTIONS_RUNNER_STANDARD_2;
    case "standard-3":
      return env.ACTIONS_RUNNER_STANDARD_3;
    case "standard-4":
      return env.ACTIONS_RUNNER_STANDARD_4;
  }
}
