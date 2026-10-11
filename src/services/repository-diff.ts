import { createTwoFilesPatch, diffLines } from "diff";
import { GitObjectTooLargeError } from "./git-store/object-store";
import { RepositoryGraph } from "./git-store/repository-graph";
import { parseUnifiedDiffHunks, type RepositoryDiffHunk } from "./repository-diff-hunks";

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

async function flattenTree(args: {
  graph: RepositoryGraph;
  oid: string;
  basePath?: string;
  output?: Map<string, FlatTreeEntry>;
}): Promise<Map<string, FlatTreeEntry>> {
  const output = args.output ?? new Map<string, FlatTreeEntry>();
  const tree = args.graph.readTree(args.oid);
  for (const entry of tree.tree) {
    const path = args.basePath ? `${args.basePath}/${entry.path}` : entry.path;
    if (entry.type === "tree") {
      await flattenTree({
        graph: args.graph,
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
  graph: RepositoryGraph;
  oid: string | null;
}): Promise<TextBlobInfo> {
  if (!args.oid) {
    return {
      content: "",
      isBinary: false
    };
  }
  try {
    const blob = args.graph.store.readPrefix(args.oid, MAX_DIFF_TEXT_BYTES);
    if (looksBinary(blob.content)) {
      return { content: null, isBinary: true };
    }
    return { content: new TextDecoder().decode(blob.content), isBinary: false };
  } catch (error) {
    if (error instanceof GitObjectTooLargeError) {
      return { content: null, isBinary: true };
    }
    throw error;
  }
}

function buildDiffChange(args: {
  path: string;
  previousEntry: FlatTreeEntry | null;
  nextEntry: FlatTreeEntry | null;
  previousText: TextBlobInfo;
  nextText: TextBlobInfo;
}): RepositoryDiffChange {
  const status =
    args.previousEntry && args.nextEntry ? "modified" : args.nextEntry ? "added" : "deleted";
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
  graph: RepositoryGraph;
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
        graph: args.graph,
        oid: args.previousOid
      })
    : new Map<string, FlatTreeEntry>();
  const nextEntries = args.nextOid
    ? await flattenTree({
        graph: args.graph,
        oid: args.nextOid
      })
    : new Map<string, FlatTreeEntry>();
  const paths = Array.from(new Set([...previousEntries.keys(), ...nextEntries.keys()])).sort(
    (left, right) => left.localeCompare(right)
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
            graph: args.graph,
            oid: previousEntry.oid
          })
        : Promise.resolve({ content: "", isBinary: false }),
      nextEntry?.type === "blob"
        ? readTextBlob({
            graph: args.graph,
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
