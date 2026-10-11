import { githubErrorMessage } from "@/lib/github-errors";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Settings } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { ErrorAlert } from "@/components/common/error-alert";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Pagination } from "@/components/common/pagination";
import { RelativeTime } from "@/components/common/relative-time";
import { GithubAvatar } from "@/components/common/github-avatar";
import { GithubSyncSkeleton, GithubTableSkeleton } from "@/components/common/github-sync-skeleton";
import { GithubSourceSettingsSheet } from "@/components/common/github-source-settings-sheet";
import { GithubRepositoryTable } from "@/components/common/github-repository-table";
import { GithubLocalNameDialog } from "@/components/common/github-local-name-dialog";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { cn } from "@/lib/utils";
import { type AuthUser } from "@/lib/api";
import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import { useGithubSource } from "@/hooks/use-github-source";
import {
  syncGithubSource,
  syncRepositoryMirror,
  updateGithubRepository,
  type GithubRemoteRepository,
  type GithubRepositoryFilter
} from "@/lib/github-api";

export function SyncSourcePage({ user }: { user: AuthUser | null }) {
  const { sourceId = "" } = useParams();
  if (!user) return <Navigate to="/login" replace />;
  return <SourceContent key={sourceId} sourceId={sourceId} />;
}
function SourceContent({ sourceId }: { sourceId: string }) {
  const [search, setSearch] = useSearchParams();
  const statusParam = search.get("status") ?? "all";
  const status = (
    ["all", "synced", "attention", "excluded"].includes(statusParam) ? statusParam : "all"
  ) as GithubRepositoryFilter;
  const pageParam = Number(search.get("page") ?? 1);
  const page = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const { source, repositories, error, refresh } = useGithubSource(sourceId, status, page);
  const [settings, setSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<GithubRemoteRepository | null>(null);
  const [renaming, setRenaming] = useState<GithubRemoteRepository | null>(null);
  useEffect(() => {
    if (source) document.title = `${source.ownerLogin} · GitHub 同步 · gits`;
  }, [source]);
  function navigate(filter: GithubRepositoryFilter, nextPage: number) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.set("status", filter);
      next.set("page", String(nextPage));
      return next;
    });
  }
  async function act(item: GithubRemoteRepository, action: () => Promise<unknown>) {
    setPendingId(item.githubRepoId);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setActionError(formatApiError(cause));
    } finally {
      setPendingId(null);
    }
  }
  if (!source && !error) return <GithubSyncSkeleton source />;
  const counts = source?.counts;
  const filters: Array<[GithubRepositoryFilter, string, number]> = counts
    ? [
        ["all", "全部", Object.values(counts).reduce((sum, count) => sum + count, 0)],
        ["synced", "已同步", counts.synced],
        [
          "attention",
          "需处理",
          counts.failed + counts.too_large + counts.name_conflict + counts.missing
        ],
        ["excluded", "未同步", counts.excluded]
      ]
    : [];
  return (
    <>
      <Button asChild size="sm" variant="ghost" className="mb-4">
        <Link to="/sync">
          <ArrowLeft className="size-4" />
          返回同步
        </Link>
      </Button>
      <PageHeader
        title={
          source ? (
            <span className="flex items-center gap-2">
              <GithubAvatar login={source.ownerLogin} url={source.avatarUrl} />
              <span className="min-w-0 break-all">{source.ownerLogin}</span>
            </span>
          ) : (
            "GitHub 同步"
          )
        }
        description={
          source && (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {source.status === "ok"
                  ? "正常"
                  : source.status === "paused"
                    ? "已暂停"
                    : source.status === "sso_required"
                      ? "需要 SSO 授权"
                      : "失败"}
              </span>
              <span>
                上次同步 <RelativeTime timestamp={source.lastDiscoveredAt} />
              </span>
            </span>
          )
        }
        action={
          source && (
            <div className="flex gap-2">
              <PendingButton
                pending={syncing}
                pendingText="同步中…"
                onClick={async () => {
                  setSyncing(true);
                  setActionError(null);
                  try {
                    await syncGithubSource(sourceId);
                    await refresh();
                  } catch (cause) {
                    setActionError(formatApiError(cause));
                  } finally {
                    setSyncing(false);
                  }
                }}
              >
                立即同步
              </PendingButton>
              <Button variant="outline" onClick={() => setSettings(true)}>
                <Settings className="size-4" />
                设置
              </Button>
            </div>
          )
        }
      />
      {source?.lastError && <ErrorAlert error={githubErrorMessage(source.lastError)} />}
      {source && (
        <nav aria-label="同步状态筛选" className="mb-4 flex min-w-0 border-b border-border">
          {filters.map(([filter, label, count]) => (
            <button
              key={filter}
              type="button"
              aria-current={status === filter ? "page" : undefined}
              onClick={() => navigate(filter, 1)}
              className={cn(
                "min-h-10 flex-1 border-b-2 px-1 py-3 text-body-xs md:flex-none md:px-4",
                status === filter
                  ? "border-text-primary text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              )}
            >
              {label}
              <span className="ml-1 text-body-micro text-text-tertiary">{count}</span>
            </button>
          ))}
        </nav>
      )}
      <Panel>
        <ErrorAlert inset error={error ?? actionError} />
        {!repositories ? (
          !error && <GithubTableSkeleton />
        ) : (
          <>
            {repositories.items.length === 0 ? (
              <EmptyState
                title="暂无仓库"
                description={
                  status === "all"
                    ? "立即同步以发现 GitHub 仓库。"
                    : "此状态下暂无仓库，可切换筛选查看。"
                }
              />
            ) : (
              <GithubRepositoryTable
                items={repositories.items}
                pendingId={pendingId}
                onSync={(item) =>
                  void act(item, () =>
                    syncRepositoryMirror(item.repository!.owner, item.repository!.name)
                  )
                }
                onInclude={(item) =>
                  void act(item, () =>
                    updateGithubRepository(sourceId, item.githubRepoId, {
                      selection: "include"
                    })
                  )
                }
                onExclude={setExcluding}
                onRename={setRenaming}
              />
            )}
            <Pagination
              page={repositories.page}
              hasNext={repositories.hasNextPage}
              onChange={(next) => navigate(status, next)}
              disabled={pendingId !== null}
            />
          </>
        )}
      </Panel>
      {source && settings && (
        <GithubSourceSettingsSheet
          ownerLogin={source.ownerLogin}
          connectionId={source.connectionId}
          sourceId={source.id}
          initial={source}
          onClose={() => setSettings(false)}
          onSaved={refresh}
        />
      )}
      {renaming && (
        <GithubLocalNameDialog
          sourceId={sourceId}
          item={renaming}
          onClose={() => setRenaming(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={excluding !== null}
        onOpenChange={(value) => {
          if (!value) setExcluding(null);
        }}
        title={excluding?.repository ? "停止同步" : "排除仓库"}
        description={
          excluding?.repository
            ? `停止同步「${excluding.fullName}」后，仓库会保留并恢复可写。`
            : `排除「${excluding?.fullName ?? ""}」后将不再同步，可随时重新纳入。`
        }
        onConfirm={async () => {
          if (excluding) {
            await updateGithubRepository(sourceId, excluding.githubRepoId, {
              selection: "exclude"
            });
            await refresh();
          }
        }}
      />
    </>
  );
}
