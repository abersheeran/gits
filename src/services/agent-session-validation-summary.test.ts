import { describe, expect, it } from "vitest";
import { buildAgentSessionValidationSummary } from "./agent-session-validation-summary";

describe("buildAgentSessionValidationSummary", () => {
  it("derives validation metadata from the latest attempt and artifacts", () => {
    const summary = buildAgentSessionValidationSummary({
      status: "success",
      attempt: {
        id: "attempt-1",
        session_id: "session-1",
        repository_id: "repo-1",
        attempt_number: 1,
        status: "success",
        instance_type: "lite",
        promoted_from_instance_type: null,
        container_instance: "agent-session-session-1-attempt-1",
        exit_code: 0,
        failure_reason: null,
        failure_stage: null,
        created_at: 1,
        claimed_at: 2,
        started_at: 3,
        completed_at: 1253,
        updated_at: 1253
      },
      artifacts: [
        {
          id: "artifact-stdout",
          attempt_id: "attempt-1",
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "stdout",
          title: "Runner stdout",
          media_type: "text/plain",
          size_bytes: 96,
          content_text:
            "$ npm run lint\n> eslint .\n$ npm test\n> vitest run\n$ npm run build\n> tsc -b && vite build",
          created_at: 10,
          updated_at: 20
        },
        {
          id: "artifact-session-logs",
          attempt_id: "attempt-1",
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "session_logs",
          title: "Session logs",
          media_type: "text/plain",
          size_bytes: 120,
          content_text: "all checks passed",
          created_at: 9,
          updated_at: 19
        },
        {
          id: "artifact-stderr",
          attempt_id: "attempt-1",
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "stderr",
          title: "Runner stderr",
          media_type: "text/plain",
          size_bytes: 0,
          content_text: "",
          created_at: 8,
          updated_at: 18
        }
      ],
      events: []
    });

    expect(summary.headline).toBe("Validation passed with tests, build, lint evidence.");
    expect(summary.duration_ms).toBe(1250);
    expect(summary.exit_code).toBe(0);
    expect(summary.stdout_chars).toBe(96);
    expect(summary.stderr_chars).toBe(0);
    expect(summary.checks.map((check) => check.kind)).toEqual(["tests", "build", "lint"]);
    expect(summary.highlighted_artifact_ids).toEqual([
      "artifact-stdout",
      "artifact-session-logs",
      "artifact-stderr"
    ]);
  });

  it("prefers a structured validation report emitted in attempt events", () => {
    const summary = buildAgentSessionValidationSummary({
      status: "failed",
      attempt: {
        id: "attempt-2",
        session_id: "session-2",
        repository_id: "repo-1",
        attempt_number: 2,
        status: "failed",
        instance_type: "lite",
        promoted_from_instance_type: null,
        container_instance: "agent-session-session-2-attempt-2",
        exit_code: 1,
        failure_reason: "agent_exit_non_zero",
        failure_stage: "runtime",
        created_at: 1,
        claimed_at: 2,
        started_at: 3,
        completed_at: 503,
        updated_at: 503
      },
      artifacts: [
        {
          id: "artifact-build",
          attempt_id: "attempt-2",
          session_id: "session-2",
          repository_id: "repo-1",
          kind: "stdout",
          title: "Build output",
          media_type: "text/plain",
          size_bytes: 64,
          content_text: "npm run build -- --filter client",
          created_at: 10,
          updated_at: 20
        }
      ],
      events: [
        {
          id: 11,
          attempt_id: "attempt-2",
          session_id: "session-2",
          repository_id: "repo-1",
          type: "result_reported",
          stream: "error",
          message: "Attempt reported exit code 1.",
          payload: {
            exitCode: 1,
            durationMs: 500,
            stdoutChars: 64,
            stderrChars: 10,
            validationReport: {
              headline: "Unit tests passed, but the client build only partially completed.",
              detail: "The client build emitted assets before failing in the final optimization step.",
              checks: [
                {
                  kind: "tests",
                  scope: "unit",
                  status: "passed",
                  command: "npm test -- --project unit",
                  summary: "Unit tests completed successfully."
                },
                {
                  kind: "build",
                  scope: "client",
                  status: "partial",
                  command: "npm run build -- --filter client",
                  summary: "Client build emitted assets before failing in the final optimization step."
                }
              ]
            }
          },
          created_at: 503
        }
      ]
    });

    expect(summary.headline).toBe(
      "Unit tests passed, but the client build only partially completed."
    );
    expect(summary.detail).toBe(
      "The client build emitted assets before failing in the final optimization step."
    );
    expect(summary.duration_ms).toBe(500);
    expect(summary.exit_code).toBe(1);
    expect(summary.checks).toEqual([
      {
        kind: "tests",
        label: "Tests",
        scope: "unit",
        status: "passed",
        command: "npm test -- --project unit",
        summary: "Unit tests completed successfully."
      },
      {
        kind: "build",
        label: "Build",
        scope: "client",
        status: "partial",
        command: "npm run build -- --filter client",
        summary: "Client build emitted assets before failing in the final optimization step."
      }
    ]);
    expect(summary.highlighted_artifact_ids[0]).toBe("artifact-build");
  });

  it("prioritizes stderr output for failed validations without structured reports", () => {
    const summary = buildAgentSessionValidationSummary({
      status: "failed",
      attempt: {
        id: "attempt-3",
        session_id: "session-3",
        repository_id: "repo-1",
        attempt_number: 1,
        status: "failed",
        instance_type: "lite",
        promoted_from_instance_type: null,
        container_instance: "agent-session-session-3-attempt-1",
        exit_code: 1,
        failure_reason: "agent_exit_non_zero",
        failure_stage: "runtime",
        created_at: 1,
        claimed_at: 2,
        started_at: 3,
        completed_at: 403,
        updated_at: 403
      },
      artifacts: [
        {
          id: "artifact-stderr",
          attempt_id: "attempt-3",
          session_id: "session-3",
          repository_id: "repo-1",
          kind: "stderr",
          title: "Runner stderr",
          media_type: "text/plain",
          size_bytes: 64,
          content_text: "pytest failed with exit code 1",
          created_at: 11,
          updated_at: 21
        },
        {
          id: "artifact-stdout",
          attempt_id: "attempt-3",
          session_id: "session-3",
          repository_id: "repo-1",
          kind: "stdout",
          title: "Runner stdout",
          media_type: "text/plain",
          size_bytes: 40,
          content_text: "$ pytest\nFAILED tests/test_login.py::test_retry",
          created_at: 9,
          updated_at: 19
        }
      ],
      events: []
    });

    expect(summary.headline).toBe("Validation failed after tests activity was detected.");
    expect(summary.detail).toBe(
      "Review the detected checks first, then inspect highlighted artifacts for the exact command transcript and output."
    );
    expect(summary.checks).toHaveLength(1);
    expect(summary.checks[0]?.kind).toBe("tests");
    expect(summary.highlighted_artifact_ids[0]).toBe("artifact-stderr");
  });
});
