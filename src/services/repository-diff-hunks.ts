type RepositoryDiffLine = {
  kind: "context" | "add" | "delete" | "meta";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type RepositoryDiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: RepositoryDiffLine[];
};

const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/;

function parseHunkLineCount(value: string | undefined, start: number): number {
  if (value !== undefined) {
    return Number.parseInt(value, 10);
  }
  return start === 0 ? 0 : 1;
}

export function parseUnifiedDiffHunks(patch: string | null): RepositoryDiffHunk[] {
  if (!patch) {
    return [];
  }

  const patchLines = patch.split("\n");
  const hunks: RepositoryDiffHunk[] = [];
  let index = 0;

  while (index < patchLines.length) {
    const headerLine = patchLines[index] ?? "";
    const match = headerLine.match(HUNK_HEADER_REGEX);
    if (!match) {
      index += 1;
      continue;
    }

    const oldStart = Number.parseInt(match[1] ?? "0", 10);
    const oldLines = parseHunkLineCount(match[2], oldStart);
    const newStart = Number.parseInt(match[3] ?? "0", 10);
    const newLines = parseHunkLineCount(match[4], newStart);
    const lines: RepositoryDiffLine[] = [];
    let oldLineNumber = oldStart;
    let newLineNumber = newStart;
    index += 1;

    while (index < patchLines.length) {
      const currentLine = patchLines[index] ?? "";
      if (HUNK_HEADER_REGEX.test(currentLine)) {
        break;
      }
      if (currentLine.startsWith("\\ No newline at end of file")) {
        lines.push({
          kind: "meta",
          content: currentLine,
          oldLineNumber: null,
          newLineNumber: null
        });
        index += 1;
        continue;
      }

      const marker = currentLine[0];
      const content = currentLine.slice(1);
      if (marker === " ") {
        lines.push({
          kind: "context",
          content,
          oldLineNumber,
          newLineNumber
        });
        oldLineNumber += 1;
        newLineNumber += 1;
        index += 1;
        continue;
      }
      if (marker === "+") {
        lines.push({
          kind: "add",
          content,
          oldLineNumber: null,
          newLineNumber
        });
        newLineNumber += 1;
        index += 1;
        continue;
      }
      if (marker === "-") {
        lines.push({
          kind: "delete",
          content,
          oldLineNumber,
          newLineNumber: null
        });
        oldLineNumber += 1;
        index += 1;
        continue;
      }

      if (currentLine.length === 0) {
        index += 1;
        continue;
      }

      lines.push({
        kind: "meta",
        content: currentLine,
        oldLineNumber: null,
        newLineNumber: null
      });
      index += 1;
    }

    hunks.push({
      header: headerLine,
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines
    });
  }

  return hunks;
}
