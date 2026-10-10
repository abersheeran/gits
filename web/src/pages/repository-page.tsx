import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCommitDetail } from "@/hooks/use-commit-detail";
import { RepositoryLayout } from "@/components/common/repository-layout";
import { RepositoryContents } from "@/components/common/repository-contents";
import { PathBreadcrumbs } from "@/components/common/path-breadcrumbs";
import { PathHistorySheet } from "@/components/common/path-history-sheet";
import { BranchSelect } from "@/components/common/branch-select";
import { EmptyRepositoryGuide } from "@/components/common/empty-repository-guide";
import { ErrorAlert } from "@/components/common/error-alert";
import { Panel } from "@/components/common/panel";
import { CopyField } from "@/components/common/copy-field";
import { RepositoryCommitDetailSheet } from "@/components/repository/repository-commit-detail-sheet";
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import {
  formatApiError,
  getRepositoryCommits,
  getRepositoryContents,
  getRepositoryDetail,
  type AuthUser,
  type CommitSummary,
  type RepositoryContentsResponse,
  type RepositoryDetailResponse
} from "@/lib/api";
import {
  buildCodePath,
  decodeUriSegment,
  parseCodeSplatPath,
  selectedBranchName,
  type CodeViewKind
} from "@/lib/repository-navigation";
export function RepositoryPage({ user }: { user: AuthUser | null }) {
  const params = useParams();
  const { owner = "", repo = "" } = params;
  const navigate = useNavigate();
  const isCodePath = params.kind === "tree" || params.kind === "blob";
  const kind: CodeViewKind = params.kind === "blob" ? "blob" : "tree";
  const ref = isCodePath ? decodeUriSegment(params.ref ?? "") : undefined;
  const path = isCodePath ? parseCodeSplatPath(params["*"]) : undefined;
  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [contents, setContents] = useState<RepositoryContentsResponse | null>(null);
  const [latest, setLatest] = useState<CommitSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oid, setOid] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const commit = useCommitDetail(owner, repo, oid);
  useEffect(() => {
    if (params.kind && !isCodePath) navigate(`/repo/${owner}/${repo}`, { replace: true });
  }, [params.kind, isCodePath, navigate, owner, repo]);
  useEffect(() => {
    let canceled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setOid(null);
      setHistoryOpen(false);
      try {
        const [nextDetail, nextHistory, nextContents] = await Promise.all([
          getRepositoryDetail(owner, repo, ref),
          getRepositoryCommits(owner, repo, { ref, limit: 1 }),
          getRepositoryContents(owner, repo, { ref, path })
        ]);
        if (!canceled) {
          setDetail(nextDetail);
          setContents(nextContents);
          setLatest(nextContents.file?.latestCommit ?? nextHistory.commits[0] ?? null);
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
  }, [owner, repo, ref, path]);
  const selected =
    selectedBranchName(detail?.selectedRef ?? null) ?? detail?.defaultBranch ?? undefined;
  function link(nextKind: CodeViewKind, nextPath: string, nextRef = selected) {
    return buildCodePath({
      owner,
      repo,
      kind: nextKind,
      path: nextPath,
      ref: nextRef,
      defaultBranch: detail?.defaultBranch
    });
  }
  const cloneUrl = `${window.location.origin}/${owner}/${repo}.git`;
  if (!detail) return error ? <ErrorAlert error={error} /> : <PageLoadingState />;
  return (
    <RepositoryLayout detail={detail} user={user}>
      {detail.branches.length === 0 && !loading && !error ? (
        <EmptyRepositoryGuide
          cloneUrl={cloneUrl}
          defaultBranch={detail.defaultBranch}
          user={user}
        />
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
              <BranchSelect
                detail={detail}
                disabled={loading}
                onChange={(value) => navigate(link(kind, path ?? "", value))}
              />
              <PathBreadcrumbs repositoryName={repo} path={path ?? ""} kind={kind} link={link} />
            </div>
            <CopyField
              className="md:ml-auto md:w-96 md:shrink-0"
              value={cloneUrl}
              label="Clone 地址"
            />
          </div>
          {loading || error ? (
            <Panel>
              <ErrorAlert inset error={error} />
              {loading && <InlineLoadingState />}
            </Panel>
          ) : (
            contents && (
              <RepositoryContents
                key={`${ref}/${path}`}
                contents={contents}
                latest={latest}
                link={link}
                onHistory={() => setHistoryOpen(true)}
                onCommit={setOid}
              />
            )
          )}
        </>
      )}
      <PathHistorySheet
        key={`${ref}/${path}`}
        owner={owner}
        repo={repo}
        reference={selected}
        path={path ?? ""}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onOpenCommit={setOid}
      />
      <RepositoryCommitDetailSheet
        open={Boolean(oid)}
        {...commit}
        onOpenChange={(open) => {
          if (!open) setOid(null);
        }}
        onBrowseSnapshot={(value) => navigate(link("tree", "", value))}
      />
    </RepositoryLayout>
  );
}
