import { Container } from "@cloudflare/containers";
import { AgentSessionService } from "../services/agent-session-service";
import type {
  ActionContainerInstanceType,
  AgentSessionExecutionSourceType,
  AppBindings
} from "../types";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../services/action-runner-prompt-tokens";
import { AuthService } from "../services/auth-service";
import { appendValidationReportPrompt } from "../services/agent-session-validation-report";

type ExecuteRequest = {
  agentType: "codex" | "claude_code";
  prompt: string;
  repositoryId?: string;
  requestOrigin?: string;
  sessionId?: string;
  attemptId?: string;
  runId?: string;
  attemptNumber?: number;
  containerInstance?: string;
  repositoryUrl?: string;
  ref?: string;
  sha?: string;
  runNumber?: number;
  triggeredByUserId?: string;
  triggeredByUsername?: string;
  triggerSourceType?: AgentSessionExecutionSourceType | null;
  enableIssueReplyToken?: boolean;
  enablePrCreateToken?: boolean;
  allowGitPush?: boolean;
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

type ExecutionContext = {
  repositoryId: string;
  sessionId: string;
  attemptId: string;
  sessionNumber: number;
  attemptNumber: number;
  instanceType: ActionContainerInstanceType;
  containerInstance: string;
  agentType: "codex" | "claude_code";
  prompt: string;
  callbackSecret: string;
  requestOrigin: string;
  triggerSourceType: AgentSessionExecutionSourceType | null;
};

const ISSUE_REPLY_TOKEN_UNAVAILABLE = "[GITS_ISSUE_REPLY_TOKEN_UNAVAILABLE]";
const PR_CREATE_TOKEN_UNAVAILABLE = "[GITS_PR_CREATE_TOKEN_UNAVAILABLE]";

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {})
    }
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
    needsIssueReplyToken: payload.enableIssueReplyToken ?? payload.triggerSourceType === "issue",
    needsPrCreateToken: payload.enablePrCreateToken ?? payload.triggerSourceType === "issue"
  };
}

abstract class BaseActionsContainer extends Container<AppBindings> {
  defaultPort = 8080;
  sleepAfter = "10m";

  private readonly bindings: AppBindings;
  private pendingExecutionAuth: PendingExecutionAuth | null = null;
  private activeExecutionTokens: ActiveExecutionTokens | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private executionCtx: ExecutionContext | null = null;
  private executionCompleted = false;

  constructor(ctx: DurableObjectState<{}>, env: AppBindings) {
    super(ctx, env);
    this.bindings = env;
  }

  protected abstract get actionContainerInstanceType(): ActionContainerInstanceType;

