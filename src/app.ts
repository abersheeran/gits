import { Hono } from "hono";
import apiRoutes from "./routes/api/index";
import gitRoutes from "./routes/git";
import { errorHandler } from "./middleware/error-handler";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.onError(errorHandler);

app.get("/healthz", (c) => {
  return c.json({ ok: true, timestamp: Date.now() });
});

app.route("/api", apiRoutes);
app.route("/", gitRoutes);
app.all("*", async (c) => {
  if (!c.env.ASSETS) {
    return c.notFound();
  }

  const response = await c.env.ASSETS.fetch(c.req.raw);
  if (response.status !== 404) {
    return response;
  }

  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return response;
  }

  const accept = c.req.header("accept") ?? "";
  if (!accept.includes("text/html")) {
    return response;
  }

  // Request the root document instead of /index.html so the assets binding
  // does not canonicalize the response into a redirect back to "/".
  const fallbackUrl = new URL("/", c.req.url);
  return c.env.ASSETS.fetch(new Request(fallbackUrl.toString(), c.req.raw));
});

export default app;
