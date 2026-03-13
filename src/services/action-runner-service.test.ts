import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionAttemptRecord, AgentSessionRecord } from "../types";
import { executeActionRun } from "./action-runner-service";
import { AgentSessionService } from "./agent-session-service";
import { ActionsService } from "./actions-service";
import { ACTIONS_SYSTEM_EMAIL, ACTIONS_SYSTEM_USERNAME } from "./auth-service";

function createStartedRunnerResponse(startedAt = 2): Response {
  return new Response(JSON.stringify({ started: true, startedAt }), {
    headers: {
      "content-type": "application/json",
      "x-gits-run-started-at": String(startedAt)
    }
  });
}

function buildSession(overrides?: Partial<AgentSessionRecord>): AgentSessionRecord {
  return {
    id: "session-1",
    repository_id: "repo-1",
    session_number: 1,
    source_type: "manual",
    source_number: null,
    source_comment_id: null,
    origin: "manual",
    status: "queued",
    agent_type: "codex",
    instance_type: "lite",
    prompt: "请执行测试并修复失败。",
    branch_ref: "refs/heads/agent/session-1",
    trigger_ref: "refs/heads/main",
    trigger_sha: "abc123",
    workflow_id: null,
    workflow_name: null,
    parent_session_id: null,
    created_by: null,
    created_by_username: null,
    delegated_from_user_id: null,
    delegated_from_username: null,
    active_attempt_id: "attempt-1",
    latest_attempt_id: "attempt-1",
    exit_code: null,
    container_instance: null,
    failure_reason: null,
    failure_stage: null,
    created_at: 1,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    updated_at: 1,
    ...overrides
  };
}

function buildAttempt(overrides?: Partial<AgentSessionAttemptRecord>): AgentSessionAttemptRecord {
  return {
    id: "attempt-1",
    session_id: "session-1",
    repository_id: "repo-1",
    attempt_number: 1,
    status: "queued",
    instance_type: "lite",
    promoted_from_instance_type: null,
    container_instance: null,
    exit_code: null,
    failure_reason: null,
    failure_stage: null,
    created_at: 1,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    updated_at: 1,
    ...overrides
  };
}

