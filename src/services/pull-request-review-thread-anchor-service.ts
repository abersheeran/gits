import { RepositoryBrowserService, type RepositoryCompareResult } from "./repository-browser-service";
import type {
  PullRequestRecord,
  PullRequestReviewThreadAnchorRecord,
  PullRequestReviewThreadRecord
} from "../types";

type AnchorLocation = Omit<PullRequestReviewThreadAnchorRecord, "status" | "patchset_changed" | "message">;

function buildAnchorLabel(args: {
  path: string;
  startLine: number | null;
  endLine: number | null;
  side: PullRequestReviewThreadRecord["start_side"];
}): string {
  if (args.startLine === null || args.endLine === null) {
    return `${args.path} (unmapped ${args.side})`;
  }
  const range =
    args.startLine === args.endLine ? String(args.startLine) : `${args.startLine}-${args.endLine}`;
  return `${args.path}:${range} (${args.side})`;
}

function buildOriginalAnchorLocation(thread: PullRequestReviewThreadRecord): AnchorLocation {
  return {
    path: thread.path,
    line: thread.line,
    side: thread.side,
    start_side: thread.start_side,
    start_line: thread.start_line,
    end_side: thread.end_side,
    end_line: thread.end_line,
    hunk_header: thread.hunk_header
  };
}

function buildAnchorRecord(args: {
  thread: PullRequestReviewThreadRecord;
  status: PullRequestReviewThreadAnchorRecord["status"];
  patchsetChanged: boolean;
  message: string;
  location?: AnchorLocation | null;
}): PullRequestReviewThreadAnchorRecord {
  const location =
    args.location ??
    ({
      path: args.thread.path,
      line: null,
      side: args.thread.side,
      start_side: args.thread.start_side,
      start_line: null,
      end_side: args.thread.end_side,
      end_line: null,
      hunk_header: null
    } satisfies AnchorLocation);
  return {
    status: args.status,
    patchset_changed: args.patchsetChanged,
    path: location.path,
    line: location.line,
    side: location.side,
    start_side: location.start_side,
    start_line: location.start_line,
    end_side: location.end_side,
    end_line: location.end_line,
    hunk_header: location.hunk_header,
    message: args.message
  };
}

function hasPatchsetChanged(
  thread: PullRequestReviewThreadRecord,
  pullRequest: PullRequestRecord
): boolean {
  return thread.base_oid !== pullRequest.base_oid || thread.head_oid !== pullRequest.head_oid;
}

function findRangeLocation(args: {
  comparison: RepositoryCompareResult;
  path: string;
  side: PullRequestReviewThreadRecord["start_side"];
  startLine: number;
  endLine: number;
  hunkHeader?: string | null;
}): AnchorLocation | null {
  const change = args.comparison.changes.find((item) => item.path === args.path);
  if (!change || change.isBinary || change.hunks.length === 0) {
    return null;
  }

  const expectedCount = args.endLine - args.startLine + 1;
  const preferredHunk =
    args.hunkHeader === null || args.hunkHeader === undefined
      ? null
      : change.hunks.find((item) => item.header === args.hunkHeader) ?? null;
  const candidateHunks = preferredHunk
    ? [preferredHunk, ...change.hunks.filter((item) => item.header !== preferredHunk.header)]
    : change.hunks;

  for (const hunk of candidateHunks) {
    const selectedLines = hunk.lines.filter((line) => {
      if (line.kind === "meta") {
        return false;
      }
      const lineNumber = args.side === "base" ? line.oldLineNumber : line.newLineNumber;
      return lineNumber !== null && lineNumber >= args.startLine && lineNumber <= args.endLine;
    });
    if (selectedLines.length !== expectedCount) {
      continue;
    }
    const isContiguous = selectedLines.every((line, index) => {
      const lineNumber = args.side === "base" ? line.oldLineNumber : line.newLineNumber;
      return lineNumber === args.startLine + index;
    });
    if (!isContiguous) {
      continue;
    }
    return {
      path: change.path,
      line: args.startLine,
      side: args.side,
      start_side: args.side,
      start_line: args.startLine,
      end_side: args.side,
      end_line: args.endLine,
      hunk_header: hunk.header
    };
  }

  return null;
}

function mapLineNumberAcrossComparison(
  comparison: RepositoryCompareResult,
  path: string,
  lineNumber: number
): number | null {
  const change = comparison.changes.find((item) => item.path === path);
  if (!change || change.isBinary || change.hunks.length === 0) {
    return lineNumber;
  }

  let delta = 0;
  for (const hunk of change.hunks) {
    if (hunk.oldLines === 0) {
      if (lineNumber < hunk.oldStart) {
        return lineNumber + delta;
      }
      delta += hunk.newLines;
      continue;
    }

    const oldEnd = hunk.oldStart + hunk.oldLines - 1;
    if (lineNumber < hunk.oldStart) {
      return lineNumber + delta;
    }
    if (lineNumber > oldEnd) {
      delta += hunk.newLines - hunk.oldLines;
      continue;
    }

    for (const line of hunk.lines) {
      if (line.oldLineNumber !== lineNumber) {
        continue;
      }
      return line.newLineNumber;
    }
    return null;
  }

  return lineNumber + delta;
}

