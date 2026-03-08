import type {
  ActionRunStatus,
  AgentSessionArtifactRecord,
  AgentSessionInterventionRecord,
  AgentSessionUsageKind,
  AgentSessionUsageRecord,
  AgentSessionValidationCheckKind,
  AgentSessionValidationCheckRecord,
  AgentSessionValidationCheckStatus,
  AgentSessionValidationSummary
} from "../types";
import { findValidationReportInUsageRecords } from "./agent-session-validation-report";

type ValidationCheckDefinition = {
  kind: AgentSessionValidationCheckKind;
  label: string;
  patterns: RegExp[];
};

const VALIDATION_CHECK_DEFINITIONS: ValidationCheckDefinition[] = [
  {
    kind: "tests",
    label: "Tests",
    patterns: [
      /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i,
      /\bvitest(?:\s+run)?\b/i,
      /\bjest\b/i,
      /\bpytest\b/i,
      /\bcargo\s+test\b/i,
      /\bgo\s+test\b/i,
      /\bphpunit\b/i,
      /\brspec\b/i
    ]
  },
  {
    kind: "build",
    label: "Build",
    patterns: [
      /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/i,
      /\bvite\s+build\b/i,
      /\bnext\s+build\b/i,
      /\bwebpack\b/i,
      /\bcargo\s+build\b/i,
      /\bgo\s+build\b/i,
      /\btsc(?:\s|$|-)/i
    ]
  },
  {
    kind: "lint",
    label: "Lint",
    patterns: [
      /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/i,
      /\beslint\b/i,
      /\bbiome(?:\s+check)?\b/i,
      /\bruff\s+check\b/i,
      /\bcargo\s+clippy\b/i,
      /\bgolangci-lint\b/i
    ]
  }
];

const EXPLICIT_COMMAND_TOKENS =
  /\b(?:npm|pnpm|yarn|bun|vitest|jest|pytest|cargo|go|ruff|eslint|biome|vite|next|tsc|webpack|phpunit|rspec|golangci-lint)\b/i;

function usageRecordValue(
  records: AgentSessionUsageRecord[],
  kind: AgentSessionUsageKind
): number | null {
  const record = records.find((item) => item.kind === kind);
  return record ? record.value : null;
}

