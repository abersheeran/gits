import { Container } from "@cloudflare/containers";

type ExecuteRequest = {
  agentType: "codex" | "claude_code";
  prompt: string;
  repositoryUrl?: string;
  ref?: string;
  sha?: string;
  gitUsername?: string;
  gitToken?: string;
  env?: Record<string, string>;
  configFiles?: Record<string, string>;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

abstract class BaseActionsContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/execute") {
      let payload: ExecuteRequest;
      try {
        payload = (await request.json()) as ExecuteRequest;
      } catch {
        return jsonResponse({ message: "Invalid JSON payload" }, 400);
      }

      if (!payload || typeof payload.prompt !== "string" || !payload.prompt.trim()) {
        return jsonResponse({ message: "Field 'prompt' is required" }, 400);
      }
      if (payload.agentType !== "codex" && payload.agentType !== "claude_code") {
        return jsonResponse({ message: "Field 'agentType' must be one of: codex, claude_code" }, 400);
      }

      const envVars: Record<string, string> = {
        ...(payload.env ?? {})
      };

      this.envVars = envVars;
      await this.startAndWaitForPorts(this.defaultPort, { portReadyTimeoutMS: 30_000 });
      const response = await this.containerFetch("http://localhost/run", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agentType: payload.agentType,
          prompt: payload.prompt,
          repositoryUrl: payload.repositoryUrl,
          ref: payload.ref,
          sha: payload.sha,
          gitUsername: payload.gitUsername,
          gitToken: payload.gitToken,
          env: payload.env,
          configFiles: payload.configFiles
        })
      });

      if (!response.body) {
        return response;
      }

      const stream = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform: (chunk, controller) => {
            this.renewActivityTimeout();
            controller.enqueue(chunk);
          }
        })
      );

      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }

    if (request.method === "GET" && url.pathname === "/state") {
      const state = await this.getState();
      return jsonResponse({ state });
    }

    if (request.method === "POST" && url.pathname === "/stop") {
      await this.stop();
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ message: "Not found" }, 404);
  }
}

export class ActionsContainer extends BaseActionsContainer {}

export class ActionsContainerBasic extends BaseActionsContainer {}

export class ActionsContainerStandard1 extends BaseActionsContainer {}

export class ActionsContainerStandard2 extends BaseActionsContainer {}

export class ActionsContainerStandard3 extends BaseActionsContainer {}

export class ActionsContainerStandard4 extends BaseActionsContainer {}