  private buildRuntimePrompt(prompt: string): string {
    let runtimePrompt = prompt;
    const issueReplyToken = this.activeExecutionTokens?.issueReplyToken?.token;
    const prCreateToken = this.activeExecutionTokens?.prCreateToken?.token;
    runtimePrompt = runtimePrompt.replaceAll(
      ISSUE_REPLY_TOKEN_PLACEHOLDER,
      issueReplyToken ?? ISSUE_REPLY_TOKEN_UNAVAILABLE
    );
    runtimePrompt = runtimePrompt.replaceAll(
      ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
      prCreateToken ?? PR_CREATE_TOKEN_UNAVAILABLE
    );
    return appendValidationReportPrompt(runtimePrompt);
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

  override async onStart(): Promise<void> {
    await this.ensureExecutionTokens();
    if (this.executionCtx) {
      const agentSessionService = new AgentSessionService(this.bindings.DB);
      const startedAt = Date.now();
      await agentSessionService.markAttemptRunning({
        repositoryId: this.executionCtx.repositoryId,
        sessionId: this.executionCtx.sessionId,
        attemptId: this.executionCtx.attemptId,
        containerInstance: this.executionCtx.containerInstance,
        startedAt
      });
      await agentSessionService.syncSessionForAttempt({
        repositoryId: this.executionCtx.repositoryId,
        sessionId: this.executionCtx.sessionId,
        sessionStatus: "running",
        activeAttemptId: this.executionCtx.attemptId,
        latestAttemptId: this.executionCtx.attemptId,
        containerInstance: this.executionCtx.containerInstance,
        startedAt,
        updatedAt: startedAt
      });
    }
  }

  override async onStop(): Promise<void> {
    if (this.executionCtx && !this.executionCompleted) {
      try {
        const agentSessionService = new AgentSessionService(this.bindings.DB);
        const completedAt = Date.now();
        await agentSessionService.completeAttempt({
          repositoryId: this.executionCtx.repositoryId,
          sessionId: this.executionCtx.sessionId,
          attemptId: this.executionCtx.attemptId,
          status: "failed",
          failureReason: "container_error",
          failureStage: "runtime",
          completedAt
        });
        await agentSessionService.syncSessionForAttempt({
          repositoryId: this.executionCtx.repositoryId,
          sessionId: this.executionCtx.sessionId,
          sessionStatus: "failed",
          activeAttemptId: null,
          latestAttemptId: this.executionCtx.attemptId,
          failureReason: "container_error",
          failureStage: "runtime",
          completedAt,
          updatedAt: completedAt
        });
      } catch {
        // best-effort finalization
      }
    }
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
    if (this.executionCtx && !this.executionCompleted) {
      try {
        const agentSessionService = new AgentSessionService(this.bindings.DB);
        const completedAt = Date.now();
        await agentSessionService.completeAttempt({
          repositoryId: this.executionCtx.repositoryId,
          sessionId: this.executionCtx.sessionId,
          attemptId: this.executionCtx.attemptId,
          status: "failed",
          failureReason: "container_error",
          failureStage: "runtime",
          completedAt
        });
        await agentSessionService.syncSessionForAttempt({
          repositoryId: this.executionCtx.repositoryId,
          sessionId: this.executionCtx.sessionId,
          sessionStatus: "failed",
          activeAttemptId: null,
          latestAttemptId: this.executionCtx.attemptId,
          failureReason: "container_error",
          failureStage: "runtime",
          completedAt,
          updatedAt: completedAt
        });
      } catch {
        // best-effort finalization
      }
    }
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
      if (!isNonEmptyString(payload.repositoryId)) {
        return jsonResponse({ message: "Field 'repositoryId' is required" }, 400);
      }
      if (!isNonEmptyString(payload.sessionId)) {
        return jsonResponse({ message: "Field 'sessionId' is required" }, 400);
      }
      if (!isNonEmptyString(payload.attemptId)) {
        return jsonResponse({ message: "Field 'attemptId' is required" }, 400);
      }
      if (!isPositiveInteger(payload.runNumber)) {
        return jsonResponse({ message: "Field 'runNumber' must be a positive integer" }, 400);
      }
      if (!isPositiveInteger(payload.attemptNumber)) {
        return jsonResponse({ message: "Field 'attemptNumber' must be a positive integer" }, 400);
      }
      if (!isNonEmptyString(payload.containerInstance)) {
        return jsonResponse({ message: "Field 'containerInstance' is required" }, 400);
      }

      const requestOrigin =
        payload.requestOrigin?.trim() ||
        payload.env?.GITS_PLATFORM_API_BASE?.trim() ||
        null;
      if (!requestOrigin) {
        return jsonResponse({ message: "Field 'requestOrigin' is required" }, 400);
      }

      try {
        this.pendingExecutionAuth = buildPendingExecutionAuth(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid execution auth payload";
        return jsonResponse({ message }, 400);
      }

      const callbackSecret = crypto.randomUUID();
      this.executionCompleted = false;
      this.executionCtx = {
        repositoryId: payload.repositoryId,
        sessionId: payload.sessionId,
        attemptId: payload.attemptId,
        sessionNumber: payload.runNumber,
        attemptNumber: payload.attemptNumber,
        instanceType: this.actionContainerInstanceType,
        containerInstance: payload.containerInstance,
        agentType: payload.agentType,
        prompt: payload.prompt,
        callbackSecret,
        requestOrigin,
        triggerSourceType: payload.triggerSourceType ?? null
      };

      this.envVars = {
        ...(payload.env ?? {})
      };

      await this.startAndWaitForPorts(this.defaultPort, { portReadyTimeoutMS: 30_000 });

      this.ctx.waitUntil(
        this.containerFetch("http://localhost/run", {
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
            allowGitPush: payload.allowGitPush,
            gitCommitName: payload.gitCommitName,
            gitCommitEmail: payload.gitCommitEmail,
            env: this.buildRuntimeEnv(payload.env),
            configFiles: payload.configFiles,
            callbackUrl: `${requestOrigin}/api/internal/container-callback`,
            callbackSecret,
            callbackMeta: {
              repositoryId: payload.repositoryId,
              sessionId: payload.sessionId,
              attemptId: payload.attemptId,
              instanceType: this.actionContainerInstanceType,
              containerInstance: payload.containerInstance,
              sessionNumber: payload.runNumber,
              attemptNumber: payload.attemptNumber
            }
          })
        })
      );

      const startedAt = Date.now();
      return jsonResponse(
        { started: true, startedAt },
        200,
        { "x-gits-run-started-at": String(startedAt) }
      );
    }