async function remapAnchorLocation(args: {
  browserService: RepositoryBrowserService;
  owner: string;
  repo: string;
  pullRequest: PullRequestRecord;
  thread: PullRequestReviewThreadRecord;
  currentComparison: RepositoryCompareResult;
  comparisonCache: Map<string, Promise<RepositoryCompareResult | null>>;
}): Promise<AnchorLocation | null> {
  if (args.thread.start_side !== args.thread.end_side) {
    return null;
  }

  const fromOid = args.thread.start_side === "head" ? args.thread.head_oid : args.thread.base_oid;
  const toOid =
    args.thread.start_side === "head" ? args.pullRequest.head_oid : args.pullRequest.base_oid;
  if (!fromOid || !toOid || fromOid === toOid) {
    return null;
  }

  const cacheKey = `${fromOid}:${toOid}`;
  const cachedComparison =
    args.comparisonCache.get(cacheKey) ??
    args.browserService
      .compareRefs({
        owner: args.owner,
        repo: args.repo,
        baseRef: fromOid,
        headRef: toOid
      })
      .catch(() => null);
  args.comparisonCache.set(cacheKey, cachedComparison);
  const transitionComparison = await cachedComparison;
  if (!transitionComparison) {
    return null;
  }

  const mappedStartLine = mapLineNumberAcrossComparison(
    transitionComparison,
    args.thread.path,
    args.thread.start_line
  );
  const mappedEndLine = mapLineNumberAcrossComparison(
    transitionComparison,
    args.thread.path,
    args.thread.end_line
  );
  if (mappedStartLine === null || mappedEndLine === null || mappedEndLine < mappedStartLine) {
    return null;
  }

  return findRangeLocation({
    comparison: args.currentComparison,
    path: args.thread.path,
    side: args.thread.start_side,
    startLine: mappedStartLine,
    endLine: mappedEndLine
  });
}

export async function enrichPullRequestReviewThreads(args: {
  browserService: RepositoryBrowserService;
  owner: string;
  repo: string;
  pullRequest: PullRequestRecord;
  threads: PullRequestReviewThreadRecord[];
}): Promise<PullRequestReviewThreadRecord[]> {
  const comparisonCache = new Map<string, Promise<RepositoryCompareResult | null>>();
  let currentComparisonPromise: Promise<RepositoryCompareResult | null> | null = null;

  async function loadCurrentComparison(): Promise<RepositoryCompareResult | null> {
    if (!currentComparisonPromise) {
      currentComparisonPromise = args.browserService
        .compareRefs({
          owner: args.owner,
          repo: args.repo,
          baseRef: args.pullRequest.base_ref,
          headRef: args.pullRequest.head_ref
        })
        .catch(() => null);
    }
    return currentComparisonPromise;
  }

  return Promise.all(
    args.threads.map(async (thread) => {
      const patchsetChanged = hasPatchsetChanged(thread, args.pullRequest);
      const originalLocation = buildOriginalAnchorLocation(thread);
      if (!patchsetChanged) {
        return {
          ...thread,
          anchor: buildAnchorRecord({
            thread,
            status: "current",
            patchsetChanged,
            location: originalLocation,
            message: "Thread is anchored to the current diff."
          })
        };
      }

      const currentComparison = await loadCurrentComparison();
      if (!currentComparison) {
        return {
          ...thread,
          anchor: buildAnchorRecord({
            thread,
            status: "stale",
            patchsetChanged,
            message: "Unable to resolve this thread against the current patch set."
          })
        };
      }

      const exactLocation = findRangeLocation({
        comparison: currentComparison,
        path: thread.path,
        side: thread.start_side,
        startLine: thread.start_line,
        endLine: thread.end_line,
        hunkHeader: thread.hunk_header
      });
      if (exactLocation) {
        return {
          ...thread,
          anchor: buildAnchorRecord({
            thread,
            status: "current",
            patchsetChanged,
            location: exactLocation,
            message: "New commits were added, but this thread still maps to the current diff."
          })
        };
      }

      const remappedLocation = await remapAnchorLocation({
        browserService: args.browserService,
        owner: args.owner,
        repo: args.repo,
        pullRequest: args.pullRequest,
        thread,
        currentComparison,
        comparisonCache
      });
      if (remappedLocation) {
        const previousLabel = buildAnchorLabel({
          path: thread.path,
          startLine: thread.start_line,
          endLine: thread.end_line,
          side: thread.start_side
        });
        const currentLabel = buildAnchorLabel({
          path: remappedLocation.path,
          startLine: remappedLocation.start_line,
          endLine: remappedLocation.end_line,
          side: remappedLocation.start_side
        });
        return {
          ...thread,
          anchor: buildAnchorRecord({
            thread,
            status: "reanchored",
            patchsetChanged,
            location: remappedLocation,
            message: `Thread was re-anchored from ${previousLabel} to ${currentLabel} after newer commits.`
          })
        };
      }

      return {
        ...thread,
        anchor: buildAnchorRecord({
          thread,
          status: "stale",
          patchsetChanged,
          message: "This thread no longer maps to the current diff after newer commits."
        })
      };
    })
  );
}
