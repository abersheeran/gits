import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Github } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorAlert } from "@/components/common/error-alert";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Pagination } from "@/components/common/pagination";
import { GithubConnectionPanel } from "@/components/common/github-connection-panel";
import { GithubTokenDialog } from "@/components/common/github-token-dialog";
import { GithubSyncSkeleton } from "@/components/common/github-sync-skeleton";
import { Button } from "@/components/ui/button";
import { type AuthUser } from "@/lib/api";
import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import {
  listGithubConnections,
  deleteGithubConnection,
  type GithubConnection
} from "@/lib/github-api";
export function SyncPage({ user }: { user: AuthUser | null }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof listGithubConnections>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenTarget, setTokenTarget] = useState<string | null>(null);
  const [removing, setRemoving] = useState<GithubConnection | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!user) return;
    let canceled = false;
    listGithubConnections()
      .then((result) => {
        if (!canceled) setData(result);
      })
      .catch((cause) => {
        if (!canceled) setError(formatApiError(cause));
      });
    return () => {
      canceled = true;
    };
  }, [user]);
  async function refresh() {
    try {
      setData(await listGithubConnections());
      setError(null);
    } catch (cause) {
      setError(formatApiError(cause));
    }
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!data && !error) return <GithubSyncSkeleton />;
  const connections = data?.connections ?? [];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(connections.length / 10)));
  return (
    <>
      <PageHeader
        title="GitHub 同步"
        action={
          data?.configured && <Button onClick={() => setTokenTarget("")}>添加 GitHub 账号</Button>
        }
      />
      <ErrorAlert error={error} />
      {data && !data.configured ? (
        <Panel>
          <EmptyState
            icon={Github}
            title="尚未配置 GitHub 同步"
            description="请管理员先配置 GITHUB_TOKEN_ENCRYPTION_KEY，再添加 GitHub 账号。"
          />
        </Panel>
      ) : data && connections.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Github}
            title="还没有 GitHub 账号"
            description="添加 GitHub 账号，开始同步个人或组织的仓库。"
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {connections.slice((currentPage - 1) * 10, currentPage * 10).map((connection, index) => (
            <GithubConnectionPanel
              key={connection.id}
              connection={connection}
              announce={index === 0}
              onReplace={() => setTokenTarget(connection.id)}
              onRemove={() => setRemoving(connection)}
              onRefresh={refresh}
            />
          ))}
          <Pagination
            page={currentPage}
            hasNext={currentPage * 10 < connections.length}
            onChange={setPage}
          />
        </div>
      )}
      {tokenTarget !== null && (
        <GithubTokenDialog
          connectionId={tokenTarget || undefined}
          onClose={() => setTokenTarget(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(value) => {
          if (!value) setRemoving(null);
        }}
        title="移除 GitHub 账号"
        description={`移除「${removing?.githubLogin ?? ""}」后将停止同步。已同步的仓库会保留为普通仓库。`}
        onConfirm={async () => {
          if (removing) {
            await deleteGithubConnection(removing.id);
            await refresh();
          }
        }}
      />
    </>
  );
}