    if (request.method === "POST" && url.pathname === "/verify-callback-secret") {
      let body: { callbackSecret?: string };
      try {
        body = (await request.json()) as { callbackSecret?: string };
      } catch {
        return jsonResponse({ message: "Invalid JSON payload" }, 400);
      }

      if (!this.executionCtx || body.callbackSecret !== this.executionCtx.callbackSecret) {
        return jsonResponse({ valid: false }, 403);
      }
      return jsonResponse({ valid: true });
    }

    if (request.method === "POST" && url.pathname === "/callback") {
      let body: { callbackSecret?: string; type?: string };
      try {
        body = (await request.json()) as { callbackSecret?: string; type?: string };
      } catch {
        return jsonResponse({ message: "Invalid JSON payload" }, 400);
      }

      if (!this.executionCtx || body.callbackSecret !== this.executionCtx.callbackSecret) {
        return jsonResponse({ message: "Invalid callback" }, 403);
      }
      if (body.type === "heartbeat") {
        this.renewActivityTimeout();
        return jsonResponse({ ok: true });
      }
      if (body.type === "completion") {
        this.executionCompleted = true;
        this.renewActivityTimeout();
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ message: "Unknown callback type" }, 400);
    }

    if (request.method === "POST" && url.pathname === "/keepalive") {
      this.renewActivityTimeout();
      return jsonResponse({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/stop") {
      await this.stop();
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ message: "Not found" }, 404);
  }
}

export class ActionsContainer extends BaseActionsContainer {
  protected override get actionContainerInstanceType(): ActionContainerInstanceType {
    return "lite";
  }
}

export class ActionsContainerBasic extends BaseActionsContainer {
  protected override get actionContainerInstanceType(): ActionContainerInstanceType {
    return "basic";
  }
}

export class ActionsContainerStandard1 extends BaseActionsContainer {
  protected override get actionContainerInstanceType(): ActionContainerInstanceType {
    return "standard-1";
  }
}

export class ActionsContainerStandard2 extends BaseActionsContainer {
  protected override get actionContainerInstanceType(): ActionContainerInstanceType {
    return "standard-2";
  }
}

export class ActionsContainerStandard3 extends BaseActionsContainer {
  protected override get actionContainerInstanceType(): ActionContainerInstanceType {
    return "standard-3";
  }
}

export class ActionsContainerStandard4 extends BaseActionsContainer {
  protected override get actionContainerInstanceType(): ActionContainerInstanceType {
    return "standard-4";
  }
}
