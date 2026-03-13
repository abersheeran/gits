import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../services/action-runner-prompt-tokens";
import {
  GITS_VALIDATION_REPORT_BEGIN,
  GITS_VALIDATION_REPORT_END
} from "../services/agent-session-validation-report";
import { AgentSessionService } from "../services/agent-session-service";
import { AuthService } from "../services/auth-service";

vi.mock("@cloudflare/containers", () => {
  class MockContainer<Env = unknown> {
    protected ctx: DurableObjectState<{}>;
    protected env: Env;
    defaultPort?: number;
    sleepAfter: string | number = "10m";
    envVars: Record<string, string> = {};

    constructor(ctx: DurableObjectState<{}>, env: Env) {
      this.ctx = ctx;
      this.env = env;
    }

    async startAndWaitForPorts(): Promise<void> {}

    async containerFetch(): Promise<Response> {
      return new Response(null);
    }

    async getState(): Promise<string> {
      return "running";
    }

    async stop(): Promise<void> {}

    async destroy(): Promise<void> {}

    onStart(): void | Promise<void> {}

    onStop(): void | Promise<void> {}

    async onActivityExpired(): Promise<void> {}

    onError(error: unknown): never {
      throw error;
    }

    renewActivityTimeout(): void {}
  }

  return {
    Container: MockContainer
  };
});

import { ActionsContainer } from "./actions-container";

type TestActionsContainer = ActionsContainer & {
  ctx: DurableObjectState<{}> & {
    waitUntil: ReturnType<typeof vi.fn>;
  };
  bindings: {
    DB: D1Database;
    GIT_BUCKET: R2Bucket;
    JWT_SECRET: string;
  };
  pendingExecutionAuth: unknown;
  activeExecutionTokens: unknown;
  cleanupPromise: Promise<void> | null;
  executionCtx: unknown;
  executionCompleted: boolean;
  startAndWaitForPorts: ReturnType<typeof vi.fn>;
  containerFetch: ReturnType<typeof vi.fn>;
  renewActivityTimeout: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
  envVars: Record<string, string>;
};

function createTestContainer(
  containerFetchImpl: (url: string, init?: RequestInit) => Promise<Response>
): { container: TestActionsContainer; flushWaitUntil: () => Promise<void> } {
  const waitUntilPromises: Promise<unknown>[] = [];
  const container = Object.create(ActionsContainer.prototype) as TestActionsContainer;
  container.defaultPort = 8080;
  container.sleepAfter = "10m";
  container.ctx = {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(Promise.resolve(promise).catch(() => undefined));
    })
  } as DurableObjectState<{}> & {
    waitUntil: ReturnType<typeof vi.fn>;
  };
  container.bindings = {
    DB: {} as D1Database,
    GIT_BUCKET: {} as R2Bucket,
    JWT_SECRET: "test-secret"
  };
  container.pendingExecutionAuth = null;
  container.activeExecutionTokens = null;
  container.cleanupPromise = null;
  container.executionCtx = null;
  container.executionCompleted = false;
  container.envVars = {};
  container.renewActivityTimeout = vi.fn();
  container.getState = vi.fn(async () => "running");
  container.containerFetch = vi.fn(containerFetchImpl);
  container.startAndWaitForPorts = vi.fn(async () => {
    await container.onStart();
  });
  container.stop = vi.fn(async () => {
    await container.onStop();
  });
  return {
    container,
    flushWaitUntil: async () => {
      await Promise.all(waitUntilPromises);
    }
  };
}

function mockAgentSessionLifecycle(): {
  markAttemptRunning: ReturnType<typeof vi.spyOn>;
  syncSessionForAttempt: ReturnType<typeof vi.spyOn>;
  completeAttempt: ReturnType<typeof vi.spyOn>;
} {
  return {
    markAttemptRunning: vi
      .spyOn(AgentSessionService.prototype, "markAttemptRunning")
      .mockResolvedValue(Date.now()),
    syncSessionForAttempt: vi
      .spyOn(AgentSessionService.prototype, "syncSessionForAttempt")
      .mockResolvedValue(undefined),
    completeAttempt: vi
      .spyOn(AgentSessionService.prototype, "completeAttempt")
      .mockResolvedValue(true)
  };
}

