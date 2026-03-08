import { describe, expect, it } from "vitest";
import { buildAgentSessionValidationSummary } from "./agent-session-validation-summary";

describe("buildAgentSessionValidationSummary", () => {
  it("extracts test, build, and lint checks from validation artifacts", () => {
    const summary = buildAgentSessionValidationSummary({
      status: "success",
      artifacts: [
        {
          id: "artifact-stdout",
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "stdout",
          title: "Runner stdout",
          media_type: "text/plain",
          size_bytes: 128,
          content_text:
            "$ npm run lint\n> eslint .\n$ npm test\n> vitest run\n$ npm run build\n> tsc -b && vite build",
          created_at: 10,
          updated_at: 20
        },
        {
          id: "artifact-run-logs",
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "run_logs",
          title: "Run logs",
          media_type: "text/plain",
          size_bytes: 256,
          content_text: "[stdout]\nall checks passed",
          created_at: 9,
          updated_at: 19
        },
        {
          id: "artifact-stderr",
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "stderr",
          title: "Runner stderr",
          media_type: "text/plain",
          size_bytes: 12,
          content_text: "",
          created_at: 8,
          updated_at: 18
        }
      ],
      usageRecords: [
        {
          id: 1,
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "duration_ms",
          value: 1250,
          unit: "ms",
          detail: null,
          payload: null,
          created_at: 1,
          updated_at: 1
        },
        {
          id: 2,
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "exit_code",
          value: 0,
          unit: "count",
          detail: null,
          payload: null,
          created_at: 1,
          updated_at: 1
        },
        {
          id: 3,
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "stdout_chars",
          value: 96,
          unit: "chars",
          detail: null,
          payload: null,
          created_at: 1,
          updated_at: 1
        },
        {
          id: 4,
          session_id: "session-1",
          repository_id: "repo-1",
          kind: "stderr_chars",
          value: 0,
          unit: "chars",
          detail: null,
          payload: null,
          created_at: 1,
          updated_at: 1
        }
      ],
      interventions: []
    });

    expect(summary.headline).toBe("Validation passed with tests, build, lint evidence.");
    expect(summary.duration_ms).toBe(1250);
    expect(summary.exit_code).toBe(0);
    expect(summary.checks.map((check) => check.kind)).toEqual(["tests", "build", "lint"]);
    expect(summary.checks.every((check) => check.status === "passed")).toBe(true);
    expect(summary.highlighted_artifact_ids).toEqual([
      "artifact-stdout",
      "artifact-run-logs",
      "artifact-stderr"
    ]);
  });

  it("marks failing checks and prioritizes stderr for failed validations", () => {
    const summary = buildAgentSessionValidationSummary({
      status: "failed",
      artifacts: [
        {
          id: "artifact-run-logs",
          session_id: "session-2",
          repository_id: "repo-1",
          kind: "run_logs",
          title: "Run logs",
          media_type: "text/plain",
          size_bytes: 80,
          content_text: "$ pytest\nFAILED tests/test_login.py::test_retry",
          created_at: 10,
          updated_at: 20
        },
        {
          id: "artifact-stderr",
          session_id: "session-2",
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
          session_id: "session-2",
          repository_id: "repo-1",
          kind: "stdout",
          title: "Runner stdout",
          media_type: "text/plain",
          size_bytes: 16,
          content_text: "collecting tests",
          created_at: 9,
          updated_at: 19
        }
      ],
      usageRecords: [
        {
          id: 5,
          session_id: "session-2",
          repository_id: "repo-1",
          kind: "exit_code",
          value: 1,
          unit: "count",
          detail: null,
          payload: null,
          created_at: 1,
          updated_at: 1
        }
      ],
      interventions: [
        {
          id: 9,
          session_id: "session-2",
          repository_id: "repo-1",
          kind: "mcp_setup_warning",
          title: "MCP setup warning",
          detail: "platform MCP missing",
          created_by: null,
          created_by_username: null,
          payload: null,
          created_at: 1
        }
      ]
    });

    expect(summary.headline).toBe("Validation failed after tests activity was detected.");
    expect(summary.detail).toContain("intervention warnings");
    expect(summary.checks).toHaveLength(1);
    expect(summary.checks[0]?.kind).toBe("tests");
    expect(summary.checks[0]?.status).toBe("failed");
    expect(summary.highlighted_artifact_ids[0]).toBe("artifact-stderr");
  });
});
