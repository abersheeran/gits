import type { Hono } from "hono";
import type { AppEnv } from "../../types";

export * from "./route-support";
export * from "./validation";

export type ApiRouter = Hono<AppEnv>;
