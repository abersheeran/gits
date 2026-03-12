import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { History } from "lucide-react";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import { RepositoryCommitDetailSheet } from "@/components/repository/repository-commit-detail-sheet";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  formatApiError,
  getRepositoryCommitDetail,
  getRepositoryCommits,
  getRepositoryDetail,
  type AuthUser,
  type CommitHistoryResponse,
  type RepositoryCommitDetailResponse,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime, formatRelativeTime, shortOid } from "@/lib/format";

type RepositoryCommitsPageProps = {
  user: AuthUser | null;
};

function selectedBranchName(selectedRef: string | null): string | null {
  if (!selectedRef) {
    return null;
  }
  if (selectedRef.startsWith("refs/heads/")) {
    return selectedRef.slice("refs/heads/".length);
  }
  return selectedRef;
}

function isCommitOid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value));
}

function commitTitle(message: string): string {
  return (message.split("\n")[0] ?? "").trim() || "(no message)";
}

function buildCommitSnapshotPath(owner: string, repo: string, commitOid: string): string {
  return `/repo/${owner}/${repo}/tree/${encodeURIComponent(commitOid)}`;
}

export function RepositoryCommitsPage({ user }: RepositoryCommitsPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const requestedRef = searchParams.get("ref")?.trim() || undefined;
  const selectedCommitOid = searchParams.get("oid")?.trim() || null;

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [history, setHistory] = useState<CommitHistoryResponse | null>(null);
  const [selectedCommitDetail, setSelectedCommitDetail] =
    useState<RepositoryCommitDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitDetailLoading, setCommitDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitDetailError, setCommitDetailError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function load() {
      if (!owner || !repo) {
        return;
      }

      setLoading(true);
      setError(null);
      setSelectedCommitDetail(null);
      setCommitDetailError(null);
      try {
        const [nextDetail, nextHistory] = await Promise.all([
          getRepositoryDetail(owner, repo, requestedRef),
          getRepositoryCommits(owner, repo, { ref: requestedRef, limit: 100 })
        ]);
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setHistory(nextHistory);
      } catch (loadError) {
        if (!canceled) {
          setError(formatApiError(loadError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [owner, repo, requestedRef]);

  useEffect(() => {
    let canceled = false;

    async function loadCommitDetail(targetOid: string) {
      setCommitDetailLoading(true);
      setCommitDetailError(null);
      try {
        const nextCommitDetail = await getRepositoryCommitDetail(owner, repo, targetOid);
        if (canceled) {
          return;
        }
        setSelectedCommitDetail(nextCommitDetail);
      } catch (loadError) {
        if (!canceled) {
          setSelectedCommitDetail(null);
          setCommitDetailError(formatApiError(loadError));
        }
      } finally {
        if (!canceled) {
          setCommitDetailLoading(false);
        }
      }
    }

    if (!owner || !repo || !history) {
      return;
    }

    if (!selectedCommitOid) {
      setSelectedCommitDetail(null);
      setCommitDetailError(null);
      setCommitDetailLoading(false);
      return;
    }

    setSelectedCommitDetail(null);
    void loadCommitDetail(selectedCommitOid);
    return () => {
      canceled = true;
    };
  }, [history, owner, repo, selectedCommitOid]);

  const selectedBranch = useMemo(() => selectedBranchName(detail?.selectedRef ?? null), [detail]);
  const selectedBranchInOptions =
    selectedBranch?.length && detail?.branches.some((branch) => branch.name === selectedBranch)
      ? selectedBranch
      : undefined;
  const commitShortOid =
    selectedBranch && isCommitOid(selectedBranch) ? shortOid(selectedBranch) : null;
  const commitSelectValue =
    selectedBranch && isCommitOid(selectedBranch) ? `__commit__:${selectedBranch}` : undefined;
  const selectedRefInSelect = commitSelectValue ?? selectedBranchInOptions;
  const selectedBranchLabel = selectedBranch
    ? isCommitOid(selectedBranch)
      ? `commit: ${selectedBranch}`
      : `branch: ${selectedBranch}`
    : null;
  const activeCommitOid = selectedCommitOid;

  function updateSearch(next: { ref?: string | null; oid?: string | null }) {
    const nextParams = new URLSearchParams(searchParams);
    if ("ref" in next) {
      if (next.ref) {
        nextParams.set("ref", next.ref);
      } else {
        nextParams.delete("ref");
      }
    }
    if ("oid" in next) {
      if (next.oid) {
        nextParams.set("oid", next.oid);
      } else {
        nextParams.delete("oid");
      }
    }
    setSearchParams(nextParams);
  }

  function openCommitFiles(commitOid: string) {
    navigate(buildCommitSnapshotPath(owner, repo, commitOid));
  }

  if (!owner || !repo) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>仓库路径不完整。</AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!detail || !history) {
    return (
      <PageLoadingState
        title="Loading commits"
        description={`Fetching branch history for ${owner}/${repo}.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <RepositoryHeader
        owner={owner}
        repo={repo}
        detail={detail}
        user={user}
        active="commits"
        commitCount={history.commits.length}
        selectedBranchLabel={selectedBranchLabel}
      />

      {loading ? (
        <InlineLoadingState
          title="Refreshing commits"
          description="Updating the selected ref and commit detail."
        />
      ) : null}

      <section className="page-panel overflow-hidden">
        <div className="panel-toolbar lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={selectedRefInSelect}
              onValueChange={(value) => {
                if (value.startsWith("__commit__:")) {
                  return;
                }
                updateSearch({ ref: value, oid: null });
              }}
            >
              <SelectTrigger className="h-9 w-[220px] bg-surface-base text-label-sm">
                <SelectValue placeholder="选择分支" />
              </SelectTrigger>
              <SelectContent>
                {commitSelectValue ? (
                  <SelectItem value={commitSelectValue} disabled>
                    commit: {commitShortOid}
                  </SelectItem>
                ) : null}
                {detail.branches.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-body-xs text-text-secondary">
              showing latest {history.commits.length} commits on {selectedBranchLabel ?? "default ref"}
            </span>
          </div>
        </div>

        {history.commits.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">当前引用下没有提交记录。</div>
        ) : (
          <section className="min-w-0">
            <header className="inline-flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
              <History className="h-4 w-4" />
              Commits history
            </header>
            <ul className="divide-y">
              {history.commits.map((commit) => {
                const isActive = activeCommitOid === commit.oid;
                return (
                    <li
                      key={commit.oid}
                      className={isActive ? "bg-surface-focus" : undefined}
                    >
                    <div className="flex items-start gap-3 p-4">
                      <AuthorAvatar name={commit.author.name} className="h-8 w-8 text-[11px]" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateSearch({ oid: commit.oid })}
                            className="gh-link max-w-full truncate text-left font-display text-heading-4 leading-5"
                          >
                            {commitTitle(commit.message)}
                          </button>
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {shortOid(commit.oid)}
                          </Badge>
                          {commit.parents.length > 1 ? (
                            <Badge variant="outline" className="text-[11px]">
                              merge
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          <span>{commit.author.name}</span>
                          <span>·</span>
                          <span>{formatRelativeTime(commit.author.timestamp * 1000)}</span>
                          <span>·</span>
                          <span>{formatDateTime(commit.author.timestamp * 1000)}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openCommitFiles(commit.oid)}
                      >
                        Browse snapshot
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </section>

      <RepositoryCommitDetailSheet
        open={Boolean(selectedCommitOid)}
        detail={selectedCommitDetail}
        loading={commitDetailLoading}
        error={commitDetailError}
        onOpenChange={(open) => {
          if (!open) {
            updateSearch({ oid: null });
          }
        }}
        onBrowseSnapshot={openCommitFiles}
      />
    </div>
  );
}
