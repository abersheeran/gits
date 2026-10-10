import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCommitDetail } from "@/hooks/use-commit-detail";
import { RepositoryLayout } from "@/components/common/repository-layout";
import { BranchSelect } from "@/components/common/branch-select";
import { CommitRow } from "@/components/common/commit-row";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorAlert } from "@/components/common/error-alert";
import { Panel } from "@/components/common/panel";
import { Pagination } from "@/components/common/pagination";
import { RepositoryCommitDetailSheet } from "@/components/repository/repository-commit-detail-sheet";
import { PageLoadingState, InlineLoadingState } from "@/components/ui/loading-state";
import {
  formatApiError,
  getRepositoryCommits,
  getRepositoryDetail,
  type AuthUser,
  type CommitHistoryResponse,
  type RepositoryDetailResponse
} from "@/lib/api";
export function RepositoryCommitsPage({ user }: { user: AuthUser | null }) {
  const { owner = "", repo = "" } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const ref = search.get("ref")?.trim() || undefined;
  const oid = search.get("oid")?.trim() || null;
  const page = Math.max(Number.parseInt(search.get("page") ?? "1", 10) || 1, 1);
  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [history, setHistory] = useState<CommitHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const commit = useCommitDetail(owner, repo, oid);
  useEffect(() => {
    let canceled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [nextDetail, nextHistory] = await Promise.all([
          getRepositoryDetail(owner, repo, ref),
          getRepositoryCommits(owner, repo, { ref, page, limit: 20 })
        ]);
        if (!canceled) {
          setDetail(nextDetail);
          setHistory(nextHistory);
        }
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
  }, [owner, repo, ref, page]);
  function update(next: Record<string, string | null>) {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearch(params);
  }
  function browse(commitOid: string) {
    navigate(`/repo/${owner}/${repo}/tree/${encodeURIComponent(commitOid)}`);
  }
  if (!detail) return error ? <ErrorAlert error={error} /> : <PageLoadingState />;
  return (
    <RepositoryLayout detail={detail} user={user}>
      <BranchSelect
        detail={detail}
        disabled={loading}
        onChange={(value) => update({ ref: value, page: null, oid: null })}
      />
      <Panel>
        <ErrorAlert error={error} />
        {loading ? (
          <InlineLoadingState />
        ) : history?.commits.length ? (
          <>
            <ul className="divide-y divide-border-subtle">
              {history.commits.map((item) => (
                <li key={item.oid}>
                  <CommitRow
                    commit={item}
                    onOpen={(value) => update({ oid: value })}
                    onBrowse={browse}
                  />
                </li>
              ))}
            </ul>
            <Pagination
              page={history.pagination.page}
              hasNext={history.pagination.hasNextPage}
              disabled={loading}
              onChange={(value) => update({ page: String(value), oid: null })}
            />
          </>
        ) : (
          !error && <EmptyState title="暂无提交" description="推送首次提交后即可查看历史。" />
        )}
      </Panel>
      <RepositoryCommitDetailSheet
        open={Boolean(oid)}
        {...commit}
        onOpenChange={(open) => {
          if (!open) update({ oid: null });
        }}
        onBrowseSnapshot={browse}
      />
    </RepositoryLayout>
  );
}
