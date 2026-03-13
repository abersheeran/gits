import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../services/action-runner-prompt-tokens";
import {
  GITS_VALIDATION_REPORT_BEGIN,
  GITS_VALIDATION_REPORT_END
} from "../services/agent-session-validation-report";
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
  bindings: {
    DB: D1Database;
    GIT_BUCKET: R2Bucket;
    JWT_SECRET: string;
  };
  pendingExecutionAuth: unknown;
  activeExecutionTokens: unknown;
  cleanupPromise: Promise<void> | null;
  startAndWaitForPorts: ReturnType<typeof vi.fn>;
  containerFetch: ReturnType<typeof vi.fn>;
  renewActivityTimeout: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
  envVars: Record<string, string>;
};

function createTestContainer(
  containerFetchImpl: (url: string, init?: RequestInit) => Promise<Response>
): TestActionsContainer {
  const container = Object.create(ActionsContainer.prototype) as TestActionsContainer;
  container.defaultPort = 8080;
  container.sleepAfter = "10m";
  container.bindings = {
    DB: {} as D1Database,
    GIT_BUCKET: {} as R2Bucket,
    JWT_SECRET: "test-secret"
  };
  container.pendingExecutionAuth = null;
  container.activeExecutionTokens = null;
  container.cleanupPromise = null;
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
  return container;
}

describe("ActionsContainer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates and revokes lifecycle-managed tokens around execute requests", async () => {
    const createdTokens = [
      { tokenId: "tok-run", token: "gts_11111111111111111111111111111111" },
      { tokenId: "tok-issue", token: "gts_22222222222222222222222222222222" },
      { tokenId: "tok-pr", token: "gts_33333333333333333333333333333333" }
    ];
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

    const container = createTestContainer(async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        prompt: string;
        gitUsername?: string;
        gitToken?: string;
        gitCommitName?: string;
        gitCommitEmail?: string;
        env?: Record<string, string>;
      };

      expect(payload.gitUsername).toBe("alice");
      expect(payload.gitToken).toBe("gts_11111111111111111111111111111111");
      expect(payload.prompt).toContain("gts_22222222222222222222222222222222");
      expect(payload.prompt).toContain("gts_33333333333333333333333333333333");
      expect(payload.prompt).toContain(GITS_VALIDATION_REPORT_BEGIN);
      expect(payload.prompt).toContain(GITS_VALIDATION_REPORT_END);
      expect(payload.gitCommitName).toBe("actions");
      expect(payload.gitCommitEmail).toBe("actions@system.local");
      expect(payload.env).toMatchObject({
        BASE_ENV: "1",
        GITS_ISSUE_REPLY_TOKEN: "gts_22222222222222222222222222222222",
        GITS_PR_CREATE_TOKEN: "gts_33333333333333333333333333333333"
      });

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              [
                JSON.stringify({
                  type: "stdout",
                  data: `clone=${payload.gitToken} issue=${payload.env?.GITS_ISSUE_REPLY_TOKEN}\n`
                }),
                JSON.stringify({
                  type: "result",
                  exitCode: 0,
                  durationMs: 25,
                  attemptedCommand: `codex exec ${JSON.stringify(payload.prompt)}`
                })
              ].join("\n")
            )
          );
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson"
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
          repositoryId: "repo-1",
          runId: "run-7",
          containerInstance: "action-run-run-7",
          runNumber: 7,
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
    expect(container.startAndWaitForPorts).toHaveBeenCalledWith(8080, {
      portReadyTimeoutMS: 30_000
    });
    const responseText = await executeResponse.text();
    expect(responseText).not.toContain("gts_11111111111111111111111111111111");
    expect(responseText).not.toContain("gts_22222222222222222222222222222222");
    expect(responseText).not.toContain("gts_33333333333333333333333333333333");
    expect(responseText).toContain("[REDACTED]");
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
    expect(revokeAccessToken).toHaveBeenCalledTimes(3);
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-run");
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-issue");
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-pr");
  });

  it("supports explicitly disabling runtime tokens and push access", async () => {
    const createAccessToken = vi
      .spyOn(AuthService.prototype, "createAccessToken")
      .mockResolvedValue({
        tokenId: "tok-run",
        token: "gts_11111111111111111111111111111111"
      });
    const revokeAccessToken = vi
      .spyOn(AuthService.prototype, "revokeAccessToken")
      .mockResolvedValue(true);

    const container = createTestContainer(async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        prompt: string;
        gitToken?: string;
        allowGitPush?: boolean;
        env?: Record<string, string>;
      };

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
          repositoryId: "repo-1",
          runId: "run-8",
          containerInstance: "action-run-run-8",
          runNumber: 8,
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

    const stopResponse = await container.fetch(
      new Request("https://actions-container.internal/stop", {
        method: "POST"
      })
    );
    expect(stopResponse.status).toBe(200);
    expect(revokeAccessToken).toHaveBeenCalledTimes(1);
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-run");
  });

  it("revokes lifecycle-managed tokens when the container surfaces an error", async () => {
    const createdTokens = [
      { tokenId: "tok-run", token: "gts_11111111111111111111111111111111" },
      { tokenId: "tok-issue", token: "gts_22222222222222222222222222222222" },
      { tokenId: "tok-pr", token: "gts_33333333333333333333333333333333" }
    ];
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
    const container = createTestContainer(async () =>
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
          runNumber: 9,
          triggeredByUserId: "user-1",
          triggeredByUsername: "alice",
          enableIssueReplyToken: true,
          enablePrCreateToken: true
        })
      })
    );

    expect(executeResponse.status).toBe(200);
    await expect(container.onError(new Error("runner exploded"))).rejects.toThrow(
      "runner exploded"
    );
    expect(revokeAccessToken).toHaveBeenCalledTimes(3);
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-run");
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-issue");
    expect(revokeAccessToken).toHaveBeenCalledWith("user-1", "tok-pr");
  });
});
