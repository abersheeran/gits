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
{"headline":"Tests and build passed.","detail":"Ran npm test and npm run build successfully.","checks":[{"kind":"tests","status":"passed","command":"npm test","summary":"All tests passed."},{"kind":"build","status":"passed","command":"npm run build","summary":"Build completed successfully."}]}
${GITS_VALIDATION_REPORT_END}
Done.`;

    const extracted = extractValidationReportFromText(output);
    expect(extracted.cleanedText).toBe("Running checks\n\nDone.");
    expect(extracted.report).toEqual({
      headline: "Tests and build passed.",
      detail: "Ran npm test and npm run build successfully.",
      checks: [
        {
          kind: "tests",
          label: "Tests",
          status: "passed",
          command: "npm test",
          summary: "All tests passed."
        },
        {
          kind: "build",
          label: "Build",
          status: "passed",
          command: "npm run build",
          summary: "Build completed successfully."
        }
      ]
    });
  });
});
