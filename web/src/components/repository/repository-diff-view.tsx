import { Badge } from "@/components/ui/badge";
import type { RepositoryCompareChange } from "@/lib/api";
import { cn } from "@/lib/utils";

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

type RepositoryDiffViewProps = {
  changes: RepositoryCompareChange[];
  className?: string;
};

export function RepositoryDiffView({ changes, className }: RepositoryDiffViewProps) {
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">No file changes.</p>;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {changes.map((change) => (
        <section key={`${change.status}:${change.path}`} className="overflow-hidden rounded-md border">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={changeBadgeVariant(change.status)}>{change.status}</Badge>
              <span className="font-mono text-sm">{change.path}</span>
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