function mapRunStatusToCheckStatus(
  status: ActionRunStatus | null
): AgentSessionValidationCheckStatus {
  if (status === "success") {
    return "passed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "pending";
}

function normalizeLine(line: string): string {
  return line
    .trim()
    .replace(/^\[(?:stdout|stderr|attempted|runner_error|runner_spawn_error|mcp_setup)\]\s*/i, "")
    .replace(/^(?:[$>#]+\s*)/, "")
    .replace(/\s+/g, " ");
}

function excerptText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function commandEvidenceScore(line: string): number {
  let score = 0;
  if (EXPLICIT_COMMAND_TOKENS.test(line)) {
    score += 10;
  }
  if (line.includes("&&") || line.includes("||")) {
    score += 2;
  }
  if (/^(?:npm|pnpm|yarn|bun|vitest|jest|pytest|cargo|go|ruff|eslint|biome|vite|next|tsc)\b/i.test(line)) {
    score += 4;
  }
  return score;
}

function collectLogLines(artifacts: AgentSessionArtifactRecord[]): string[] {
  const artifactPriority = new Map<string, number>([
    ["run_logs", 0],
    ["stdout", 1],
    ["stderr", 2]
  ]);
  return artifacts
    .slice()
    .sort(
      (left, right) =>
        (artifactPriority.get(left.kind) ?? 99) - (artifactPriority.get(right.kind) ?? 99)
    )
    .flatMap((artifact) => artifact.content_text.split(/\r?\n/g))
    .map(normalizeLine)
    .filter(Boolean);
}

function detectValidationCheck(
  definition: ValidationCheckDefinition,
  lines: string[],
  overallStatus: ActionRunStatus | null
): AgentSessionValidationCheckRecord | null {
  let bestMatch: { line: string; score: number } | null = null;
  for (const line of lines) {
    if (!definition.patterns.some((pattern) => pattern.test(line))) {
      continue;
    }
    const score = commandEvidenceScore(line);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { line, score };
    }
  }

  if (!bestMatch) {
    return null;
  }

  const status = mapRunStatusToCheckStatus(overallStatus);
  const command = excerptText(bestMatch.line, 160);
  let summary = `${definition.label} command detected in the latest validation output.`;
  if (status === "passed") {
    summary = `${definition.label} command detected and the latest validation run completed successfully.`;
  } else if (status === "failed") {
    summary = `${definition.label} command detected and the latest validation run exited with a failure status.`;
  } else if (status === "cancelled") {
    summary = `${definition.label} command detected, but the latest validation run was cancelled before completion.`;
  } else if (status === "pending") {
    summary = `${definition.label} command detected and the latest validation run is still in progress.`;
  }

  return {
    kind: definition.kind,
    label: definition.label,
    status,
    command,
    summary
  };
}

function prioritizeArtifacts(
  artifacts: AgentSessionArtifactRecord[],
  overallStatus: ActionRunStatus | null,
  checks: AgentSessionValidationCheckRecord[]
): string[] {
  const checkKeywords = checks.map((check) => check.command.toLowerCase());
  const rankForKind =
    overallStatus === "failed" || overallStatus === "cancelled"
      ? new Map<string, number>([
          ["stderr", 0],
          ["run_logs", 1],
          ["stdout", 2]
        ])
      : new Map<string, number>([
          ["stdout", 0],
          ["run_logs", 1],
          ["stderr", 2]
        ]);

  return artifacts
    .slice()
    .sort((left, right) => {
      const leftRank = rankForKind.get(left.kind) ?? 99;
      const rightRank = rankForKind.get(right.kind) ?? 99;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const leftHasCheckKeyword = checkKeywords.some((keyword) =>
        left.content_text.toLowerCase().includes(keyword)
      );
      const rightHasCheckKeyword = checkKeywords.some((keyword) =>
        right.content_text.toLowerCase().includes(keyword)
      );
      if (leftHasCheckKeyword !== rightHasCheckKeyword) {
        return leftHasCheckKeyword ? -1 : 1;
      }
      return right.updated_at - left.updated_at;
    })
    .slice(0, 3)
    .map((artifact) => artifact.id);
}

function buildHeadline(args: {
  status: ActionRunStatus | null;
  checks: AgentSessionValidationCheckRecord[];
  exitCode: number | null;
}): string {
  if (args.status === "queued" || args.status === "running") {
    return "Validation is still running.";
  }
  if (args.status === "success") {
    if (args.checks.length > 0) {
      return `Validation passed with ${args.checks
        .map((check) => check.label.toLowerCase())
        .join(", ")} evidence.`;
    }
    return "Validation passed, but no explicit test/build/lint commands were detected.";
  }
  if (args.status === "failed") {
    if (args.checks.length > 0) {
      return `Validation failed after ${args.checks
        .map((check) => check.label.toLowerCase())
        .join(", ")} activity was detected.`;
    }
    return `Validation failed${args.exitCode !== null ? ` with exit code ${args.exitCode}` : ""}.`;
  }
  if (args.status === "cancelled") {
    return "Validation was cancelled before completion.";
  }
  return "Validation has not produced a structured summary yet.";
}

function buildDetail(args: {
  status: ActionRunStatus | null;
  checks: AgentSessionValidationCheckRecord[];
  exitCode: number | null;
  interventions: AgentSessionInterventionRecord[];
}): string {
  const hasWarnings = args.interventions.length > 0;
  if (args.status === "queued" || args.status === "running") {
    return "Wait for the current validation run to finish before judging the latest code state.";
  }
  if (args.checks.length > 0) {
    return hasWarnings
      ? "Review the detected checks first, then inspect highlighted artifacts and intervention warnings for context."
      : "Review the detected checks first, then inspect highlighted artifacts for the exact command transcript and output.";
  }
  if (args.status === "success") {
    return "The run completed successfully, but the captured output did not expose recognizable test/build/lint commands.";
  }
  if (args.status === "failed") {
    return `The run exited without recognizable test/build/lint commands${args.exitCode !== null ? ` (exit ${args.exitCode})` : ""}. Review stderr and run logs first.`;
  }
  if (args.status === "cancelled") {
    return "Re-run validation to produce a complete reviewable output.";
  }
  return "No validation output is available yet.";
}

export function buildAgentSessionValidationSummary(input: {
  status: ActionRunStatus | null;
  artifacts: AgentSessionArtifactRecord[];
  usageRecords: AgentSessionUsageRecord[];
  interventions: AgentSessionInterventionRecord[];
}): AgentSessionValidationSummary {
  const structuredReport = findValidationReportInUsageRecords(input.usageRecords);
  const lines = collectLogLines(input.artifacts);
  const checks =
    structuredReport?.checks ??
    VALIDATION_CHECK_DEFINITIONS.flatMap((definition) => {
      const check = detectValidationCheck(definition, lines, input.status);
      return check ? [check] : [];
    });

  const exitCode = usageRecordValue(input.usageRecords, "exit_code");
  const summary: AgentSessionValidationSummary = {
    status: input.status,
    headline:
      structuredReport?.headline ??
      buildHeadline({
        status: input.status,
        checks,
        exitCode
      }),
    detail:
      structuredReport?.detail ??
      buildDetail({
        status: input.status,
        checks,
        exitCode,
        interventions: input.interventions
      }),
    duration_ms: usageRecordValue(input.usageRecords, "duration_ms"),
    exit_code: exitCode,
    stdout_chars: usageRecordValue(input.usageRecords, "stdout_chars"),
    stderr_chars: usageRecordValue(input.usageRecords, "stderr_chars"),
    checks,
    highlighted_artifact_ids: prioritizeArtifacts(input.artifacts, input.status, checks)
  };
  return summary;
}
