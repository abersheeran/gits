import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionAttemptRecord, AgentSessionRecord, RepositoryRecord } from "../types";
import {
  handleContainerCompletion,
  handleContainerHeartbeat
} from "./action-container-callback-service";
import { AgentSessionService } from "./agent-session-service";
import { WorkflowTaskFlowService } from "./workflow-task-flow-service";

function buildSession(overrides?: Partial<AgentSessionRecord>): AgentSessionRecord {
  return {
    id: "session-1",
    repository_id: "repo-1",
    session_number: 1,
    source_type: "manual",
    source_number: null,
    source_comment_id: null,
    origin: "manual",
    status: "running",
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
    container_instance: "agent-session-session-1-attempt-1",
    failure_reason: null,
    failure_stage: null,
    created_at: 1,
    claimed_at: 2,
    started_at: 3,
    completed_at: null,
    updated_at: 3,
    ...overrides
  };
}

function buildAttempt(overrides?: Partial<AgentSessionAttemptRecord>): AgentSessionAttemptRecord {
  return {
    id: "attempt-1",
    session_id: "session-1",
    repository_id: "repo-1",
    attempt_number: 1,
    status: "running",
    instance_type: "lite",
    promoted_from_instance_type: null,
    container_instance: "agent-session-session-1-attempt-1",
    exit_code: null,
    failure_reason: null,
    failure_stage: null,
    created_at: 1,
    claimed_at: 2,
    started_at: 3,
    completed_at: null,
    updated_at: 3,
    ...overrides
  };
}

function buildRepository(overrides?: Partial<RepositoryRecord>): RepositoryRecord {
  return {
    id: "repo-1",
    owner_id: "owner-1",
    owner_username: "alice",
    name: "demo",
    description: "demo repo",
    is_private: 1,
    created_at: 1,
    ...overrides
  };
}

function createRepositoryLookupDb(repository = buildRepository()): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => repository)
      }))
    }))
  } as unknown as D1Database;
}

function createRunnerNamespace(
  fetch: (url: string, init?: RequestInit) => Promise<Response>
): DurableObjectNamespace {
  return {
    getByName: () => ({
      fetch
    })
  } as unknown as DurableObjectNamespace;
}

