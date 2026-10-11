import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCommitDetail } from "@/hooks/use-commit-detail";
import { RepositoryLayout } from "@/components/common/repository-layout";
import { RepositoryContents } from "@/components/common/repository-contents";
import { RepositoryCodeToolbar } from "@/components/common/repository-code-toolbar";
import { PathHistorySheet } from "@/components/common/path-history-sheet";
import { BranchSelect, BranchSelectSkeleton } from "@/components/common/branch-select";
import { EmptyRepositoryGuide } from "@/components/common/empty-repository-guide";
import { ErrorAlert } from "@/components/common/error-alert";
import { Panel } from "@/components/common/panel";
import { RepositoryCommitDetailSheet } from "@/components/repository/repository-commit-detail-sheet";
import { RepositoryContentsSkeleton } from "@/components/common/code-skeletons";
import { useLoadingSkeleton } from "@/hooks/use-loading-skeleton";
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
  const showSkeleton = useLoadingSkeleton(loading, contents !== null);
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
    selectedBranchName(detail?.selectedRef ?? null) ?? ref ?? detail?.defaultBranch ?? undefined;
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
  if (!detail && error) return <ErrorAlert error={error} />;
  return (
    <RepositoryLayout owner={owner} repo={repo} detail={detail}>
      {detail && detail.branches.length === 0 && !loading && !error ? (
        <EmptyRepositoryGuide
          cloneUrl={cloneUrl}
          defaultBranch={detail.defaultBranch}
          user={user}
        />
      ) : (
        <>
          <RepositoryCodeToolbar
            owner={owner}
            repo={repo}
            kind={kind}
            path={path ?? ""}
            link={link}
            branch={
              detail ? (
                <BranchSelect
                  detail={detail}
                  disabled={loading}
                  onChange={(value) => navigate(link(kind, path ?? "", value))}
                />
              ) : (
                <BranchSelectSkeleton />
              )
            }
          />
          {showSkeleton ? (
            <RepositoryContentsSkeleton kind={kind} />
          ) : error ? (
            <Panel>
              <ErrorAlert inset error={error} />
            </Panel>
          ) : (
            contents && (
              <RepositoryContents
                key={`${contents.selectedRef}/${contents.path}`}
                loading={loading}
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
