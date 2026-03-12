import type {
  AgentSessionAttemptEventRecord,
  AgentSessionValidationCheckKind,
  AgentSessionValidationCheckRecord,
  AgentSessionValidationCheckStatus,
  AgentSessionValidationReport
} from "../types";

export const GITS_VALIDATION_REPORT_BEGIN = "[GITS_VALIDATION_REPORT_BEGIN]";
export const GITS_VALIDATION_REPORT_END = "[GITS_VALIDATION_REPORT_END]";

const VALIDATION_CHECK_LABELS: Record<AgentSessionValidationCheckKind, string> = {
  tests: "Tests",
  build: "Build",
  lint: "Lint"
};

const VALIDATION_CHECK_KINDS = new Set<AgentSessionValidationCheckKind>(["tests", "build", "lint"]);
const VALIDATION_CHECK_STATUSES = new Set<AgentSessionValidationCheckStatus>([
  "passed",
  "failed",
  "pending",
  "cancelled",
  "skipped",
  "partial"
]);

const VALIDATION_REPORT_BLOCK_PATTERN = new RegExp(
  `${escapeForRegExp(GITS_VALIDATION_REPORT_BEGIN)}\\s*([\\s\\S]*?)\\s*${escapeForRegExp(
    GITS_VALIDATION_REPORT_END
  )}`,
  "g"
);

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSingleLineText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function parseValidationCheck(value: unknown): AgentSessionValidationCheckRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const data = value as Record<string, unknown>;
  const kind = typeof data.kind === "string" ? data.kind.trim() : "";
  const status = typeof data.status === "string" ? data.status.trim() : "";
  if (
    !VALIDATION_CHECK_KINDS.has(kind as AgentSessionValidationCheckKind) ||
    !VALIDATION_CHECK_STATUSES.has(status as AgentSessionValidationCheckStatus)
  ) {
    return null;
  }

  const scope = normalizeSingleLineText(data.scope, 80);
  const command = normalizeSingleLineText(data.command, 160);
  const summary = normalizeSingleLineText(data.summary, 240);
  if (!command || !summary) {
    return null;
  }

  return {
    kind: kind as AgentSessionValidationCheckKind,
    label: VALIDATION_CHECK_LABELS[kind as AgentSessionValidationCheckKind],
    scope,
    status: status as AgentSessionValidationCheckStatus,
    command,
    summary
  };
}

export function parseAgentSessionValidationReport(
  value: unknown
): AgentSessionValidationReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const headline = normalizeSingleLineText(data.headline, 240);
  const detail = normalizeSingleLineText(data.detail, 320);
  if (!headline || !detail || !Array.isArray(data.checks)) {
    return null;
  }

  const seenChecks = new Set<string>();
  const checks = data.checks.flatMap((item) => {
    const parsed = parseValidationCheck(item);
    if (!parsed) {
      return [];
    }
    const checkKey = `${parsed.kind}\u0000${parsed.scope ?? ""}\u0000${parsed.command}`;
    if (seenChecks.has(checkKey)) {
      return [];
    }
    seenChecks.add(checkKey);
    return [parsed];
  });

  return {
    headline,
    detail,
    checks
  };
}

export function appendValidationReportPrompt(prompt: string): string {
  if (
    prompt.includes(GITS_VALIDATION_REPORT_BEGIN) &&
    prompt.includes(GITS_VALIDATION_REPORT_END)
  ) {
    return prompt;
  }

  return `${prompt.trimEnd()}

[Validation Report]
Before you exit, print exactly one machine-readable validation report to stdout.
Use this exact envelope on separate lines:
${GITS_VALIDATION_REPORT_BEGIN}
{"headline":"...","detail":"...","checks":[{"kind":"tests","scope":"unit","status":"passed","command":"npm test","summary":"Unit tests passed."}]}
${GITS_VALIDATION_REPORT_END}
Rules:
- Output valid JSON only between the markers. Do not use markdown fences.
- Always emit the block once, even if you did not run validation. In that case, use checks: [] and explain why in headline/detail.
- Allowed check kinds: tests, build, lint.
- Allowed statuses: passed, failed, pending, cancelled, skipped, partial.
- Use scope when you need to report multiple steps for the same kind, for example tests/unit and tests/integration.
- Use skipped when you intentionally did not run a validation step because an earlier result already blocked it or it was unnecessary.
- Use pending only if a validation step was started but you are exiting before it produced a final result.
- Use partial when a validation command finished with a mixed or incomplete outcome that should be reviewed by a human, but is more specific than a plain failure.
- Keep headline, detail, command, and summary factual and concise.
- Each check must describe a validation command you actually ran or intentionally skipped because an earlier validation step failed.`;
}

export function extractValidationReportFromText(input: string): {
  cleanedText: string;
  report: AgentSessionValidationReport | null;
} {
  if (!input) {
    return {
      cleanedText: input,
      report: null
    };
  }

  let report: AgentSessionValidationReport | null = null;
  let matched = false;
  for (const match of input.matchAll(VALIDATION_REPORT_BLOCK_PATTERN)) {
    matched = true;
    const payload = match[1]?.trim();
    if (!payload) {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      const nextReport = parseAgentSessionValidationReport(parsed);
      if (nextReport) {
        report = nextReport;
      }
    } catch {
      // Ignore malformed blocks and keep scanning for a valid trailing block.
    }
  }

  if (!matched) {
    return {
      cleanedText: input,
      report: null
    };
  }

  const cleanedText = input
    .replace(VALIDATION_REPORT_BLOCK_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    cleanedText,
    report
  };
}

export function findValidationReportInAttemptEvents(
  events: AgentSessionAttemptEventRecord[]
): AgentSessionValidationReport | null {
  for (const event of events) {
    const report = parseAgentSessionValidationReport(event.payload?.validationReport);
    if (report) {
      return report;
    }
  }
  return null;
}