describe("ActionsContainer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts execution asynchronously and uses lifecycle callbacks to manage running and failed states", async () => {
    const { markAttemptRunning, syncSessionForAttempt, completeAttempt } =
      mockAgentSessionLifecycle();
    const createdTokens = [
      { tokenId: "tok-run", token: "gts_11111111111111111111111111111111" },
      { tokenId: "tok-issue", token: "gts_22222222222222222222222222222222" },
      { tokenId: "tok-pr", token: "gts_33333333333333333333333333333333" }
    ];
    vi.spyOn(crypto, "randomUUID").mockReturnValue("callback-secret-1");
    const createAccessToken = vi
      .spyOn(AuthService.prototype, "createAccessToken")
      .mockImplementation(async () => {
        const next = createdTokens.shift();
        if (!next) {
          throw new Error("unexpected token creation");
        }
        return next;
      });
    const revokeAccessToken = vi
      .spyOn(AuthService.prototype, "revokeAccessToken")
      .mockResolvedValue(true);

    let runPayload: {
      prompt: string;
      gitUsername?: string;
      gitToken?: string;
      gitCommitName?: string;
      gitCommitEmail?: string;
      env?: Record<string, string>;
      callbackUrl: string;
      callbackSecret: string;
      callbackMeta: {
        repositoryId: string;
        sessionId: string;
        attemptId: string;
        instanceType: string;
        containerInstance: string;
        sessionNumber: number;
        attemptNumber: number;
      };
    } | null = null;
    const { container, flushWaitUntil } = createTestContainer(async (_url, init) => {
      runPayload = JSON.parse(String(init?.body)) as {
        prompt: string;
        gitUsername?: string;
        gitToken?: string;
        gitCommitName?: string;
        gitCommitEmail?: string;
        env?: Record<string, string>;
        callbackUrl: string;
        callbackSecret: string;
        callbackMeta: {
          repositoryId: string;
          sessionId: string;
          attemptId: string;
          instanceType: string;
          containerInstance: string;
          sessionNumber: number;
          attemptNumber: number;
        };
      };

      expect(runPayload?.gitUsername).toBe("alice");
      expect(runPayload?.gitToken).toBe("gts_11111111111111111111111111111111");
      expect(runPayload?.prompt).toContain("gts_22222222222222222222222222222222");
      expect(runPayload?.prompt).toContain("gts_33333333333333333333333333333333");
      expect(runPayload?.prompt).toContain(GITS_VALIDATION_REPORT_BEGIN);
      expect(runPayload?.prompt).toContain(GITS_VALIDATION_REPORT_END);
      expect(runPayload?.gitCommitName).toBe("actions");
      expect(runPayload?.gitCommitEmail).toBe("actions@system.local");
      expect(runPayload?.env).toMatchObject({
        BASE_ENV: "1",
        GITS_ISSUE_REPLY_TOKEN: "gts_22222222222222222222222222222222",
        GITS_PR_CREATE_TOKEN: "gts_33333333333333333333333333333333"
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const executeResponse = await container.fetch(
      new Request("https://actions-container.internal/execute", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agentType: "codex",
          prompt: `reply with ${ISSUE_REPLY_TOKEN_PLACEHOLDER} and open pr with ${ISSUE_PR_CREATE_TOKEN_PLACEHOLDER}`,
          requestOrigin: "https://platform.example",
          repositoryId: "repo-1",
          sessionId: "session-1",
          attemptId: "attempt-1",
          runId: "run-7",
          containerInstance: "action-run-run-7",
          runNumber: 7,
          attemptNumber: 1,
          triggeredByUserId: "user-1",
          triggeredByUsername: "alice",
          enableIssueReplyToken: true,
          enablePrCreateToken: true,
          gitCommitName: "actions",
          gitCommitEmail: "actions@system.local",
          env: {
            BASE_ENV: "1"
          }
        })
      })
    );

    expect(executeResponse.status).toBe(200);
    expect(await executeResponse.json()).toMatchObject({
      started: true,
      startedAt: expect.any(Number)
    });
    expect(executeResponse.headers.get("x-gits-run-started-at")).toEqual(expect.any(String));
    expect(container.startAndWaitForPorts).toHaveBeenCalledWith(8080, {
      portReadyTimeoutMS: 30_000
    });
    expect(container.ctx.waitUntil).toHaveBeenCalledTimes(1);
    await flushWaitUntil();
    expect(runPayload).toMatchObject({
      callbackUrl: "https://platform.example/api/internal/container-callback",
      callbackSecret: "callback-secret-1",
      callbackMeta: {
        repositoryId: "repo-1",
        sessionId: "session-1",
        attemptId: "attempt-1",
        instanceType: "lite",
        containerInstance: "action-run-run-7",
        sessionNumber: 7,
        attemptNumber: 1
      }
    });
    expect(markAttemptRunning).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      sessionId: "session-1",
      attemptId: "attempt-1",
      containerInstance: "action-run-run-7",
      startedAt: expect.any(Number)
    });
    expect(syncSessionForAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-1",
        sessionStatus: "running",
        activeAttemptId: "attempt-1",
        latestAttemptId: "attempt-1",
        containerInstance: "action-run-run-7"
      })
    );
    expect(createAccessToken).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: "user-1",
        name: "actions-run-7",
        internal: true
      })
    );
    expect(createAccessToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "user-1",
        name: "actions-issue-reply-7",
        internal: true,
        displayAsActions: true
      })
    );
    expect(createAccessToken).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        userId: "user-1",
        name: "actions-pr-create-7",
        internal: true,
        displayAsActions: true
      })
    );

    const stopResponse = await container.fetch(
      new Request("https://actions-container.internal/stop", {
        method: "POST"
      })
    );
    expect(stopResponse.status).toBe(200);
    expect(completeAttempt).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      sessionId: "session-1",
      attemptId: "attempt-1",
      status: "failed",
      failureReason: "container_error",
      failureStage: "runtime",
      completedAt: expect.any(Number)
    });
    expect(syncSessionForAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-1",
        sessionStatus: "failed",
        activeAttemptId: null,
        latestAttemptId: "attempt-1",
        failureReason: "container_error",
        failureStage: "runtime"
      })
    );
    expect(revokeAccessToken).toHaveBeenCalledTimes(3);
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-run");
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-issue");
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-pr");
  });

  it("accepts callback secret verification, heartbeat and completion callbacks and exposes keepalive", async () => {
    const { completeAttempt } = mockAgentSessionLifecycle();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("callback-secret-2");
    const createAccessToken = vi
      .spyOn(AuthService.prototype, "createAccessToken")
      .mockResolvedValue({
        tokenId: "tok-run",
        token: "gts_11111111111111111111111111111111"
      });
    const revokeAccessToken = vi
      .spyOn(AuthService.prototype, "revokeAccessToken")
      .mockResolvedValue(true);

    let runPayload: {
      callbackSecret: string;
      allowGitPush?: boolean;
      prompt: string;
      gitToken?: string;
      env?: Record<string, string>;
    } | null = null;
    const { container, flushWaitUntil } = createTestContainer(async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        prompt: string;
        gitToken?: string;
        allowGitPush?: boolean;
        env?: Record<string, string>;
        callbackSecret: string;
      };
      runPayload = payload;

      expect(payload.gitToken).toBe("gts_11111111111111111111111111111111");
      expect(payload.allowGitPush).toBe(false);
      expect(payload.prompt).toContain("[GITS_ISSUE_REPLY_TOKEN_UNAVAILABLE]");
      expect(payload.prompt).toContain("[GITS_PR_CREATE_TOKEN_UNAVAILABLE]");
      expect(payload.env?.GITS_ISSUE_REPLY_TOKEN).toBeUndefined();
      expect(payload.env?.GITS_PR_CREATE_TOKEN).toBeUndefined();

      return new Response(JSON.stringify({ exitCode: 0, durationMs: 25 }), {
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const executeResponse = await container.fetch(
      new Request("https://actions-container.internal/execute", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agentType: "codex",
          prompt: `reply with ${ISSUE_REPLY_TOKEN_PLACEHOLDER} and open pr with ${ISSUE_PR_CREATE_TOKEN_PLACEHOLDER}`,
          requestOrigin: "https://platform.example",
          repositoryId: "repo-1",
          sessionId: "session-2",
          attemptId: "attempt-2",
          runId: "run-8",
          containerInstance: "action-run-run-8",
          runNumber: 8,
          attemptNumber: 2,
          triggeredByUserId: "user-1",
          triggeredByUsername: "alice",
          triggerSourceType: "issue",
          enableIssueReplyToken: false,
          enablePrCreateToken: false,
          allowGitPush: false,
          env: {
            BASE_ENV: "1"
          }
        })
      })
    );

    expect(executeResponse.status).toBe(200);
    expect(createAccessToken).toHaveBeenCalledTimes(1);
    await flushWaitUntil();
    expect(runPayload?.callbackSecret).toBe("callback-secret-2");

    const invalidCallbackResponse = await container.fetch(
      new Request("https://actions-container.internal/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          callbackSecret: "wrong-secret",
          type: "heartbeat"
        })
      })
    );
    expect(invalidCallbackResponse.status).toBe(403);

    const invalidVerificationResponse = await container.fetch(
      new Request("https://actions-container.internal/verify-callback-secret", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          callbackSecret: "wrong-secret"
        })
      })
    );
    expect(invalidVerificationResponse.status).toBe(403);
    await expect(invalidVerificationResponse.json()).resolves.toEqual({ valid: false });

    const verificationResponse = await container.fetch(
      new Request("https://actions-container.internal/verify-callback-secret", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          callbackSecret: "callback-secret-2"
        })
      })
    );
    expect(verificationResponse.status).toBe(200);
    await expect(verificationResponse.json()).resolves.toEqual({ valid: true });

    const heartbeatResponse = await container.fetch(
      new Request("https://actions-container.internal/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          callbackSecret: "callback-secret-2",
          type: "heartbeat"
        })
      })
    );
    expect(heartbeatResponse.status).toBe(200);

    const keepaliveResponse = await container.fetch(
      new Request("https://actions-container.internal/keepalive", {
        method: "POST"
      })
    );
    expect(keepaliveResponse.status).toBe(200);

    const completionResponse = await container.fetch(
      new Request("https://actions-container.internal/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          callbackSecret: "callback-secret-2",
          type: "completion"
        })
      })
    );
    expect(completionResponse.status).toBe(200);
    expect(container.renewActivityTimeout).toHaveBeenCalledTimes(3);

    const stopResponse = await container.fetch(
      new Request("https://actions-container.internal/stop", {
        method: "POST"
      })
    );
    expect(stopResponse.status).toBe(200);
    expect(completeAttempt).not.toHaveBeenCalled();
    expect(revokeAccessToken).toHaveBeenCalledTimes(1);
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-run");
  });

  it("marks the attempt failed and revokes lifecycle-managed tokens when the container surfaces an error", async () => {
    const { completeAttempt, syncSessionForAttempt } = mockAgentSessionLifecycle();
    const createdTokens = [
      { tokenId: "tok-run", token: "gts_11111111111111111111111111111111" },
      { tokenId: "tok-issue", token: "gts_22222222222222222222222222222222" },
      { tokenId: "tok-pr", token: "gts_33333333333333333333333333333333" }
    ];
    vi.spyOn(crypto, "randomUUID").mockReturnValue("callback-secret-3");
    vi.spyOn(AuthService.prototype, "createAccessToken").mockImplementation(async () => {
      const next = createdTokens.shift();
      if (!next) {
        throw new Error("unexpected token creation");
      }
      return next;
    });
    const revokeAccessToken = vi
      .spyOn(AuthService.prototype, "revokeAccessToken")
      .mockResolvedValue(true);
    const { container, flushWaitUntil } = createTestContainer(async () =>
      new Response(JSON.stringify({ exitCode: 0, durationMs: 25 }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    const executeResponse = await container.fetch(
      new Request("https://actions-container.internal/execute", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agentType: "codex",
          prompt: "run tests",
          requestOrigin: "https://platform.example",
          repositoryId: "repo-1",
          sessionId: "session-3",
          attemptId: "attempt-3",
          containerInstance: "action-run-run-9",
          runNumber: 9,
          attemptNumber: 3,
          triggeredByUserId: "user-1",
          triggeredByUsername: "alice",
          enableIssueReplyToken: true,
          enablePrCreateToken: true
        })
      })
    );

    expect(executeResponse.status).toBe(200);
    await flushWaitUntil();
    await expect(container.onError(new Error("runner exploded"))).rejects.toThrow(
      "runner exploded"
    );
    expect(completeAttempt).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      sessionId: "session-3",
      attemptId: "attempt-3",
      status: "failed",
      failureReason: "container_error",
      failureStage: "runtime",
      completedAt: expect.any(Number)
    });
    expect(syncSessionForAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-3",
        sessionStatus: "failed",
        activeAttemptId: null,
        latestAttemptId: "attempt-3",
        failureReason: "container_error",
        failureStage: "runtime"
      })
    );
    expect(revokeAccessToken).toHaveBeenCalledTimes(3);
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-run");
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-issue");
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-pr");
  });
});
