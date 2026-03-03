import { ActionsContainer } from "./actions/actions-container";
import app from "./app";
import { consumeActionRunQueueBatch } from "./services/action-run-queue-service";
import type { AppBindings } from "./types";

export { ActionsContainer };

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    await consumeActionRunQueueBatch({
      batch,
      env
    });
  }
} satisfies ExportedHandler<AppBindings>;
