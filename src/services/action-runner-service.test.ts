import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRecord } from "../types";
import { executeActionRun } from "./action-runner-service";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "./action-runner-prompt-tokens";
import { AgentSessionService } from "./agent-session-service";
import { ActionsService } from "./actions-service";
import {
  ACTIONS_SYSTEM_EMAIL,
  ACTIONS_SYSTEM_USERNAME,
  AuthService
} from "./auth-service";
import { WorkflowTaskFlowService } from "./workflow-task-flow-service";

function createStartedRunnerResponse(payload: unknown, startedAt = 2): Response {
  return new Response(JSON.stringify(payload), {
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
    run_number: 1,
    source_type: "manual",
    source_number: null,
    source_comment_id: null,
    trigger_source_type: null,
    trigger_source_number: null,
    trigger_source_comment_id: null,
    origin: "manual",
    status: "queued",
    agent_type: "codex",
    instance_type: "lite",
    prompt: "请执行测试并修复失败。",
    branch_ref: null,
    trigger_ref: "refs/heads/main",
    trigger_sha: "abc123",
    workflow_id: null,
    workflow_name: null,
    parent_session_id: null,
    linked_run_id: null,
    created_by: null,
    created_by_username: null,
    delegated_from_user_id: null,
    delegated_from_username: null,
    triggered_by: null,
    triggered_by_username: null,
    logs: "",
    exit_code: null,
    container_instance: null,
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
    vi.spyOn(ActionsService.prototype, "replaceRunLogs").mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes repository action config files to the runner container", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "model = \"gpt-5-codex\"",
      claudeCodeConfigFileContent: "{\n  \"permissions\": \"bypass\"\n}",
      inheritsGlobalCodexConfig: false,
      inheritsGlobalClaudeCodeConfig: false,
      updated_at: 1
    });

    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        repositoryId?: string;
        runId?: string;
        containerInstance?: string;
        configFiles?: Record<string, string>;
      };

      expect(payload.repositoryId).toBe("repo-1");
      expect(payload.runId).toBe("run-1");
      expect(payload.containerInstance).toBe("agent-session-run-1");

      expect(payload.configFiles).toEqual({
        "/home/rootless/.codex/config.toml": "model = \"gpt-5-codex\"",
        "/home/rootless/.claude/settings.json": "{\n  \"permissions\": \"bypass\"\n}"
      });

      return createStartedRunnerResponse({ exitCode: 0, durationMs: 25 });
    });

    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
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
        id: "run-1",
        session_number: 1,
        run_number: 1,
        prompt: "请执行测试并修复失败。",
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123"
      }),
      requestOrigin: "http://localhost:8787"
    });

    expect(runnerFetch).toHaveBeenCalledTimes(1);
    expect(stopFetch).toHaveBeenCalledTimes(1);
  });

  it("uses the matching runner binding for non-lite instance types", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      instanceType: "standard-3",
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });

    const liteFetch = vi.fn();
    const standard3Fetch = vi.fn(async () =>
      createStartedRunnerResponse({ exitCode: 0, durationMs: 25 })
    );
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: liteFetch
          })
        } as unknown as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_3: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : standard3Fetch(url, init)
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
        id: "run-2",
        session_number: 2,
        run_number: 2,
        instance_type: "standard-3",
        prompt: "请执行测试并修复失败。",
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123"
      }),
      requestOrigin: "http://localhost:8787"
    });

    expect(liteFetch).not.toHaveBeenCalled();
    expect(standard3Fetch).toHaveBeenCalledTimes(1);
    expect(stopFetch).toHaveBeenCalledTimes(1);
  });

  it("delegates token lifecycle to the container and passes actions identity hints", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(WorkflowTaskFlowService.prototype, "reconcileSourceTaskStatus").mockResolvedValue([]);
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });

    const createAccessToken = vi.spyOn(AuthService.prototype, "createAccessToken");
    const revokeAccessToken = vi.spyOn(AuthService.prototype, "revokeAccessToken");

    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        prompt: string;
        runNumber?: number;
        triggeredByUserId?: string;
        triggeredByUsername?: string;
        enableIssueReplyToken?: boolean;
        enablePrCreateToken?: boolean;
        gitCommitName?: string;
        gitCommitEmail?: string;
        env?: Record<string, string>;
      };

      expect(payload.prompt).toContain(ISSUE_REPLY_TOKEN_PLACEHOLDER);
      expect(payload.prompt).toContain(ISSUE_PR_CREATE_TOKEN_PLACEHOLDER);
      expect(payload.runNumber).toBe(3);
      expect(payload.triggeredByUserId).toBe("user-1");
      expect(payload.triggeredByUsername).toBe("alice");
      expect(payload.enableIssueReplyToken).toBe(true);
      expect(payload.enablePrCreateToken).toBe(true);
      expect(payload.gitCommitName).toBe(ACTIONS_SYSTEM_USERNAME);
      expect(payload.gitCommitEmail).toBe(ACTIONS_SYSTEM_EMAIL);
      expect(payload.env).toMatchObject({
        GITS_ACTION_RUN_ID: "run-3",
        GITS_ACTION_RUN_NUMBER: "3",
        GITS_REPOSITORY: "alice/demo",
        GITS_TRIGGER_ISSUE_NUMBER: "42"
      });
      expect(payload.env?.GITS_ISSUE_REPLY_TOKEN).toBeUndefined();
      expect(payload.env?.GITS_PR_CREATE_TOKEN).toBeUndefined();

      return createStartedRunnerResponse({ exitCode: 0, durationMs: 25 });
    });
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
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
        id: "run-3",
        session_number: 3,
        run_number: 3,
        source_type: "issue",
        source_number: 42,
        prompt: `reply with ${ISSUE_REPLY_TOKEN_PLACEHOLDER} and open pr with ${ISSUE_PR_CREATE_TOKEN_PLACEHOLDER}`,
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123"
      }),
      triggeredByUser: {
        id: "user-1",
        username: "alice"
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(createAccessToken).not.toHaveBeenCalled();
    expect(revokeAccessToken).not.toHaveBeenCalled();
    expect(runnerFetch).toHaveBeenCalledTimes(1);
    expect(stopFetch).toHaveBeenCalledTimes(1);
  });

  it("grants push and PR permissions for delegated agent sessions", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(WorkflowTaskFlowService.prototype, "reconcileSourceTaskStatus").mockResolvedValue([]);
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });
    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) =>
      createStartedRunnerResponse({ exitCode: 0, durationMs: 25 })
    );
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
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
        id: "session-1",
        session_number: 4,
        run_number: 4,
        source_type: "issue",
        source_number: 42,
        origin: "issue_assign",
        prompt: `reply with ${ISSUE_REPLY_TOKEN_PLACEHOLDER} and open pr with ${ISSUE_PR_CREATE_TOKEN_PLACEHOLDER}`,
        branch_ref: "refs/heads/agent/session-1",
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123",
        workflow_id: "workflow-1",
        workflow_name: "__agent_session_internal__codex",
        created_by: "user-1",
        created_by_username: "alice",
        delegated_from_user_id: "user-1",
        delegated_from_username: "alice"
      }),
      triggeredByUser: {
        id: "user-1",
        username: "alice"
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(runnerFetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runnerFetch.mock.calls[0]?.[1]?.body)) as {
      enableIssueReplyToken?: boolean;
      enablePrCreateToken?: boolean;
      allowGitPush?: boolean;
      env?: Record<string, string>;
    };
    expect(payload.enableIssueReplyToken).toBe(true);
    expect(payload.enablePrCreateToken).toBe(true);
    expect(payload.allowGitPush).toBe(true);
    expect(payload.env).toMatchObject({
      GITS_AGENT_SESSION_ID: "session-1",
      GITS_AGENT_SESSION_BRANCH_REF: "refs/heads/agent/session-1"
    });
  });

  it("reconciles source task status after source-backed runs complete", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });
    const reconcileSourceTaskStatus = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileSourceTaskStatus")
      .mockResolvedValue([]);

    const runnerFetch = vi.fn(async () =>
      createStartedRunnerResponse({ exitCode: 0, durationMs: 25 })
    );
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
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
        id: "run-5",
        session_number: 5,
        run_number: 5,
        source_type: "pull_request",
        source_number: 7,
        prompt: "ship it",
        trigger_ref: "refs/heads/feature",
        trigger_sha: "abc123"
      }),
      requestOrigin: "http://localhost:8787"
    });

    expect(reconcileSourceTaskStatus).toHaveBeenCalledWith({
      repository: expect.objectContaining({
        id: "repo-1"
      }),
      sourceType: "pull_request",
      sourceNumber: 7
    });
  });

  it("records a warning when status reconciliation fails after completion", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    const replaceRunLogs = vi
      .spyOn(ActionsService.prototype, "replaceRunLogs")
      .mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });
    const recordRunObservability = vi
      .spyOn(AgentSessionService.prototype, "recordRunObservability")
      .mockResolvedValue();
    vi.spyOn(WorkflowTaskFlowService.prototype, "reconcileSourceTaskStatus").mockRejectedValue(
      new Error("reconcile exploded")
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const runnerFetch = vi.fn(async () =>
      createStartedRunnerResponse({ exitCode: 0, durationMs: 25 })
    );
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
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
        id: "run-6",
        session_number: 6,
        run_number: 6,
        source_type: "issue",
        source_number: 42,
        prompt: "ship it",
        trigger_ref: "refs/heads/feature",
        trigger_sha: "abc123"
      }),
      requestOrigin: "http://localhost:8787"
    });

    expect(replaceRunLogs).toHaveBeenCalledWith(
      "repo-1",
      "run-6",
      expect.stringContaining("[status_reconciliation_warning]")
    );
    expect(recordRunObservability).toHaveBeenCalledWith(
      expect.objectContaining({
        logs: expect.stringContaining("[status_reconciliation_warning]")
      })
    );
    expect(consoleError).toHaveBeenCalledWith(
      "action run status reconciliation failed",
      expect.objectContaining({
        repositoryId: "repo-1",
        runId: "run-6",
        sourceType: "issue",
        sourceNumber: 42,
        error: "reconcile exploded"
      })
    );
  });

  it("persists structured observability after a run completes", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(WorkflowTaskFlowService.prototype, "reconcileSourceTaskStatus").mockResolvedValue([]);
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });
    const recordRunObservability = vi
      .spyOn(AgentSessionService.prototype, "recordRunObservability")
      .mockResolvedValue();

    const runnerFetch = vi.fn(async () =>
      createStartedRunnerResponse({
          exitCode: 0,
          durationMs: 25,
          stdout: `stdout payload
[GITS_VALIDATION_REPORT_BEGIN]
{"headline":"Tests passed.","detail":"Ran npm test successfully.","checks":[{"kind":"tests","status":"passed","command":"npm test","summary":"Vitest completed successfully."}]}
[GITS_VALIDATION_REPORT_END]`,
          stderr: "stderr payload",
          attemptedCommand: "codex run",
          mcpSetupWarning: "platform MCP missing"
      })
    );
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
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
        id: "run-5",
        session_number: 5,
        run_number: 5,
        source_type: "issue",
        source_number: 42,
        prompt: "ship it",
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123"
      }),
      triggeredByUser: {
        id: "user-1",
        username: "alice"
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(recordRunObservability).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo-1",
        runId: "run-5",
        result: expect.objectContaining({
          durationMs: 25,
          stdout: "stdout payload",
          stderr: "stderr payload",
          attemptedCommand: "codex run",
          mcpSetupWarning: "platform MCP missing",
          validationReport: {
            headline: "Tests passed.",
            detail: "Ran npm test successfully.",
            checks: [
              {
                kind: "tests",
                label: "Tests",
                scope: null,
                status: "passed",
                command: "npm test",
                summary: "Vitest completed successfully."
              }
            ]
          }
        })
      })
    );
  });
});
