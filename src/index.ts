import { runScheduler } from "./services/github/scheduler";
import app from "./app";
import type { AppBindings } from "./types";

export { RepositoryObject } from "./services/repository-object";

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduler(env));
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(Date.now()),
      env.DB.prepare("DELETE FROM github_oauth_states WHERE expires_at <= ?").bind(Date.now())
    ]));
  }
} satisfies ExportedHandler<AppBindings>;
