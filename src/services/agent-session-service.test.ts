import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionService } from "./agent-session-service";
import { ActionLogStorageService, buildLogExcerpt } from "./action-log-storage-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import { MockR2Bucket } from "../test-utils/mock-r2";

function buildSessionRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "session-1",
    repository_id: "repo-1",
    session_number: 1,
    source_type: "issue",
    source_number: 42,
    source_comment_id: null,
    origin: "issue_assign",
    status: "queued",
    agent_type: "codex",
    instance_type: "lite",
    prompt: "Please fix the issue",
    branch_ref: "refs/heads/agent/session-1",
    trigger_ref: "refs/heads/main",
    trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workflow_id: "workflow-1",
    workflow_name: "Issue Bot",
    parent_session_id: null,
    created_by: "user-1",
    created_by_username: "alice",
    delegated_from_user_id: "user-1",
    delegated_from_username: "alice",
    logs: "",
    exit_code: null,
    container_instance: null,
    active_attempt_id: "attempt-1",
    latest_attempt_id: "attempt-1",
    failure_reason: null,
    failure_stage: null,
    created_at: 100,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    updated_at: 100,
    ...(overrides ?? {})
  };
}

function buildAttemptRow(overrides?: Partial<Record<string, unknown>>) {
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
    created_at: 100,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    updated_at: 100,
    ...(overrides ?? {})
  };
}

describe("AgentSessionService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a queued session with an initial queued attempt and event", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("session-created")
      .mockReturnValueOnce("attempt-created");

    const insertedEvents: Array<{ type: unknown; message: unknown }> = [];
    const db = createMockD1Database([
      {
        when: "RETURNING session_number_seq AS session_number",
        first: () => ({ session_number: 5 })
      },
      {
        when: "INSERT INTO agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "INSERT INTO agent_session_attempts",
        run: () => ({ success: true })
      },
      {
        when: "INSERT INTO agent_session_attempt_events",
        run: (params) => {
          insertedEvents.push({
            type: params[3],
            message: params[5]
          });
          return { success: true };
        }
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildSessionRow({
            id: "session-created",
            session_number: 5,
            active_attempt_id: "attempt-created",
            latest_attempt_id: "attempt-created"
          })
      }
    ]);

    const service = new AgentSessionService(db);
    const session = await service.createSessionExecution({
      repositoryId: "repo-1",
      sourceType: "issue",
      sourceNumber: 42,
      sourceCommentId: null,
      origin: "issue_assign",
      agentType: "codex",
      instanceType: "lite",
      prompt: "Please fix the issue",
      triggerRef: "refs/heads/main",
      triggerSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workflowId: "workflow-1",
      createdBy: "user-1",
      delegatedFromUserId: "user-1"
    });

    expect(session.id).toBe("session-created");
    expect(session.active_attempt_id).toBe("attempt-created");
    expect(session.latest_attempt_id).toBe("attempt-created");
    expect(insertedEvents).toEqual([
      {
        type: "attempt_created",
        message: "Attempt #1 queued."
      }
    ]);
  });

  it("creates retry attempts against the same session and promotes the next active attempt", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("attempt-retry");

    const db = createMockD1Database([
      {
        when: "SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number",
        first: () => ({ attempt_number: 2 })
      },
      {
        when: "INSERT INTO agent_session_attempts",
        run: () => ({ success: true })
      },
      {
        when: "UPDATE agent_sessions",
        run: () => ({ success: true, meta: { changes: 1 } })
      },
      {
        when: "INSERT INTO agent_session_attempt_events",
        run: () => ({ success: true })
      },
      {
        when: "FROM agent_session_attempts",
        first: () =>
          buildAttemptRow({
            id: "attempt-retry",
            attempt_number: 2,
            status: "queued",
            instance_type: "standard-1",
            promoted_from_instance_type: "lite"
          })
      }
    ]);

    const service = new AgentSessionService(db);
    const attempt = await service.createRetryAttempt({
      repositoryId: "repo-1",
      sessionId: "session-1",
      instanceType: "standard-1",
      promotedFromInstanceType: "lite"
    });

    expect(attempt.id).toBe("attempt-retry");
    expect(attempt.attempt_number).toBe(2);
    expect(attempt.promoted_from_instance_type).toBe("lite");
  });

  it("records attempt artifacts and a structured result_reported event", async () => {
    const bucket = new MockR2Bucket();
    const insertedArtifacts: string[] = [];
    const insertedEvents: string[] = [];
    const db = createMockD1Database([
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildSessionRow({
            id: "session-observe",
            active_attempt_id: "attempt-observe",
            latest_attempt_id: "attempt-observe"
          })
      },
      {
        when: "INSERT INTO agent_session_attempt_artifacts",
        run: (params) => {
          insertedArtifacts.push(String(params[4] ?? ""));
          return { success: true };
        }
      },
      {
        when: "INSERT INTO agent_session_attempt_events",
        run: (params) => {
          insertedEvents.push(String(params[3] ?? ""));
          return { success: true };
        }
      }
    ]);

    const service = new AgentSessionService(
      db,
      new ActionLogStorageService(bucket as unknown as R2Bucket)
    );
    const logs = `run logs ${"x".repeat(5_000)}`;
    const stdout = `stdout payload ${"y".repeat(5_000)}`;
    const stderr = `stderr payload ${"z".repeat(5_000)}`;

    await service.recordSessionObservability({
      repositoryId: "repo-1",
      sessionId: "session-observe",
      logs,
      result: {
        exitCode: 1,
        stdout,
        stderr,
        durationMs: 1280,
        attemptedCommand: "npm test",
        validationReport: {
          headline: "Tests failed.",
          detail: "npm test exited non-zero.",
          checks: [
            {
              kind: "tests",
              label: "Tests",
              scope: null,
              status: "failed",
              command: "npm test",
              summary: "The test command failed."
            }
          ]
        },
        mcpSetupWarning: "platform MCP missing"
      }
    });

    expect(insertedArtifacts).toEqual(["session_logs", "stdout", "stderr"]);
    expect(insertedEvents).toEqual(["result_reported", "warning"]);
    expect(
      await bucket.get(
        "repositories/repo-1/sessions/session-observe/attempts/attempt-observe/artifacts/session_logs.log"
      )
    ).not.toBeNull();
    expect(
      await bucket.get(
        "repositories/repo-1/sessions/session-observe/attempts/attempt-observe/artifacts/stdout.log"
      )
    ).not.toBeNull();
    expect(buildLogExcerpt(stdout)).not.toBe(stdout);
  });

  it("reads attempt artifact content from storage and falls back to legacy session artifact paths", async () => {
    const bucket = new MockR2Bucket();
    await bucket.put(
      "repositories/repo-1/sessions/session-1/artifacts/stdout.log",
      "full stdout"
    );

    const db = createMockD1Database([
      {
        when: "WHERE repository_id = ? AND session_id = ? AND id = ?",
        first: () => ({
          id: "artifact-stdout",
          attempt_id: "attempt-1",
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "stdout",
          title: "Runner stdout",
          media_type: "text/plain",
          size_bytes: 7,
          content_text: "excerpt",
          created_at: 1,
          updated_at: 1
        })
      }
    ]);

    const service = new AgentSessionService(
      db,
      new ActionLogStorageService(bucket as unknown as R2Bucket)
    );
    const content = await service.readArtifactContent("repo-1", "session-1", "artifact-stdout");

    expect(content?.artifact.id).toBe("artifact-stdout");
    expect(content?.content).toBe("full stdout");
  });
});
