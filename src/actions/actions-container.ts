import { Container } from "@cloudflare/containers";
import type { AppBindings, ActionRunSourceType } from "../types";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../services/action-runner-prompt-tokens";
import { AuthService } from "../services/auth-service";
import { createSecretRedactor } from "../utils/secret-redaction";

type ExecuteRequest = {
  agentType: "codex" | "claude_code";
  prompt: string;
  repositoryUrl?: string;
  ref?: string;
  sha?: string;
  runNumber?: number;
  triggeredByUserId?: string;
  triggeredByUsername?: string;
  triggerSourceType?: ActionRunSourceType | null;
  enableIssueReplyToken?: boolean;
  enablePrCreateToken?: boolean;
  gitCommitName?: string;
  gitCommitEmail?: string;
  env?: Record<string, string>;
  configFiles?: Record<string, string>;
};

type PendingExecutionAuth = {
  runNumber: number;
  triggeredByUserId: string;
  triggeredByUsername: string;
  needsIssueReplyToken: boolean;
  needsPrCreateToken: boolean;
};

type IssuedActionToken = {
  ownerUserId: string;
  tokenId: string;
  token: string;
  username?: string;
};

type ActiveExecutionTokens = {
  cloneToken: IssuedActionToken | null;
  issueReplyToken: IssuedActionToken | null;
  prCreateToken: IssuedActionToken | null;
};

type ContainerStopParams = Parameters<Container<AppBindings>["onStop"]>[0];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function buildPendingExecutionAuth(payload: ExecuteRequest): PendingExecutionAuth | null {
  const triggeredByUserId = payload.triggeredByUserId?.trim();
  const triggeredByUsername = payload.triggeredByUsername?.trim();
  if (!triggeredByUserId || !triggeredByUsername) {
    return null;
  }
  if (!isPositiveInteger(payload.runNumber)) {
    throw new Error("Field 'runNumber' must be a positive integer when actions auth is enabled");
  }
  return {
    runNumber: payload.runNumber,
    triggeredByUserId,
    triggeredByUsername,
    needsIssueReplyToken:
      payload.enableIssueReplyToken === true || payload.triggerSourceType === "issue",
    needsPrCreateToken:
      payload.enablePrCreateToken === true || payload.triggerSourceType === "issue"
  };
}

function redactUnknownStrings(value: unknown, redact: (input: string) => string): unknown {
  if (typeof value === "string") {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknownStrings(item, redact));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      redactUnknownStrings(nestedValue, redact)
    ])
  );
}

function cloneHeadersWithoutContentLength(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete("content-length");
  return headers;
}

abstract class BaseActionsContainer extends Container<AppBindings> {
  defaultPort = 8080;
  sleepAfter = "10m";

  private readonly bindings: AppBindings;
  private pendingExecutionAuth: PendingExecutionAuth | null = null;
  private activeExecutionTokens: ActiveExecutionTokens | null = null;
  private cleanupPromise: Promise<void> | null = null;

  constructor(ctx: DurableObjectState<{}>, env: AppBindings) {
    super(ctx, env);
    this.bindings = env;
  }

  private collectIssuedSecrets(): string[] {
    return [
      this.activeExecutionTokens?.cloneToken?.token,
      this.activeExecutionTokens?.issueReplyToken?.token,
      this.activeExecutionTokens?.prCreateToken?.token
    ].filter((token): token is string => Boolean(token));
  }

  private buildRuntimePrompt(prompt: string): string {
    let runtimePrompt = prompt;
    const issueReplyToken = this.activeExecutionTokens?.issueReplyToken?.token;
    const prCreateToken = this.activeExecutionTokens?.prCreateToken?.token;
    if (issueReplyToken) {
      runtimePrompt = runtimePrompt.replaceAll(ISSUE_REPLY_TOKEN_PLACEHOLDER, issueReplyToken);
    }
    if (prCreateToken) {
      runtimePrompt = runtimePrompt.replaceAll(ISSUE_PR_CREATE_TOKEN_PLACEHOLDER, prCreateToken);
    }
    return runtimePrompt;
  }

  private buildRuntimeEnv(env: Record<string, string> | undefined): Record<string, string> {
    return {
      ...(env ?? {}),
      ...(this.activeExecutionTokens?.issueReplyToken?.token
        ? { GITS_ISSUE_REPLY_TOKEN: this.activeExecutionTokens.issueReplyToken.token }
        : {}),
      ...(this.activeExecutionTokens?.prCreateToken?.token
        ? { GITS_PR_CREATE_TOKEN: this.activeExecutionTokens.prCreateToken.token }
        : {})
    };
  }

