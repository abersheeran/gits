import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { InlineLoadingState } from "@/components/ui/loading-state";
import { CommitRow } from "./commit-row";
import { EmptyState } from "./empty-state";
import { ErrorAlert } from "./error-alert";
import {
  formatApiError,
  getRepositoryCommits,
  getRepositoryPathHistory,
  type CommitSummary
} from "@/lib/api";
export function PathHistorySheet({
  owner,
  repo,
  reference,
  path,
  open,
  onOpenChange,
  onOpenCommit
}: {
  owner: string;
  repo: string;
  reference?: string;
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCommit: (oid: string) => void;
}) {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let canceled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = path
          ? await getRepositoryPathHistory(owner, repo, { ref: reference, path, limit })
          : await getRepositoryCommits(owner, repo, { ref: reference, limit });
        if (!canceled) setCommits(result.commits);
      } catch (cause) {
        if (!canceled) setError(formatApiError(cause));
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [owner, repo, reference, path, limit, open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-xl rounded-l-xl">
        <SheetHeader className="border-b border-border-subtle p-4 pr-14">
          <SheetTitle>路径历史</SheetTitle>
          <SheetDescription className="break-all font-mono">{path || "/"}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ErrorAlert error={error} />
          <ul className="divide-y divide-border-subtle">
            {commits.map((commit) => (
              <li key={commit.oid}>
                <CommitRow commit={commit} onOpen={onOpenCommit} />
              </li>
            ))}
          </ul>
          {loading ? (
            <InlineLoadingState />
          ) : !error && commits.length === 0 ? (
            <EmptyState title="此路径暂无提交记录" />
          ) : null}
          {!loading && !error && commits.length >= limit && limit < 100 && (
            <div className="p-4">
              <Button variant="outline" onClick={() => setLimit(Math.min(limit + 20, 100))}>
                加载更多
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
