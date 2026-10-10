import * as git from "isomorphic-git";
import { createTwoFilesPatch, diffLines } from "diff";

const BINARY_SAMPLE_BYTES = 8000;
const MAX_DIFF_TEXT_BYTES = 256 * 1024;

export type RepositoryDiffChange = {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "deleted";
  mode: string | null;
  previousMode: string | null;
  oid: string | null;
  previousOid: string | null;
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch: string | null;
  hunks: RepositoryDiffHunk[];
  oldContent: string | null;
  newContent: string | null;
};

type RepositoryDiffLine = {
  kind: "context" | "add" | "delete" | "meta";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

type RepositoryDiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: RepositoryDiffLine[];
};

export function looksBinary(content: Uint8Array): boolean {
  const sample = content.subarray(0, Math.min(content.length, BINARY_SAMPLE_BYTES));
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) {
      return true;
    }
  }
  return false;
}

type FlatTreeEntry = {
  path: string;
  oid: string;
  mode: string;
  type: "tree" | "blob" | "commit";
};

type TextBlobInfo = {
  content: string | null;
  isBinary: boolean;
};

const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/;

function parseHunkLineCount(value: string | undefined, start: number): number {
  if (value !== undefined) {
    return Number.parseInt(value, 10);
  }
  return start === 0 ? 0 : 1;
}

function parseUnifiedDiffHunks(patch: string | null): RepositoryDiffHunk[] {
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

async function flattenTree(args: {
  fs: unknown;
  dir: string;
  gitdir: string;
  oid: string;
  basePath?: string;
  output?: Map<string, FlatTreeEntry>;
}): Promise<Map<string, FlatTreeEntry>> {
  const output = args.output ?? new Map<string, FlatTreeEntry>();
  const tree = await git.readTree({
    fs: args.fs as never,
    dir: args.dir,
    gitdir: args.gitdir,
    oid: args.oid
  });
  for (const entry of tree.tree) {
    const path = args.basePath ? `${args.basePath}/${entry.path}` : entry.path;
    if (entry.type === "tree") {
      await flattenTree({
        fs: args.fs,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: entry.oid,
        basePath: path,
        output
      });
      continue;
    }
    output.set(path, {
      path,
      oid: entry.oid,
      mode: entry.mode,
      type: entry.type
    });
  }
  return output;
}

async function readTextBlob(args: {
  fs: unknown;
  dir: string;
  gitdir: string;
  oid: string | null;
}): Promise<TextBlobInfo> {
  if (!args.oid) {
    return {
      content: "",
      isBinary: false
    };
  }
  const blob = await git.readBlob({
    fs: args.fs as never,
    dir: args.dir,
    gitdir: args.gitdir,
    oid: args.oid
  });
  if (looksBinary(blob.blob)) {
    return {
      content: null,
      isBinary: true
    };
  }
  const limited = blob.blob.byteLength > MAX_DIFF_TEXT_BYTES ? blob.blob.slice(0, MAX_DIFF_TEXT_BYTES) : blob.blob;
  return {
    content: new TextDecoder().decode(limited),
    isBinary: false
  };
}

function buildDiffChange(args: {
  path: string;
  previousEntry: FlatTreeEntry | null;
  nextEntry: FlatTreeEntry | null;
  previousText: TextBlobInfo;
  nextText: TextBlobInfo;
}): RepositoryDiffChange {
  const status =
    args.previousEntry && args.nextEntry
      ? "modified"
      : args.nextEntry
        ? "added"
        : "deleted";
  const isBinary = args.previousText.isBinary || args.nextText.isBinary;
  if (isBinary) {
    return {
      path: args.path,
      previousPath: null,
      status,
      mode: args.nextEntry?.mode ?? null,
      previousMode: args.previousEntry?.mode ?? null,
      oid: args.nextEntry?.oid ?? null,
      previousOid: args.previousEntry?.oid ?? null,
      additions: 0,
      deletions: 0,
      isBinary: true,
      patch: null,
      hunks: [],
      oldContent: null,
      newContent: null
    };
  }

  const oldContent = args.previousText.content ?? "";
  const newContent = args.nextText.content ?? "";
  const changes = diffLines(oldContent, newContent);
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    const lineCount = change.count ?? change.value.split("\n").length - 1;
    if (change.added) {
      additions += lineCount;
    } else if (change.removed) {
      deletions += lineCount;
    }
  }

  const patch = createTwoFilesPatch(
    args.path,
    args.path,
    oldContent,
    newContent,
    args.previousEntry?.oid ?? "",
    args.nextEntry?.oid ?? ""
  );

  return {
    path: args.path,
    previousPath: null,
    status,
    mode: args.nextEntry?.mode ?? null,
    previousMode: args.previousEntry?.mode ?? null,
    oid: args.nextEntry?.oid ?? null,
    previousOid: args.previousEntry?.oid ?? null,
    additions,
    deletions,
    isBinary: false,
    patch,
    hunks: parseUnifiedDiffHunks(patch),
    oldContent,
    newContent
  };
}

export async function diffCommitTrees(args: {
  fs: unknown;
  dir: string;
  gitdir: string;
  previousOid: string | null;
  nextOid: string | null;
}): Promise<{
  filesChanged: number;
  additions: number;
  deletions: number;
  changes: RepositoryDiffChange[];
}> {
  const previousEntries = args.previousOid
    ? await flattenTree({
        fs: args.fs,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: args.previousOid
      })
    : new Map<string, FlatTreeEntry>();
  const nextEntries = args.nextOid
    ? await flattenTree({
        fs: args.fs,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: args.nextOid
      })
    : new Map<string, FlatTreeEntry>();
  const paths = Array.from(new Set([...previousEntries.keys(), ...nextEntries.keys()])).sort((left, right) =>
    left.localeCompare(right)
  );

  const changes: RepositoryDiffChange[] = [];
  let additions = 0;
  let deletions = 0;

  for (const path of paths) {
    const previousEntry = previousEntries.get(path) ?? null;
    const nextEntry = nextEntries.get(path) ?? null;
    if (
      previousEntry &&
      nextEntry &&
      previousEntry.oid === nextEntry.oid &&
      previousEntry.mode === nextEntry.mode &&
      previousEntry.type === nextEntry.type
    ) {
      continue;
    }
    const [previousText, nextText] = await Promise.all([
      previousEntry?.type === "blob"
        ? readTextBlob({
            fs: args.fs,
            dir: args.dir,
            gitdir: args.gitdir,
            oid: previousEntry.oid
          })
        : Promise.resolve({ content: "", isBinary: false }),
      nextEntry?.type === "blob"
        ? readTextBlob({
            fs: args.fs,
            dir: args.dir,
            gitdir: args.gitdir,
            oid: nextEntry.oid
          })
        : Promise.resolve({ content: "", isBinary: false })
    ]);
    const change = buildDiffChange({
      path,
      previousEntry,
      nextEntry,
      previousText,
      nextText
    });
    additions += change.additions;
    deletions += change.deletions;
    changes.push(change);
  }

  return {
    filesChanged: changes.length,
    additions,
    deletions,
    changes
  };
}
