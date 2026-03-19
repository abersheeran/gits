import { SignJWT, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as callbackService from "../../services/action-container-callback-service";
import { AgentSessionService } from "../../services/agent-session-service";
import { AuthService } from "../../services/auth-service";
import { createMockD1Database } from "../../test-utils/mock-d1";
import { createApp, createBaseEnv } from "./test-helpers";

async function createRunnerCallbackToken(input: { userId: string; sessionId: string; attemptId: string }) {
  return new SignJWT({
    sessionId: input.sessionId,
    attemptId: input.attemptId,
    type: "runner-callback"
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode("test-secret"));
}

describe("API runner routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls the oldest queued local runner session", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });

    const db = createMockD1Database([
      {
        when: "FROM agent_sessions s",
        first: () => ({
          id: "session-1",
          repository_id: "repo-1",
          session_number: 7,
          agent_type: "codex",
          prompt: "请修复失败测试。",
          trigger_ref: "refs/heads/main",
          trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          branch_ref: "refs/heads/agent/session-1",
          source_type: "issue",
          source_number: 42,
          origin: "issue_resume",
          instance_type: "basic",
          attempt_id: "attempt-1",
          attempt_number: 1,
          owner_username: "alice",
          repo_name: "demo"
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/runner/poll?repositoryId=repo-1", {
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: {
        id: string;
        repositoryId: string;
        sessionNumber: number;
        attemptId: string;
        attemptNumber: number;
        sourceType: string;
        sourceNumber: number | null;
      } | null;
    };
    expect(body.session).toEqual({
      id: "session-1",
      repositoryId: "repo-1",
      sessionNumber: 7,
      attemptId: "attempt-1",
      attemptNumber: 1,
      agentType: "codex",
      prompt: "请修复失败测试。",
      triggerRef: "refs/heads/main",
      triggerSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      branchRef: "refs/heads/agent/session-1",
      sourceType: "issue",
      sourceNumber: 42,
      origin: "issue_resume"
    });
  });

  it("claims a queued local runner session and returns runner payload", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(AgentSessionService.prototype, "claimQueuedAttempt").mockResolvedValue(1_700_000_000_000);
    const markAttemptRunning = vi
      .spyOn(AgentSessionService.prototype, "markAttemptRunning")
      .mockResolvedValue(1_700_000_000_000);
    vi.spyOn(AuthService.prototype, "createAccessToken").mockResolvedValue({
      tokenId: "token-1",
      token: "gts_clone_token"
    });

    const db = createMockD1Database([
      {
        when: "FROM agent_sessions s",
        first: () => ({
          id: "session-1",
          repository_id: "repo-1",
          session_number: 7,
          agent_type: "codex",
          prompt: "请修复失败测试。",
          trigger_ref: "refs/heads/main",
          trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          branch_ref: "refs/heads/agent/session-1",
          source_type: "issue",
          source_number: 42,
          origin: "issue_resume",
          instance_type: "basic",
          attempt_id: "attempt-1",
          attempt_number: 2,
          owner_username: "alice",
          repo_name: "demo"
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/runner/claim", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sessionId: "session-1",
          attemptId: "attempt-1"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      claimed: boolean;
      callbackToken: string;
      gitCloneUrl: string;
      gitCloneToken: string;
      env: Record<string, string>;
      instanceType: string;
    };

    expect(body.claimed).toBe(true);
    expect(body.gitCloneUrl).toBe("http://localhost/alice/demo.git");
    expect(body.gitCloneToken).toBe("gts_clone_token");
    expect(body.instanceType).toBe("basic");
    expect(body.env).toMatchObject({
      GITS_ACTION_RUN_ID: "session-1",
      GITS_ACTION_ATTEMPT_ID: "attempt-1",
      GITS_REPOSITORY: "alice/demo",
      GITS_TRIGGER_ISSUE_NUMBER: "42"
    });
    expect("configFiles" in body).toBe(false);
    expect(markAttemptRunning).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      sessionId: "session-1",
      attemptId: "attempt-1",
      containerInstance: "local-runner-user-2",
      startedAt: 1_700_000_000_000
    });

    const verifiedToken = await jwtVerify(
      body.callbackToken,
      new TextEncoder().encode("test-secret"),
      {
        algorithms: ["HS256"]
      }
    );
    expect(typeof body.callbackToken).toBe("string");
    expect(verifiedToken.payload.sub).toBe("user-2");
    expect(verifiedToken.payload.sessionId).toBe("session-1");
    expect(verifiedToken.payload.attemptId).toBe("attempt-1");
  });

  it("accepts heartbeat callbacks for local runners", async () => {
    const callbackToken = await createRunnerCallbackToken({
      userId: "user-2",
      sessionId: "session-1",
      attemptId: "attempt-1"
    });
    const updateRun = vi.fn(() => ({ success: true }));
    const db = createMockD1Database([
      {
        when: "SELECT s.repository_id",
        first: () => ({ repository_id: "repo-1" })
      },
      {
        when: "SELECT status FROM agent_session_attempts",
        first: () => ({ status: "running" })
      },
      {
        when: "UPDATE agent_session_attempts",
        run: updateRun
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/runner/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "heartbeat",
          callbackToken,
          sessionId: "session-1",
          attemptId: "attempt-1",
          repositoryId: "repo-1",
          instanceType: "lite",
          containerInstance: "local-runner-user-2",
          sessionNumber: 1,
          attemptNumber: 1
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect(updateRun).toHaveBeenCalledWith([
      expect.any(Number),
      "repo-1",
      "session-1",
      "attempt-1"
    ]);
  });

  it("forwards completion callbacks into shared completion processing", async () => {
    const callbackToken = await createRunnerCallbackToken({
      userId: "user-2",
      sessionId: "session-1",
      attemptId: "attempt-1"
    });
    const processCompletionCallback = vi
      .spyOn(callbackService, "processCompletionCallback")
      .mockResolvedValue();
    const db = createMockD1Database([
      {
        when: "SELECT s.repository_id",
        first: () => ({ repository_id: "repo-1" })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/runner/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "completion",
          callbackToken,
          sessionId: "session-1",
          attemptId: "attempt-1",
          repositoryId: "repo-1",
          instanceType: "lite",
          containerInstance: "local-runner-user-2",
          sessionNumber: 1,
          attemptNumber: 1,
          exitCode: 0,
          durationMs: 25,
          stdout: "done"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect(processCompletionCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        requestOrigin: "http://localhost",
        secretsToRedact: [callbackToken],
        payload: expect.objectContaining({
          sessionId: "session-1",
          attemptId: "attempt-1",
          callbackSecret: "",
          stdout: "done"
        })
      })
    );
  });
});
