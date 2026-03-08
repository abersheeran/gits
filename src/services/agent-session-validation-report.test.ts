import { describe, expect, it } from "vitest";
import {
  GITS_VALIDATION_REPORT_BEGIN,
  GITS_VALIDATION_REPORT_END,
  appendValidationReportPrompt,
  extractValidationReportFromText
} from "./agent-session-validation-report";

describe("agent-session-validation-report", () => {
  it("appends the validation report contract once", () => {
    const prompt = appendValidationReportPrompt("Ship the fix.");
    expect(prompt).toContain(GITS_VALIDATION_REPORT_BEGIN);
    expect(prompt).toContain(GITS_VALIDATION_REPORT_END);
    expect(appendValidationReportPrompt(prompt)).toBe(prompt);
  });

  it("extracts and removes the validation report block from output text", () => {
    const output = `Running checks
${GITS_VALIDATION_REPORT_BEGIN}
{"headline":"Tests passed; integration is still running; build was skipped.","detail":"Ran unit tests, left integration tests running, and skipped the build because the change only touched docs.","checks":[{"kind":"tests","scope":"unit","status":"passed","command":"npm test -- --project unit","summary":"Unit tests passed."},{"kind":"tests","scope":"integration","status":"pending","command":"npm test -- --project integration","summary":"Integration tests are still running."},{"kind":"build","status":"skipped","command":"npm run build","summary":"Build was intentionally skipped for this run."}]}
${GITS_VALIDATION_REPORT_END}
Done.`;

    const extracted = extractValidationReportFromText(output);
    expect(extracted.cleanedText).toBe("Running checks\n\nDone.");
    expect(extracted.report).toEqual({
      headline: "Tests passed; integration is still running; build was skipped.",
      detail: "Ran unit tests, left integration tests running, and skipped the build because the change only touched docs.",
      checks: [
        {
          kind: "tests",
          scope: "unit",
          label: "Tests",
          status: "passed",
          command: "npm test -- --project unit",
          summary: "Unit tests passed."
        },
        {
          kind: "tests",
          scope: "integration",
          label: "Tests",
          status: "pending",
          command: "npm test -- --project integration",
          summary: "Integration tests are still running."
        },
        {
          kind: "build",
          scope: null,
          label: "Build",
          status: "skipped",
          command: "npm run build",
          summary: "Build was intentionally skipped for this run."
        }
      ]
    });
  });

  it("accepts partial check statuses for mixed outcomes", () => {
    const output = `${GITS_VALIDATION_REPORT_BEGIN}
{"headline":"Build only partially completed.","detail":"The server bundle built successfully, but the client bundle failed after assets were emitted.","checks":[{"kind":"build","scope":"client","status":"partial","command":"npm run build -- --filter client","summary":"Client build emitted assets before failing in the final optimization step."}]}
${GITS_VALIDATION_REPORT_END}`;

    const extracted = extractValidationReportFromText(output);
    expect(extracted.report).toEqual({
      headline: "Build only partially completed.",
      detail: "The server bundle built successfully, but the client bundle failed after assets were emitted.",
      checks: [
        {
          kind: "build",
          scope: "client",
          label: "Build",
          status: "partial",
          command: "npm run build -- --filter client",
          summary: "Client build emitted assets before failing in the final optimization step."
        }
      ]
    });
  });
});