  private async ensureExecutionTokens(): Promise<void> {
    if (!this.pendingExecutionAuth || this.activeExecutionTokens) {
      return;
    }

    const authService = new AuthService(this.bindings.DB, this.bindings.JWT_SECRET);
    const activeTokens: ActiveExecutionTokens = {
      cloneToken: null,
      issueReplyToken: null,
      prCreateToken: null
    };

    try {
      const cloneToken = await authService.createAccessToken({
        userId: this.pendingExecutionAuth.triggeredByUserId,
        name: `actions-run-${this.pendingExecutionAuth.runNumber}`,
        expiresAt: Date.now() + 15 * 60 * 1000,
        internal: true
      });
      activeTokens.cloneToken = {
        ownerUserId: this.pendingExecutionAuth.triggeredByUserId,
        tokenId: cloneToken.tokenId,
        token: cloneToken.token,
        username: this.pendingExecutionAuth.triggeredByUsername
      };

      if (this.pendingExecutionAuth.needsIssueReplyToken) {
        const issueReplyToken = await authService.createAccessToken({
          userId: this.pendingExecutionAuth.triggeredByUserId,
          name: `actions-issue-reply-${this.pendingExecutionAuth.runNumber}`,
          expiresAt: Date.now() + 20 * 60 * 1000,
          internal: true,
          displayAsActions: true
        });
        activeTokens.issueReplyToken = {
          ownerUserId: this.pendingExecutionAuth.triggeredByUserId,
          tokenId: issueReplyToken.tokenId,
          token: issueReplyToken.token
        };
      }

      if (this.pendingExecutionAuth.needsPrCreateToken) {
        const prCreateToken = await authService.createAccessToken({
          userId: this.pendingExecutionAuth.triggeredByUserId,
          name: `actions-pr-create-${this.pendingExecutionAuth.runNumber}`,
          expiresAt: Date.now() + 20 * 60 * 1000,
          internal: true,
          displayAsActions: true
        });
        activeTokens.prCreateToken = {
          ownerUserId: this.pendingExecutionAuth.triggeredByUserId,
          tokenId: prCreateToken.tokenId,
          token: prCreateToken.token
        };
      }

      this.activeExecutionTokens = activeTokens;
    } catch (error) {
      this.activeExecutionTokens = activeTokens;
      await this.cleanupExecutionTokens();
      throw error;
    }
  }

  private async cleanupExecutionTokens(): Promise<void> {
    if (this.cleanupPromise) {
      await this.cleanupPromise;
      return;
    }

    const cleanup = async (): Promise<void> => {
      const activeTokens = this.activeExecutionTokens;
      this.activeExecutionTokens = null;
      this.pendingExecutionAuth = null;
      if (!activeTokens) {
        return;
      }

      const authService = new AuthService(this.bindings.DB, this.bindings.JWT_SECRET);
      const tokens = [
        activeTokens.cloneToken,
        activeTokens.issueReplyToken,
        activeTokens.prCreateToken
      ].filter((token): token is IssuedActionToken => Boolean(token));

      await Promise.all(
        tokens.map((token) =>
          authService.revokeAccessToken(token.ownerUserId, token.tokenId).catch(() => undefined)
        )
      );
    };

    this.cleanupPromise = cleanup();
    try {
      await this.cleanupPromise;
    } finally {
      this.cleanupPromise = null;
    }
  }

  private async redactRunnerResponse(response: Response): Promise<Response> {
    const secrets = this.collectIssuedSecrets();
    if (secrets.length === 0 || !response.body) {
      return response;
    }

    const redact = createSecretRedactor(secrets);
    const headers = cloneHeadersWithoutContentLength(response.headers);
    const contentType = headers.get("content-type") ?? "";

    if (contentType.includes("application/x-ndjson")) {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";

      const stream = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform: (chunk, controller) => {
            this.renewActivityTimeout();
            buffer += decoder.decode(chunk, { stream: true });
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 1);
              if (line.trim().length > 0) {
                try {
                  const parsed = JSON.parse(line) as unknown;
                  controller.enqueue(
                    encoder.encode(`${JSON.stringify(redactUnknownStrings(parsed, redact))}\n`)
                  );
                } catch {
                  controller.enqueue(encoder.encode(`${redact(line)}\n`));
                }
              } else {
                controller.enqueue(encoder.encode("\n"));
              }
              newlineIndex = buffer.indexOf("\n");
            }
          },
          flush: (controller) => {
            const tail = `${buffer}${decoder.decode()}`;
            if (!tail) {
              return;
            }
            try {
              const parsed = JSON.parse(tail) as unknown;
              controller.enqueue(encoder.encode(JSON.stringify(redactUnknownStrings(parsed, redact))));
            } catch {
              controller.enqueue(encoder.encode(redact(tail)));
            }
          }
        })
      );

      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    const bodyText = await response.text();
    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(bodyText) as unknown;
        return new Response(JSON.stringify(redactUnknownStrings(parsed, redact)), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      } catch {
        return new Response(redact(bodyText), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }
    }

    return new Response(redact(bodyText), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  override async onStart(): Promise<void> {
    await this.ensureExecutionTokens();
  }

  override async onStop(_: ContainerStopParams): Promise<void> {
    await this.cleanupExecutionTokens();
  }

  override async onActivityExpired(): Promise<void> {
    try {
      await this.stop();
    } catch {
      await this.cleanupExecutionTokens();
      await this.destroy();
    }
  }

  override async onError(error: unknown): Promise<never> {
    await this.cleanupExecutionTokens();
    throw error;
  }

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

      try {
        this.pendingExecutionAuth = buildPendingExecutionAuth(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid execution auth payload";
        return jsonResponse({ message }, 400);
      }

      this.envVars = {
        ...(payload.env ?? {})
      };

      await this.startAndWaitForPorts(this.defaultPort, { portReadyTimeoutMS: 30_000 });

      const response = await this.containerFetch("http://localhost/run", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agentType: payload.agentType,
          prompt: this.buildRuntimePrompt(payload.prompt),
          repositoryUrl: payload.repositoryUrl,
          ref: payload.ref,
          sha: payload.sha,
          gitUsername: this.activeExecutionTokens?.cloneToken?.username,
          gitToken: this.activeExecutionTokens?.cloneToken?.token,
          gitCommitName: payload.gitCommitName,
          gitCommitEmail: payload.gitCommitEmail,
          env: this.buildRuntimeEnv(payload.env),
          configFiles: payload.configFiles
        })
      });

      return this.redactRunnerResponse(response);
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
