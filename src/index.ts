import { Hono } from "hono";
import apiRoutes from "./routes/api";
import gitRoutes from "./routes/git";
import webRoutes from "./routes/web";
import { errorHandler } from "./middleware/error-handler";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.onError(errorHandler);

app.get("/healthz", (c) => {
  return c.json({ ok: true, timestamp: Date.now() });
});

app.route("/api", apiRoutes);
app.route("/", webRoutes);
app.route("/", gitRoutes);

export default app;
