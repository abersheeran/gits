import { lazy, Suspense, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { estimateMonacoHeight } from "@/lib/monaco";
import type { RepositoryCompareChange, RepositoryDiffHunk, RepositoryDiffLine } from "@/lib/api";
import { cn } from "@/lib/utils";

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
};

const LazyRepositoryChangeDiffEditor = lazy(async () => {
  const module = await import("@/components/repository/repository-change-diff-editor");
  return { default: module.RepositoryChangeDiffEditor };
});

function changeBadgeVariant(status: RepositoryCompareChange["status"]) {
  switch (status) {
    case "added":
      return "default";
    case "deleted":
      return "destructive";
    default:
      return "secondary";
  }
}

function diffEditorHeight(change: RepositoryCompareChange): number {
  const longestSide = [change.oldContent ?? "", change.newContent ?? ""]
    .sort((left, right) => right.length - left.length)
    .at(0) ?? "";
  return estimateMonacoHeight(longestSide, {
    minHeight: 220,
    maxHeight: 760
  });
}

function RepositoryDiffEditorFallback(props: {
  className?: string;
  height: number;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border bg-background", props.className)}>
      <div
        className="flex items-center justify-center px-3 py-2 text-xs text-muted-foreground"
        style={{ height: props.height }}
      >
        Loading diff…
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
  renderChangeTopPanel
}: RepositoryDiffViewProps) {
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">No file changes.</p>;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {changes.map((change) => {
        const changeLineDecorations = (lineDecorations ?? []).filter(
          (decoration) => decoration.path === change.path
        );
        const changeHeaderExtras = renderChangeHeaderExtras?.(change) ?? null;
        const changeTopPanel = renderChangeTopPanel?.(change) ?? null;

        return (
          <section key={`${change.status}:${change.path}`} className="overflow-hidden rounded-md border">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant={changeBadgeVariant(change.status)}>{change.status}</Badge>
                <span className="truncate font-mono text-sm">{change.path}</span>
                {change.previousPath && change.previousPath !== change.path ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    from {change.previousPath}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {changeHeaderExtras}
                <span>+{change.additions}</span>
                <span>-{change.deletions}</span>
              </div>
            </header>
            {changeTopPanel ? <div className="border-b bg-muted/10 px-4 py-4">{changeTopPanel}</div> : null}
            {change.isBinary ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
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
              <div className="px-4 py-3 text-sm text-muted-foreground">
                Diff output is unavailable for this file.
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
