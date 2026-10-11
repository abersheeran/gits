import { runScheduler } from "./services/github/scheduler";
import app from "./app";
import type { AppBindings } from "./types";

export { RepositoryObject } from "./services/repository-object";

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduler(env));
  }
} satisfies ExportedHandler<AppBindings>;
