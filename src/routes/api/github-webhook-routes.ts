import { HTTPException } from "hono/http-exception";
import { processWebhook, verifyWebhook } from "../../services/github/webhook";
import { requireGithubConfiguration } from "./github-support";
import type { ApiRouter } from "./shared";

export function registerGithubWebhookRoutes(router: ApiRouter) {
  router.post("/github/webhook", async (c) => {
    requireGithubConfiguration(c.env);
    const bytes = await verifyWebhook(c.req.raw, c.env.GITHUB_APP_WEBHOOK_SECRET!);
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new HTTPException(400, { message: "Invalid GitHub webhook JSON" });
    }
    const event = c.req.header("X-GitHub-Event") ?? "";
    if (event === "ping") {
      return c.json({ ok: true });
    }
    c.executionCtx.waitUntil(processWebhook(c.env, event, payload).catch(() => {
      console.error("GitHub webhook processing failed");
    }));
    return c.json({ ok: true }, 202);
  });
}