describe("action-container-callback-service", () => {
  beforeEach(() => {
    vi.spyOn(AgentSessionService.prototype, "appendAttemptEvents").mockResolvedValue();
    vi.spyOn(AgentSessionService.prototype, "recordSessionObservability").mockResolvedValue();
    vi.spyOn(AgentSessionService.prototype, "completeAttempt").mockResolvedValue();
    vi.spyOn(AgentSessionService.prototype, "syncSessionForAttempt").mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends heartbeat log chunks and renews container keepalive", async () => {
    const runnerFetch = vi.fn(async (url: string) => {
      if (url === "https://actions-container.internal/verify-callback-secret") {
        return new Response(JSON.stringify({ valid: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (url === "https://actions-container.internal/keepalive") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected runner fetch: ${url}`);
    });

    await handleContainerHeartbeat({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        ACTIONS_RUNNER: createRunnerNamespace(runnerFetch)
      },
      payload: {
        type: "heartbeat",
        callbackSecret: "secret-1",
        repositoryId: "repo-1",
        sessionId: "session-1",
        attemptId: "attempt-1",
        instanceType: "lite",
        containerInstance: "agent-session-session-1-attempt-1",
        sessionNumber: 1,
        attemptNumber: 1,
        stdout: "Analyzing repository",
        stderr: "Tests still failing"
      }
    });

    expect(AgentSessionService.prototype.appendAttemptEvents).toHaveBeenCalledWith(
      "repo-1",
      "session-1",
      "attempt-1",
      expect.arrayContaining([
        expect.objectContaining({
          type: "stdout_chunk",
          stream: "stdout",
          message: "Analyzing repository"
        }),
        expect.objectContaining({
          type: "stderr_chunk",
          stream: "stderr",
          message: "Tests still failing"
        })
      ])
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      1,
      "https://actions-container.internal/verify-callback-secret",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      2,
      "https://actions-container.internal/keepalive",
      {
        method: "POST"
      }
    );
  });

  it("ignores heartbeat callbacks when callback secret verification fails", async () => {
    const appendAttemptEvents = vi
      .spyOn(AgentSessionService.prototype, "appendAttemptEvents")
      .mockResolvedValue();
    const runnerFetch = vi.fn(async (url: string) => {
      if (url === "https://actions-container.internal/verify-callback-secret") {
        return new Response(JSON.stringify({ valid: false }), {
          status: 403,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected runner fetch: ${url}`);
    });

    await handleContainerHeartbeat({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        ACTIONS_RUNNER: createRunnerNamespace(runnerFetch)
      },
      payload: {
        type: "heartbeat",
        callbackSecret: "secret-1",
        repositoryId: "repo-1",
        sessionId: "session-1",
        attemptId: "attempt-1",
        instanceType: "lite",
        containerInstance: "agent-session-session-1-attempt-1",
        sessionNumber: 1,
        attemptNumber: 1,
        stdout: "Analyzing repository"
      }
    });

    expect(appendAttemptEvents).not.toHaveBeenCalled();
    expect(runnerFetch).toHaveBeenCalledTimes(1);
  });

  it("finalizes successful completions and stops the container", async () => {
    const session = buildSession({
      source_type: "issue",
      source_number: 42
    });
    const runnerFetch = vi.fn(async (url: string) => {
      if (url === "https://actions-container.internal/verify-callback-secret") {
        return new Response(JSON.stringify({ valid: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (url === "https://actions-container.internal/callback") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (url === "https://actions-container.internal/stop") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected runner fetch: ${url}`);
    });

    vi.spyOn(AgentSessionService.prototype, "findSessionById").mockResolvedValue(session);
    vi.spyOn(AgentSessionService.prototype, "findAttemptById")
      .mockResolvedValueOnce(buildAttempt())
      .mockResolvedValueOnce(buildAttempt());
    vi.spyOn(WorkflowTaskFlowService.prototype, "reconcileSourceTaskStatus").mockResolvedValue([]);

    await handleContainerCompletion({
      env: {
        DB: createRepositoryLookupDb(),
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: createRunnerNamespace(runnerFetch)
      },
      payload: {
        type: "completion",
        callbackSecret: "secret-1",
        repositoryId: "repo-1",
        sessionId: "session-1",
        attemptId: "attempt-1",
        instanceType: "lite",
        containerInstance: "agent-session-session-1-attempt-1",
        sessionNumber: 1,
        attemptNumber: 1,
        exitCode: 0,
        durationMs: 25,
        stdout: "done"
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(AgentSessionService.prototype.recordSessionObservability).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-1",
        result: expect.objectContaining({
          exitCode: 0,
          durationMs: 25,
          stdout: "done"
        }),
        logs: expect.stringContaining("exit_code: 0")
      })
    );
    expect(AgentSessionService.prototype.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        status: "success",
        exitCode: 0
      })
    );
    expect(WorkflowTaskFlowService.prototype.reconcileSourceTaskStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: expect.objectContaining({ id: "repo-1" }),
        sourceType: "issue",
        sourceNumber: 42
      })
    );
    expect(AgentSessionService.prototype.syncSessionForAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionStatus: "success",
        containerInstance: null,
        exitCode: 0
      })
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      1,
      "https://actions-container.internal/verify-callback-secret",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      2,
      "https://actions-container.internal/callback",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      3,
      "https://actions-container.internal/stop",
      {
        method: "POST"
      }
    );
  });

  it("schedules a retry for resource-pressure completion failures", async () => {
    const queueSend = vi.fn(async () => undefined);
    const runnerFetch = vi.fn(async (url: string) => {
      if (url === "https://actions-container.internal/verify-callback-secret") {
        return new Response(JSON.stringify({ valid: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (
        url === "https://actions-container.internal/callback" ||
        url === "https://actions-container.internal/stop"
      ) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected runner fetch: ${url}`);
    });
    const createRetryAttempt = vi
      .spyOn(AgentSessionService.prototype, "createRetryAttempt")
      .mockResolvedValue(
        buildAttempt({
          id: "attempt-2",
          attempt_number: 2,
          status: "queued",
          instance_type: "basic",
          promoted_from_instance_type: "lite"
        })
      );

    vi.spyOn(AgentSessionService.prototype, "findSessionById").mockResolvedValue(buildSession());
    vi.spyOn(AgentSessionService.prototype, "findAttemptById")
      .mockResolvedValueOnce(buildAttempt())
      .mockResolvedValueOnce(buildAttempt());

    await handleContainerCompletion({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "test-secret",
        ACTIONS_QUEUE: {
          send: queueSend
        } as unknown as Queue<unknown>,
        ACTIONS_RUNNER: createRunnerNamespace(runnerFetch)
      },
      payload: {
        type: "completion",
        callbackSecret: "secret-1",
        repositoryId: "repo-1",
        sessionId: "session-1",
        attemptId: "attempt-1",
        instanceType: "lite",
        containerInstance: "agent-session-session-1-attempt-1",
        sessionNumber: 1,
        attemptNumber: 1,
        exitCode: 143,
        durationMs: 25,
        stderr: "killed"
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(createRetryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-1",
        instanceType: "basic",
        promotedFromInstanceType: "lite"
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
        failureReason: "unknown_infra_failure",
        failureStage: "runtime"
      })
    );
    expect(AgentSessionService.prototype.syncSessionForAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionStatus: "queued",
        activeAttemptId: "attempt-2",
        latestAttemptId: "attempt-2"
      })
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      1,
      "https://actions-container.internal/verify-callback-secret",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      2,
      "https://actions-container.internal/callback",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      3,
      "https://actions-container.internal/stop",
      {
        method: "POST"
      }
    );
  });

  it("skips completion side effects when callback secret verification fails", async () => {
    const recordSessionObservability = vi
      .spyOn(AgentSessionService.prototype, "recordSessionObservability")
      .mockResolvedValue();
    const completeAttempt = vi
      .spyOn(AgentSessionService.prototype, "completeAttempt")
      .mockResolvedValue();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runnerFetch = vi.fn(async (url: string) => {
      if (url === "https://actions-container.internal/verify-callback-secret") {
        return new Response(JSON.stringify({ valid: false }), {
          status: 403,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected runner fetch: ${url}`);
    });

    await handleContainerCompletion({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: createRunnerNamespace(runnerFetch)
      },
      payload: {
        type: "completion",
        callbackSecret: "secret-1",
        repositoryId: "repo-1",
        sessionId: "session-1",
        attemptId: "attempt-1",
        instanceType: "lite",
        containerInstance: "agent-session-session-1-attempt-1",
        sessionNumber: 1,
        attemptNumber: 1,
        exitCode: 0,
        durationMs: 25,
        stdout: "done"
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(recordSessionObservability).not.toHaveBeenCalled();
    expect(completeAttempt).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "container completion callback secret verification failed",
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-1",
        attemptId: "attempt-1"
      })
    );
    expect(runnerFetch).toHaveBeenCalledTimes(1);
  });
});
