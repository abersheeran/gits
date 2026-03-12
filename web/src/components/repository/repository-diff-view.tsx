import { lazy, Suspense, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { estimateMonacoHeight } from "@/lib/monaco";
import type { RepositoryCompareChange, RepositoryDiffHunk, RepositoryDiffLine } from "@/lib/api";
import { cn } from "@/lib/utils";

const DIFF_CONTEXT_LINE_COUNT = 5;
const HIDDEN_REGION_CONTROL_LINE_COUNT = 2;

export type RepositoryDiffLineTarget = {
  change: RepositoryCompareChange;
  hunk: RepositoryDiffHunk;
  line: RepositoryDiffLine;
  side: "base" | "head";
  lineNumber: number;
};

export type RepositoryDiffLineDecoration = {
  id: string;
  path: string;
  side: "base" | "head";
  lineNumber: number;
  hoverMessage?: string;
};

type RepositoryDiffViewProps = {
  changes: RepositoryCompareChange[];
  className?: string;
  onDiffLineClick?: (target: RepositoryDiffLineTarget) => void;
  isDiffLineSelected?: (target: RepositoryDiffLineTarget) => boolean;
  lineDecorations?: RepositoryDiffLineDecoration[];
  renderChangeHeaderExtras?: (change: RepositoryCompareChange) => ReactNode;
  renderChangeTopPanel?: (change: RepositoryCompareChange) => ReactNode;
  activePath?: string | null;
  onChangeActivate?: (change: RepositoryCompareChange) => void;
  sectionIdForPath?: (path: string) => string;
};

const LazyRepositoryChangeDiffEditor = lazy(async () => {
  const module = await import("@/components/repository/repository-change-diff-editor");
  return { default: module.RepositoryChangeDiffEditor };
});

function changeBadgeVariant(status: RepositoryCompareChange["status"]) {
  switch (status) {
    case "added":
      return "success";
    case "deleted":
      return "destructive";
    default:
      return "secondary";
  }
}

function countTextLines(value: string | null): number {
  if (value === null) {
    return 0;
  }
  return Math.max(value.split(/\r\n|\n|\r/).length, 1);
}

function mergeVisibleRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length === 0) {
    return [];
  }

  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start);
  const mergedRanges = [sortedRanges[0]];

  for (const range of sortedRanges.slice(1)) {
    const previous = mergedRanges.at(-1);
    if (!previous) {
      mergedRanges.push(range);
      continue;
    }

    if (range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }

    mergedRanges.push(range);
  }

  return mergedRanges;
}

function visibleLineCountForSide(
  hunks: RepositoryDiffHunk[],
  totalLineCount: number,
  side: "base" | "head"
): number {
  if (totalLineCount === 0 || hunks.length === 0) {
    return totalLineCount;
  }

  const ranges = hunks
    .map((hunk) => {
      const start = side === "base" ? hunk.oldStart : hunk.newStart;
      const lineCount = side === "base" ? hunk.oldLines : hunk.newLines;
      const anchorLine = lineCount > 0 ? start : Math.min(Math.max(start, 1), totalLineCount);
      const endLine = lineCount > 0 ? start + lineCount - 1 : anchorLine;

      return {
        start: Math.max(anchorLine - DIFF_CONTEXT_LINE_COUNT, 1),
        end: Math.min(endLine + DIFF_CONTEXT_LINE_COUNT, totalLineCount)
      };
    })
    .filter((range) => range.start <= range.end);

  if (ranges.length === 0) {
    return totalLineCount;
  }

  const mergedRanges = mergeVisibleRanges(ranges);
  const visibleLineCount = mergedRanges.reduce(
    (total, range) => total + range.end - range.start + 1,
    0
  );
  const hiddenRegionCount = Math.max(mergedRanges.length - 1, 0);

  return visibleLineCount + hiddenRegionCount * HIDDEN_REGION_CONTROL_LINE_COUNT;
}

