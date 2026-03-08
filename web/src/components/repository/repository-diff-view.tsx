import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type {
  RepositoryCompareChange,
  RepositoryDiffHunk,
  RepositoryDiffLine
} from "@/lib/api";
import { cn } from "@/lib/utils";

export type RepositoryDiffLineTarget = {
  change: RepositoryCompareChange;
  hunk: RepositoryDiffHunk;
  line: RepositoryDiffLine;
  side: "base" | "head";
  lineNumber: number;
};

export type RepositoryDiffLineRenderContext = {
  change: RepositoryCompareChange;
  hunk: RepositoryDiffHunk;
  line: RepositoryDiffLine;
};

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

function diffLineTone(kind: RepositoryDiffLine["kind"]) {
  switch (kind) {
    case "add":
      return "bg-emerald-500/10";
    case "delete":
      return "bg-rose-500/10";
    case "meta":
      return "bg-amber-500/10 text-muted-foreground";
    default:
      return "bg-background";
  }
}

function diffLineMarker(kind: RepositoryDiffLine["kind"]): string {
  switch (kind) {
    case "add":
      return "+";
    case "delete":
      return "-";
    case "meta":
      return "\\";
    default:
      return " ";
  }
}

type RepositoryDiffViewProps = {
  changes: RepositoryCompareChange[];
  className?: string;
  onDiffLineClick?: (target: RepositoryDiffLineTarget) => void;
  isDiffLineSelected?: (target: RepositoryDiffLineTarget) => boolean;
  renderAfterDiffLine?: (context: RepositoryDiffLineRenderContext) => ReactNode;
};

function DiffLineNumberCell(props: {
  target: RepositoryDiffLineTarget | null;
  onDiffLineClick?: (target: RepositoryDiffLineTarget) => void;
  isDiffLineSelected?: (target: RepositoryDiffLineTarget) => boolean;
}) {
  if (!props.target) {
    return <span className="block px-2 py-1 text-right text-muted-foreground/40"> </span>;
  }

  const selected = props.isDiffLineSelected?.(props.target) ?? false;
  const content = String(props.target.lineNumber);
  if (!props.onDiffLineClick) {
    return (
      <span
        className={cn(
          "block px-2 py-1 text-right text-muted-foreground",
          selected && "bg-primary/10 font-medium text-foreground"
        )}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (props.target) {
          props.onDiffLineClick?.(props.target);
        }
      }}
      className={cn(
        "block w-full px-2 py-1 text-right text-muted-foreground transition hover:bg-primary/10 hover:text-foreground",
        selected && "bg-primary/15 font-medium text-foreground"
      )}
    >
      {content}
    </button>
  );
}

export function RepositoryDiffView({
  changes,
  className,
  onDiffLineClick,
  isDiffLineSelected,
  renderAfterDiffLine
}: RepositoryDiffViewProps) {
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">No file changes.</p>;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {changes.map((change) => (
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
              <span>+{change.additions}</span>
              <span>-{change.deletions}</span>
            </div>
          </header>
          {change.isBinary ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              Binary change. Inline diff is not available.
            </div>
          ) : change.hunks.length > 0 ? (
            <div className="overflow-x-auto bg-background">
              <div className="min-w-[720px] font-mono text-xs leading-5">
                {change.hunks.map((hunk) => (
                  <section key={`${change.path}:${hunk.header}`} className="border-t first:border-t-0">
                    <div className="grid grid-cols-[64px_64px_minmax(0,1fr)] border-b bg-muted/30 text-muted-foreground">
                      <span className="px-2 py-1">old</span>
                      <span className="px-2 py-1">new</span>
                      <span className="px-3 py-1">{hunk.header}</span>
                    </div>
                    {hunk.lines.map((line, index) => {
                      const lineContext = { change, hunk, line };
                      const oldTarget =
                        line.oldLineNumber === null
                          ? null
                          : {
                              ...lineContext,
                              side: "base" as const,
                              lineNumber: line.oldLineNumber
                            };
                      const newTarget =
                        line.newLineNumber === null
                          ? null
                          : {
                              ...lineContext,
                              side: "head" as const,
                              lineNumber: line.newLineNumber
                            };
                      const afterLine = renderAfterDiffLine?.(lineContext);

                      return (
                        <div key={`${hunk.header}:${index}`} className="border-b border-border/60 last:border-b-0">
                          <div
                            className={cn(
                              "grid grid-cols-[64px_64px_minmax(0,1fr)]",
                              diffLineTone(line.kind)
                            )}
                          >
                            <DiffLineNumberCell
                              target={oldTarget}
                              onDiffLineClick={onDiffLineClick}
                              isDiffLineSelected={isDiffLineSelected}
                            />
                            <DiffLineNumberCell
                              target={newTarget}
                              onDiffLineClick={onDiffLineClick}
                              isDiffLineSelected={isDiffLineSelected}
                            />
                            <div className="overflow-x-auto px-3 py-1 whitespace-pre">
                              <span className="select-none text-muted-foreground">
                                {diffLineMarker(line.kind)}
                              </span>
                              <span>{line.content || " "}</span>
                            </div>
                          </div>
                          {afterLine ? (
                            <div className="border-t border-border/60 bg-background px-3 py-2">
                              {afterLine}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>
          ) : change.patch ? (
            <pre className="overflow-x-auto bg-background px-4 py-3 font-mono text-xs leading-5 text-foreground">
              {change.patch}
            </pre>
          ) : (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              Diff output is unavailable for this file.
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
