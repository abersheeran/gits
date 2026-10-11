import { Hono } from "hono";
import { vi } from "vitest";
import { errorHandler } from "../../middleware/error-handler";
import type { AppEnv } from "../../types";
import apiRoutes from "./index";

export function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route("/api", apiRoutes);
  return app;
}

export function createBaseEnv(db: D1Database): AppEnv["Bindings"] {
  return {
    DB: db,
    GIT_BUCKET: {} as R2Bucket,
    REPOSITORY_OBJECTS: {
      getByName: vi.fn()
    } as unknown as DurableObjectNamespace,
    ALLOW_USER_REGISTRATION: "true"
  };
}

export function buildRepositoryRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "repo-1",
    owner_id: "owner-1",
    owner_username: "alice",
    name: "demo",
    description: "demo repo",
    is_private: 1,
    created_at: Date.now(),
    ...(overrides ?? {})
  };
}
