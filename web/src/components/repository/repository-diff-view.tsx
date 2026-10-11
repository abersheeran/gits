import { lazy, Suspense } from "react";
import { CodeViewerSkeleton } from "@/components/ui/code-viewer-skeleton";
import { Badge } from "@/components/ui/badge";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { estimateMonacoHeight } from "@/lib/monaco";
import type { RepositoryCommitChange, RepositoryDiffHunk } from "@/lib/api";

const DIFF_CONTEXT_LINE_COUNT = 5;
const HIDDEN_REGION_CONTROL_LINE_COUNT = 2;

type RepositoryDiffViewProps = {
  changes: RepositoryCommitChange[];
  onChangeActivate?: (change: RepositoryCommitChange) => void;
  sectionIdForPath?: (path: string) => string;
};

const LazyRepositoryChangeDiffEditor = lazy(async () => {
  const module = await import("@/components/repository/repository-change-diff-editor");
  return { default: module.RepositoryChangeDiffEditor };
});

function changeBadgeVariant(status: RepositoryCommitChange["status"]) {
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

function mergeVisibleRanges(
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
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

function diffEditorHeight(change: RepositoryCommitChange): number {
  const approximateVisibleLineCount = Math.max(
    visibleLineCountForSide(change.hunks, countTextLines(change.oldContent), "base"),
    visibleLineCountForSide(change.hunks, countTextLines(change.newContent), "head")
  );

  if (approximateVisibleLineCount > 0) {
    return estimateMonacoHeight("\n".repeat(Math.max(approximateVisibleLineCount - 1, 0)), {
      minHeight: 44,
      maxHeight: 760
    });
  }

  const longestSide =
    [change.oldContent ?? "", change.newContent ?? ""]
      .sort((left, right) => right.length - left.length)
      .at(0) ?? "";

  return estimateMonacoHeight(longestSide, {
    minHeight: 44,
    maxHeight: 760
  });
}

export function RepositoryDiffView({
  changes,
  onChangeActivate,
  sectionIdForPath
}: RepositoryDiffViewProps) {
  if (changes.length === 0) {
    return <p className="text-body-xs text-text-secondary">没有文件改动。</p>;
  }

  return (
    <div className="space-y-4">
      {changes.map((change) => {
        return (
          <section
            key={`${{ added: "新增", modified: "修改", deleted: "删除" }[change.status]}:${change.path}`}
            id={sectionIdForPath?.(change.path)}
            className="scroll-mt-4 overflow-hidden rounded-lg border border-border bg-surface-base"
            onMouseDownCapture={() => onChangeActivate?.(change)}
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface-canvas px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant={changeBadgeVariant(change.status)}>
                  {{ added: "新增", modified: "修改", deleted: "删除" }[change.status]}
                </Badge>
                <span className="truncate font-mono text-[13px] text-text-primary">
                  {change.path}
                </span>
                {change.previousPath && change.previousPath !== change.path ? (
                  <span className="font-mono text-body-micro text-text-secondary">
                    原路径：{change.previousPath}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-body-micro text-text-secondary">
                <span className="text-success">+{change.additions}</span>
                <span className="text-danger-text">-{change.deletions}</span>
              </div>
            </header>
            {change.isBinary ? (
              <div className="px-4 py-3 text-body-xs text-text-secondary">
                二进制文件无法显示文本差异。
              </div>
            ) : change.oldContent !== null || change.newContent !== null ? (
              <div className="min-w-0">
                <Suspense fallback={<CodeViewerSkeleton height={diffEditorHeight(change)} />}>
                  <LazyRepositoryChangeDiffEditor
                    change={change}
                    height={diffEditorHeight(change)}
                  />
                </Suspense>
              </div>
            ) : change.patch ? (
              <div className="min-w-0">
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
              <div className="px-4 py-3 text-body-xs text-text-secondary">
                此文件暂无可显示的差异。
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