describe("executeActionRun", () => {
  beforeEach(() => {
    vi.spyOn(AgentSessionService.prototype, "claimQueuedAttempt").mockResolvedValue(1);
    vi.spyOn(AgentSessionService.prototype, "findAttemptById").mockResolvedValue(null);
    vi.spyOn(AgentSessionService.prototype, "syncSessionForAttempt").mockResolvedValue();
    vi.spyOn(AgentSessionService.prototype, "recordSessionObservability").mockResolvedValue();
    vi.spyOn(AgentSessionService.prototype, "completeAttempt").mockResolvedValue();
    vi.spyOn(AgentSessionService.prototype, "appendAttemptEvents").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      instanceType: "lite",
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes config files and attempt metadata to the runner container", async () => {
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      instanceType: "lite",
      codexConfigFileContent: 'model = "gpt-5-codex"',
      claudeCodeConfigFileContent: '{\n  "permissions": "bypass"\n}',
      inheritsGlobalCodexConfig: false,
      inheritsGlobalClaudeCodeConfig: false,
      updated_at: 1
    });

    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        sessionId: string;
        attemptId: string;
        containerInstance: string;
        requestOrigin: string;
        configFiles?: Record<string, string>;
      };

      expect(payload.sessionId).toBe("session-1");
      expect(payload.attemptId).toBe("attempt-1");
      expect(payload.containerInstance).toBe("agent-session-session-1-attempt-1");
      expect(payload.requestOrigin).toBe("http://localhost:8787");
      expect(payload.configFiles).toEqual({
        "/home/rootless/.codex/config.toml": 'model = "gpt-5-codex"',
        "/home/rootless/.claude/settings.json": '{\n  "permissions": "bypass"\n}'
      });

      return createStartedRunnerResponse();
    });

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: runnerFetch
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      session: buildSession(),
      attempt: buildAttempt(),
      requestOrigin: "http://localhost:8787"
    });

    expect(runnerFetch).toHaveBeenCalledTimes(1);
    expect(AgentSessionService.prototype.recordSessionObservability).not.toHaveBeenCalled();
    expect(AgentSessionService.prototype.completeAttempt).not.toHaveBeenCalled();
  });

  it("uses the runner binding that matches the attempt instance type", async () => {
    const liteFetch = vi.fn();
    const standard3Fetch = vi.fn(async () => createStartedRunnerResponse());

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: liteFetch
          })
        } as unknown as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_3: {
          getByName: () => ({
            fetch: standard3Fetch
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      session: buildSession({ instance_type: "standard-3" }),
      attempt: buildAttempt({ instance_type: "standard-3" }),
      requestOrigin: "http://localhost:8787"
    });

    expect(liteFetch).not.toHaveBeenCalled();
    expect(standard3Fetch).toHaveBeenCalledTimes(1);
  });

  it("passes issue reply and PR creation hints for issue-sourced sessions", async () => {
    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        triggerSourceType: string | null;
        enableIssueReplyToken: boolean;
        enablePrCreateToken: boolean;
        triggeredByUserId: string;
        triggeredByUsername: string;
        gitCommitName: string;
        gitCommitEmail: string;
      };

      expect(payload.triggerSourceType).toBe("issue");
      expect(payload.enableIssueReplyToken).toBe(true);
      expect(payload.enablePrCreateToken).toBe(true);
      expect(payload.triggeredByUserId).toBe("user-1");
      expect(payload.triggeredByUsername).toBe("alice");
      expect(payload.gitCommitName).toBe(ACTIONS_SYSTEM_USERNAME);
      expect(payload.gitCommitEmail).toBe(ACTIONS_SYSTEM_EMAIL);

      return createStartedRunnerResponse();
    });

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: runnerFetch
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      session: buildSession({
        source_type: "issue",
        source_number: 42,
        prompt: "请回复 issue 并创建 PR。"
      }),
      attempt: buildAttempt(),
      triggeredByUser: {
        id: "user-1",
        username: "alice",
        email: "alice@example.com",
        created_at: 1
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(runnerFetch).toHaveBeenCalledTimes(1);
  });

  it("retries boot-time container internal errors", async () => {
    const queueSend = vi.fn(async () => undefined);
    const createRetryAttempt = vi
      .spyOn(AgentSessionService.prototype, "createRetryAttempt")
      .mockResolvedValue(
        buildAttempt({
          id: "attempt-2",
          attempt_number: 2,
          status: "queued",
          instance_type: "standard-4"
        })
      );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "test-secret",
        ACTIONS_QUEUE: { send: queueSend } as unknown as Queue<unknown>,
        ACTIONS_RUNNER_STANDARD_4: {
          getByName: () => ({
            fetch: () =>
              Promise.reject(new Error("internal error; reference = j6rrapntn26je11iei4v65ka"))
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      session: buildSession({ instance_type: "standard-4" }),
      attempt: buildAttempt({ instance_type: "standard-4" }),
      requestOrigin: "http://localhost:8787"
    });

    expect(createRetryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-1",
        instanceType: "standard-4",
        promotedFromInstanceType: null
      })
    );
    expect(queueSend).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      sessionId: "session-1",
      attemptId: "attempt-2",
      requestOrigin: "http://localhost:8787"
    });
    expect(AgentSessionService.prototype.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        status: "retryable_failed",
        failureReason: "container_error",
        failureStage: "boot"
      })
    );
  });

  it("does not overwrite an externally cancelled attempt on startup failure", async () => {
    vi.spyOn(AgentSessionService.prototype, "findAttemptById").mockResolvedValue(
      buildAttempt({
        id: "attempt-1",
        status: "cancelled",
        completed_at: 3,
        updated_at: 3
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: () => Promise.reject(new Error("container unavailable"))
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      session: buildSession(),
      attempt: buildAttempt(),
      requestOrigin: "http://localhost:8787"
    });

    expect(AgentSessionService.prototype.completeAttempt).not.toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        status: "failed"
      })
    );
    expect(AgentSessionService.prototype.completeAttempt).not.toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        status: "retryable_failed"
      })
    );
  });
});
