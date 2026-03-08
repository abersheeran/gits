import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionService } from "./agent-session-service";
import { createMockD1Database } from "../test-utils/mock-d1";

function buildAgentSessionRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    id: "session-1",
    repository_id: "repo-1",
    source_type: "issue",
    source_number: 42,
    source_comment_id: null,
    origin: "issue_assign",
    status: "queued",
    agent_type: "codex",
    prompt: "Please fix the issue",
    branch_ref: "refs/heads/agent/session-1",
    trigger_ref: "refs/heads/main",
    trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workflow_id: "workflow-1",
    workflow_name: "Issue Bot",
    linked_run_id: "run-1",
    created_by: "user-1",
    created_by_username: "alice",
    delegated_from_user_id: "user-1",
    delegated_from_username: "alice",
    created_at: now,
    started_at: null,
    completed_at: null,
    updated_at: now,
    ...(overrides ?? {})
  };
}

describe("AgentSessionService structured steps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists structured session steps with parsed payloads", async () => {
    const db = createMockD1Database([
      {
        when: "FROM agent_session_steps",
        all: () => [
          {
            id: 1,
            session_id: "session-1",
            repository_id: "repo-1",
            kind: "session_completed",
            title: "Session failed",
            detail: "failed",
            payload_json: "{\"status\":\"failed\",\"exitCode\":1}",
            created_at: 123
          }
        ]
      }
    ]);

    const service = new AgentSessionService(db);
    const steps = await service.listSteps("repo-1", "session-1");

    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe("session_completed");
    expect(steps[0]?.payload?.status).toBe("failed");
    expect(steps[0]?.payload?.exitCode).toBe(1);
  });

  it("records a run-claimed step for a linked run", async () => {
    const insertedSteps: Array<{ kind: unknown; title: unknown; detail: unknown }> = [];
    const db = createMockD1Database([
      {
        when: "WHERE s.repository_id = ? AND s.linked_run_id = ?",
        first: () => buildAgentSessionRow()
      },
      {
        when: "INSERT INTO agent_session_steps",
        run: (params) => {
          insertedSteps.push({
            kind: params[2],
            title: params[3],
            detail: params[4]
          });
          return { success: true };
        }
      }
    ]);

    const service = new AgentSessionService(db);
    await service.recordRunClaimed({
      repositoryId: "repo-1",
      runId: "run-1",
      containerInstance: "action-run-run-1",
      claimedAt: 456
    });

    expect(insertedSteps).toEqual([
      {
        kind: "run_claimed",
        title: "Runner claimed queued run",
        detail: "container: action-run-run-1"
      }
    ]);
  });

  it("creates session_created and run_queued steps for a new linked session", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("session-created");
    const insertedKinds: string[] = [];
    const db = createMockD1Database([
      {
        when: "WHERE s.repository_id = ? AND s.linked_run_id = ?",
        first: () => null
      },
      {
        when: "INSERT INTO agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-created",
            linked_run_id: "run-created"
          })
      },
      {
        when: "INSERT INTO agent_session_steps",
        run: (params) => {
          insertedKinds.push(String(params[2] ?? ""));
          return { success: true };
        }
      }
    ]);

    const service = new AgentSessionService(db);
    const session = await service.createSessionForRun({
      repositoryId: "repo-1",
      run: {
        id: "run-created",
        run_number: 5,
        workflow_id: "workflow-1",
        workflow_name: "Issue Bot",
        trigger_source_type: "issue",
        trigger_source_number: 42,
        trigger_source_comment_id: null,
        agent_type: "codex",
        prompt: "Please fix the issue",
        trigger_ref: "refs/heads/main",
        trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      origin: "issue_assign",
      createdBy: "user-1",
      delegatedFromUserId: "user-1"
    });

    expect(session.id).toBe("session-created");
    expect(insertedKinds).toEqual(["session_created", "run_queued"]);
  });

  it("records started and completed steps when syncing a run lifecycle", async () => {
    const insertedSteps: Array<{ kind: unknown; title: unknown; detail: unknown }> = [];
    const db = createMockD1Database([
      {
        when: "UPDATE agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "WHERE s.repository_id = ? AND s.linked_run_id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-sync",
            linked_run_id: "run-sync",
            branch_ref: "refs/heads/agent/session-sync"
          })
      },
      {
        when: "INSERT INTO agent_session_steps",
        run: (params) => {
          insertedSteps.push({
            kind: params[2],
            title: params[3],
            detail: params[4]
          });
          return { success: true };
        }
      }
    ]);

    const service = new AgentSessionService(db);
    await service.syncSessionForRun({
      repositoryId: "repo-1",
      runId: "run-sync",
      status: "running",
      startedAt: 100,
      updatedAt: 100
    });
    await service.syncSessionForRun({
      repositoryId: "repo-1",
      runId: "run-sync",
      status: "failed",
      completedAt: 200,
      updatedAt: 200
    });

    expect(insertedSteps).toEqual([
      {
        kind: "session_started",
        title: "Session started",
        detail: "refs/heads/agent/session-sync"
      },
      {
        kind: "session_completed",
        title: "Session failed",
        detail: "failed"
      }
    ]);
  });

  it("records structured artifacts, usage, and interventions for a run result", async () => {
    const artifactKinds: string[] = [];
    const usageKinds: string[] = [];
    const interventionKinds: string[] = [];
    const usagePayloads = new Map<string, string | null>();
    const db = createMockD1Database([
      {
        when: "WHERE s.repository_id = ? AND s.linked_run_id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-observe",
            linked_run_id: "run-observe"
          })
      },
      {
        when: "INSERT INTO agent_session_artifacts",
        run: (params) => {
          artifactKinds.push(String(params[3] ?? ""));
          return { success: true };
        }
      },
      {
        when: "INSERT INTO agent_session_usage_records",
        run: (params) => {
          usageKinds.push(String(params[2] ?? ""));
          usagePayloads.set(String(params[2] ?? ""), (params[6] as string | null) ?? null);
          return { success: true };
        }
      },
      {
        when: "INSERT INTO agent_session_interventions",
        run: (params) => {
          interventionKinds.push(String(params[2] ?? ""));
          return { success: true };
        }
      }
    ]);

    const service = new AgentSessionService(db);
    await service.recordRunObservability({
      repositoryId: "repo-1",
      runId: "run-observe",
      logs: "run logs",
      result: {
        stdout: "stdout payload",
        stderr: "stderr payload",
        durationMs: 321,
        exitCode: 1,
        error: "runner failed",
        attemptedCommand: "codex run",
        mcpSetupWarning: "platform MCP missing",
        validationReport: {
          headline: "Tests failed before build.",
          detail: "Ran npm test and stopped after the first failing suite.",
          checks: [
            {
              kind: "tests",
              label: "Tests",
              status: "failed",
              command: "npm test",
              summary: "The login retry suite failed."
            }
          ]
        }
      },
      recordedAt: 999
    });

    expect(artifactKinds).toEqual(["run_logs", "stdout", "stderr"]);
    expect(usageKinds).toEqual([
      "run_log_chars",
      "stdout_chars",
      "stderr_chars",
      "duration_ms",
      "exit_code"
    ]);
    expect(interventionKinds).toEqual(["mcp_setup_warning"]);
    expect(JSON.parse(usagePayloads.get("run_log_chars") ?? "null")).toMatchObject({
      runId: "run-observe",
      validationReport: {
        headline: "Tests failed before build.",
        detail: "Ran npm test and stopped after the first failing suite."
      }
    });
  });

  it("lists structured artifacts, usage records, and interventions", async () => {
    const db = createMockD1Database([
      {
        when: "FROM agent_session_artifacts",
        all: () => [
          {
            id: "artifact-1",
            session_id: "session-1",
            repository_id: "repo-1",
            kind: "stdout",
            title: "Runner stdout",
            media_type: "text/plain",
            size_bytes: 12,
            content_text: "hello world",
            created_at: 10,
            updated_at: 11
          }
        ]
      },
      {
        when: "FROM agent_session_usage_records",
        all: () => [
          {
            id: 2,
            session_id: "session-1",
            repository_id: "repo-1",
            kind: "duration_ms",
            value: 125,
            unit: "ms",
            detail: "Container execution duration",
            payload_json: "{\"runId\":\"run-1\"}",
            created_at: 20,
            updated_at: 21
          }
        ]
      },
      {
        when: "FROM agent_session_interventions",
        all: () => [
          {
            id: 3,
            session_id: "session-1",
            repository_id: "repo-1",
            kind: "cancel_requested",
            title: "Cancellation requested",
            detail: "Queued session cancelled by alice.",
            created_by: "user-1",
            created_by_username: "alice",
            payload_json: "{\"status\":\"cancelled\"}",
            created_at: 30
          }
        ]
      }
    ]);

    const service = new AgentSessionService(db);
    const [artifacts, usageRecords, interventions] = await Promise.all([
      service.listArtifacts("repo-1", "session-1"),
      service.listUsageRecords("repo-1", "session-1"),
      service.listInterventions("repo-1", "session-1")
    ]);

    expect(artifacts[0]?.kind).toBe("stdout");
    expect(usageRecords[0]?.payload?.runId).toBe("run-1");
    expect(interventions[0]?.created_by_username).toBe("alice");
  });

  it("records a cancellation intervention when a user cancels a queued session directly", async () => {
    const insertedInterventions: Array<{ kind: unknown; title: unknown; detail: unknown }> = [];
    const db = createMockD1Database([
      {
        when: "UPDATE agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "INSERT INTO agent_session_steps",
        run: () => ({ success: true })
      },
      {
        when: "INSERT INTO agent_session_interventions",
        run: (params) => {
          insertedInterventions.push({
            kind: params[2],
            title: params[3],
            detail: params[4]
          });
          return { success: true };
        }
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-cancelled",
            status: "cancelled",
            completed_at: 500,
            updated_at: 500
          })
      }
    ]);

    const service = new AgentSessionService(db);
    const session = await service.cancelSession({
      repositoryId: "repo-1",
      sessionId: "session-cancelled",
      completedAt: 500,
      updatedAt: 500,
      cancelledBy: "user-1"
    });

    expect(session?.status).toBe("cancelled");
    expect(insertedInterventions).toEqual([
      {
        kind: "cancel_requested",
        title: "Cancellation requested",
        detail: "A user cancelled the queued session before it started."
      }
    ]);
  });
});
