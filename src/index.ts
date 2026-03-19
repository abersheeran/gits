import {
  ActionsContainer,
  ActionsContainerBasic,
  ActionsContainerStandard1,
  ActionsContainerStandard2,
  ActionsContainerStandard3,
  ActionsContainerStandard4
} from "./actions/actions-container";
import app from "./app";
import { consumeActionRunQueueBatch } from "./services/action-run-queue-service";
import { sweepStaleLocalRunnerSessions } from "./services/local-runner-sweep-service";
import { RepositoryObject } from "./services/repository-object";
import type { AppBindings } from "./types";

export {
  ActionsContainer,
  ActionsContainerBasic,
  ActionsContainerStandard1,
  ActionsContainerStandard2,
  ActionsContainerStandard3,
  ActionsContainerStandard4,
  RepositoryObject
};

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    await consumeActionRunQueueBatch({
      batch,
      env
    });
  },
  async scheduled(_event, env, _ctx) {
    await sweepStaleLocalRunnerSessions(env);
  }
} satisfies ExportedHandler<AppBindings>;