function diffEditorHeight(change: RepositoryCompareChange): number {
  const approximateVisibleLineCount = Math.max(
    visibleLineCountForSide(change.hunks, countTextLines(change.oldContent), "base"),
    visibleLineCountForSide(change.hunks, countTextLines(change.newContent), "head")
  );

  if (approximateVisibleLineCount > 0) {
    return estimateMonacoHeight("\n".repeat(Math.max(approximateVisibleLineCount - 1, 0)), {
      minHeight: 180,
      maxHeight: 760
    });
  }

  const longestSide = [change.oldContent ?? "", change.newContent ?? ""]
    .sort((left, right) => right.length - left.length)
    .at(0) ?? "";

  return estimateMonacoHeight(longestSide, {
    minHeight: 180,
    maxHeight: 760
  });
}

function RepositoryDiffEditorFallback(props: {
  className?: string;
  height: number;
}) {
  return (
    <div className={cn("monaco-shell", props.className)}>
      <div className="monaco-shell__viewport">
        <div
          className="flex items-center justify-center px-3 py-2 text-xs text-text-secondary"
          style={{ height: props.height }}
        >
          Loading diff…
        </div>
      </div>
    </div>
  );
}

export function RepositoryDiffView({
  changes,
  className,
  onDiffLineClick,
  isDiffLineSelected,
  lineDecorations,
  renderChangeHeaderExtras,
  renderChangeTopPanel,
  activePath,
  onChangeActivate,
  sectionIdForPath
}: RepositoryDiffViewProps) {
  if (changes.length === 0) {
    return <p className="text-body-sm text-text-secondary">No file changes.</p>;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {changes.map((change) => {
        const changeLineDecorations = (lineDecorations ?? []).filter(
          (decoration) => decoration.path === change.path
        );
        const changeHeaderExtras = renderChangeHeaderExtras?.(change) ?? null;
        const changeTopPanel = renderChangeTopPanel?.(change) ?? null;
        const isActive = activePath === change.path;

        return (
          <section
            key={`${change.status}:${change.path}`}
            id={sectionIdForPath?.(change.path)}
            className={cn(
              "scroll-mt-4 overflow-hidden rounded-[24px] border border-border-subtle bg-surface-base shadow-container transition-colors",
              isActive ? "border-border-default ring-1 ring-border-default" : ""
            )}
            onMouseDownCapture={() => onChangeActivate?.(change)}
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface-focus px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant={changeBadgeVariant(change.status)}>{change.status}</Badge>
                <span className="truncate font-mono text-sm text-text-primary">{change.path}</span>
                {change.previousPath && change.previousPath !== change.path ? (
                  <span className="font-mono text-xs text-text-secondary">
                    from {change.previousPath}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                {changeHeaderExtras}
                <span>+{change.additions}</span>
                <span>-{change.deletions}</span>
              </div>
            </header>
            {changeTopPanel ? (
              <div className="border-b border-border-subtle bg-surface-focus px-4 py-4">
                {changeTopPanel}
              </div>
            ) : null}
            {change.isBinary ? (
              <div className="px-4 py-3 text-body-sm text-text-secondary">
                Binary change. Inline diff is not available.
              </div>
            ) : change.oldContent !== null || change.newContent !== null ? (
              <div className="p-4">
                <Suspense
                  fallback={<RepositoryDiffEditorFallback height={diffEditorHeight(change)} />}
                >
                  <LazyRepositoryChangeDiffEditor
                    change={change}
                    height={diffEditorHeight(change)}
                    onDiffLineClick={onDiffLineClick}
                    isDiffLineSelected={isDiffLineSelected}
                    lineDecorations={changeLineDecorations}
                  />
                </Suspense>
              </div>
            ) : change.patch ? (
              <div className="p-4">
                <MonacoTextViewer
                  value={change.patch}
                  path={`${change.path}.diff`}
                  language="diff"
                  scope="diff-patch"
                  minHeight={140}
                  maxHeight={420}
                />
              </div>
            ) : ( 
              <div className="px-4 py-3 text-body-sm text-text-secondary">
                Diff output is unavailable for this file.
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
