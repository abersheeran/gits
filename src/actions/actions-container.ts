import { Container } from "@cloudflare/containers";
import type { AppBindings, ActionRunSourceType } from "../types";
import { buildActionRunLifecycleLines } from "../services/action-run-log-format";
import { ActionLogStorageService, buildLogExcerpt } from "../services/action-log-storage-service";
import { ActionsService } from "../services/actions-service";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../services/action-runner-prompt-tokens";
import { AuthService } from "../services/auth-service";
import { appendValidationReportPrompt } from "../services/agent-session-validation-report";
import { createSecretRedactor } from "../utils/secret-redaction";

type ExecuteRequest = {
  agentType: "codex" | "claude_code";
  prompt: string;
  repositoryId?: string;
  runId?: string;
  containerInstance?: string;
  repositoryUrl?: string;
  ref?: string;
  sha?: string;
  runNumber?: number;
  triggeredByUserId?: string;
  triggeredByUsername?: string;
  triggerSourceType?: ActionRunSourceType | null;
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

type PendingRunLifecycle = {
  repositoryId: string;
  runId: string;
  runNumber: number;
  agentType: "codex" | "claude_code";
  prompt: string;
  containerInstance: string;
  startedAt: number | null;
  startRejected: boolean;
};

type ContainerStopParams = Parameters<Container<AppBindings>["onStop"]>[0];

const ISSUE_REPLY_TOKEN_UNAVAILABLE = "[GITS_ISSUE_REPLY_TOKEN_UNAVAILABLE]";
const PR_CREATE_TOKEN_UNAVAILABLE = "[GITS_PR_CREATE_TOKEN_UNAVAILABLE]";
const TERMINAL_ACTION_RUN_STATUSES = new Set(["success", "failed", "cancelled"]);

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

function buildPendingRunLifecycle(payload: ExecuteRequest): PendingRunLifecycle | null {
  const repositoryId = payload.repositoryId?.trim();
  const runId = payload.runId?.trim();
  const containerInstance = payload.containerInstance?.trim();
  if (!repositoryId || !runId || !containerInstance) {
    return null;
  }
  if (!isPositiveInteger(payload.runNumber)) {
    throw new Error("Field 'runNumber' must be a positive integer when lifecycle sync is enabled");
  }
  return {
    repositoryId,
    runId,
    runNumber: payload.runNumber,
    agentType: payload.agentType,
    prompt: payload.prompt,
    containerInstance,
    startedAt: null,
    startRejected: false
  };
}

function readContainerStopExitCode(params: ContainerStopParams): number | null {
  return typeof params?.exitCode === "number" ? params.exitCode : null;
}

function readContainerStopReason(params: ContainerStopParams): string | null {
  return typeof params?.reason === "string" && params.reason.trim()
    ? params.reason.trim()
    : null;
}

function buildLifecycleFailureLogs(input: {
  existingLogs: string;
  containerInstance: string;
  claimedAt?: number | null;
  startedAt?: number | null;
  reconciledAt: number;
  stopReason?: string | null;
  exitCode?: number | null;
  errorMessage?: string | null;
}): string {
  const lines: string[] = [];
  const existingLogs = input.existingLogs.trim();
  if (existingLogs) {
    lines.push(existingLogs);
    lines.push("");
    lines.push(...buildActionRunLifecycleLines({ reconciledAt: input.reconciledAt }));
    lines.push("");
  } else {
    lines.push(
      ...buildActionRunLifecycleLines(
        {
          claimedAt: input.claimedAt,
          startedAt: input.startedAt,
          reconciledAt: input.reconciledAt
        },
        { includeMissing: true }
      )
    );
    lines.push("");
  }
  lines.push("[runner_error]");
  lines.push(`Container ${input.containerInstance} stopped before run completion.`);
  if (input.stopReason) {
    lines.push(`container_stop_reason: ${input.stopReason}`);
  }
  if (input.exitCode !== null && input.exitCode !== undefined) {
    lines.push(`container_exit_code: ${input.exitCode}`);
  }
  if (input.errorMessage?.trim()) {
    lines.push(input.errorMessage.trim());
  }
  lines.push("Run was marked as failed from Cloudflare container lifecycle hooks.");
  return lines.join("\n");
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
  private pendingRunLifecycle: PendingRunLifecycle | null = null;
  private activeExecutionTokens: ActiveExecutionTokens | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private lifecycleFailureSyncPromise: Promise<void> | null = null;

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

  private createActionLogStorageService(): ActionLogStorageService {
    return new ActionLogStorageService(this.bindings.ACTION_LOGS_BUCKET ?? this.bindings.GIT_BUCKET);
  }

  private async syncRunStartedFromLifecycle(): Promise<void> {
    if (
      !this.pendingRunLifecycle ||
      this.pendingRunLifecycle.startedAt !== null ||
      this.pendingRunLifecycle.startRejected
    ) {
      return;
    }

    const actionsService = new ActionsService(this.bindings.DB);
    const startedAt = await actionsService.updateRunToRunning(
      this.pendingRunLifecycle.repositoryId,
      this.pendingRunLifecycle.runId,
      this.pendingRunLifecycle.containerInstance
    );

    if (startedAt === null) {
      this.pendingRunLifecycle.startRejected = true;
      return;
    }

    this.pendingRunLifecycle.startedAt = startedAt;
  }

  private async failRunFromLifecycle(input: {
    stopReason?: string | null;
    exitCode?: number | null;
    errorMessage?: string | null;
  }): Promise<void> {
    if (this.lifecycleFailureSyncPromise) {
      await this.lifecycleFailureSyncPromise;
      return;
    }
    if (!this.pendingRunLifecycle) {
      return;
    }

    const pendingRunLifecycle = this.pendingRunLifecycle;
    const syncPromise = (async () => {
      const actionsService = new ActionsService(this.bindings.DB);
      const run = await actionsService.findRunById(
        pendingRunLifecycle.repositoryId,
        pendingRunLifecycle.runId
      );
      if (!run || TERMINAL_ACTION_RUN_STATUSES.has(run.status)) {
        return;
      }

      const reconciledAt = Date.now();
      const logStorage = this.createActionLogStorageService();
      const persistedLogs = await logStorage
        .readRunLogs(pendingRunLifecycle.repositoryId, pendingRunLifecycle.runId)
        .catch(() => null);
      const logs = buildLifecycleFailureLogs({
        existingLogs: persistedLogs ?? run.logs,
        containerInstance: run.container_instance ?? pendingRunLifecycle.containerInstance,
        claimedAt: run.claimed_at,
        startedAt: run.started_at ?? pendingRunLifecycle.startedAt,
        reconciledAt,
        stopReason: input.stopReason ?? null,
        exitCode: input.exitCode ?? null,
        errorMessage: input.errorMessage ?? null
      });

      try {
        await logStorage.writeRunLogs(pendingRunLifecycle.repositoryId, pendingRunLifecycle.runId, logs);
      } catch {
        // Keep the DB reconciliation result even if external log persistence fails.
      }

      await actionsService.failPendingRunIfStillPending(
        pendingRunLifecycle.repositoryId,
        pendingRunLifecycle.runId,
        {
          logs: buildLogExcerpt(logs),
          exitCode: input.exitCode ?? null,
          completedAt: reconciledAt
        }
      );
    })();

    this.lifecycleFailureSyncPromise = syncPromise;
    try {
      await syncPromise;
    } finally {
      if (this.lifecycleFailureSyncPromise === syncPromise) {
        this.lifecycleFailureSyncPromise = null;
      }
    }
  }

  private clearPendingRunLifecycle(): void {
    this.pendingRunLifecycle = null;
  }

  private withExecutionMetadata(response: Response): Response {
    if (!this.pendingRunLifecycle?.startedAt) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set("x-gits-run-started-at", String(this.pendingRunLifecycle.startedAt));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
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
    await this.syncRunStartedFromLifecycle();
  }

  override async onStop(params: ContainerStopParams): Promise<void> {
    await this.failRunFromLifecycle({
      stopReason: readContainerStopReason(params),
      exitCode: readContainerStopExitCode(params)
    });
    await this.cleanupExecutionTokens();
    this.clearPendingRunLifecycle();
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
    await this.failRunFromLifecycle({
      stopReason: "container_error",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    await this.cleanupExecutionTokens();
    this.clearPendingRunLifecycle();
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
      try {
        this.pendingRunLifecycle = buildPendingRunLifecycle(payload);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid execution lifecycle payload";
        return jsonResponse({ message }, 400);
      }

      this.envVars = {
        ...(payload.env ?? {})
      };

      await this.startAndWaitForPorts(this.defaultPort, { portReadyTimeoutMS: 30_000 });
      if (this.pendingRunLifecycle?.startRejected) {
        return jsonResponse({ message: "Action run is no longer pending" }, 409);
      }

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
          allowGitPush: payload.allowGitPush,
          gitCommitName: payload.gitCommitName,
          gitCommitEmail: payload.gitCommitEmail,
          env: this.buildRuntimeEnv(payload.env),
          configFiles: payload.configFiles
        })
      });

      const redacted = await this.redactRunnerResponse(response);
      return this.withExecutionMetadata(redacted);
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
