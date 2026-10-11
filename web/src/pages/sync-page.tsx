import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Github } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorAlert } from "@/components/common/error-alert";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { GithubSourceTable } from "@/components/common/github-source-table";
import { GithubSourceSettingsSheet } from "@/components/common/github-source-settings-sheet";
import { GithubSyncSkeleton, GithubTableSkeleton } from "@/components/common/github-sync-skeleton";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/api";
import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import { readGithubCallback } from "@/lib/github-callback";
import { useGithubPolling } from "@/hooks/use-github-polling";
import {
  listGithubSources,
  deleteGithubSource,
  getGithubSource,
  syncGithubSource,
  type GithubSource,
  type GithubSourceSummary,
  type GithubSourcesResponse
} from "@/lib/github-api";

export function SyncPage({ user }: { user: AuthUser | null }) {
  if (!user) return <Navigate to="/login" replace />;
  return <SyncContent />;
}
function SyncContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<GithubSourcesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callbackMessages, setCallbackMessages] = useState<string[]>(
    () => readGithubCallback(location.search).messages
  );
  const [settings, setSettings] = useState<GithubSource | null>(null);
  const [removing, setRemoving] = useState<GithubSourceSummary | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const sequence = useRef({ value: 0 });
  const refresh = useCallback(() => {
    const request = ++sequence.current.value;
    return listGithubSources().then(
      (result) => {
        if (sequence.current.value === request) {
          setData(result);
          setError(null);
        }
      },
      (cause) => {
        if (sequence.current.value === request) setError(formatApiError(cause));
      }
    );
  }, []);
  useGithubPolling(Boolean(data?.configured), refresh);
  useEffect(() => {
    const counter = sequence.current;
    void refresh();
    return () => {
      counter.value++;
    };
  }, [refresh]);
  useEffect(() => {
    const callback = readGithubCallback(location.search);
    if (!callback.present) return;
    let canceled = false;
    // Retain the one-time result in memory, never in history state or storage.
    queueMicrotask(() => {
      if (canceled) return;
      setCallbackMessages(callback.messages);
      navigate(
        { pathname: location.pathname, search: callback.search, hash: location.hash },
        { replace: true }
      );
      void refresh();
    });
    return () => {
      canceled = true;
    };
  }, [location.pathname, location.search, location.hash, navigate, refresh]);
  async function act(source: GithubSourceSummary, action: () => Promise<void>) {
    setPendingId(source.id);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setPendingId(null);
    }
  }
  const actions = data?.configured && (
    <div className="flex flex-wrap justify-center gap-2 md:justify-start">
      {data.installUrl && (
        <Button asChild>
          <a href={data.installUrl}>添加账号或组织</a>
        </Button>
      )}
      <Button asChild variant="secondary">
        <a href="/api/github/authorize">关联已有安装</a>
      </Button>
    </div>
  );
  if (!data && !error && callbackMessages.length === 0) return <GithubSyncSkeleton />;
  return (
    <>
      <PageHeader title="GitHub 同步" action={actions} />
      {callbackMessages.length > 0 && (
        <div className="mb-4 space-y-4">
          {callbackMessages.map((message, index) => (
            <ErrorAlert key={index} error={message} />
          ))}
        </div>
      )}
      <Panel>
        <ErrorAlert inset error={error} />
        {!data ? (
          !error && <GithubTableSkeleton sources />
        ) : !data.configured ? (
          <EmptyState
            icon={Github}
            title="尚未配置 GitHub App"
            description="请联系部署者配置 GitHub App 后，再添加账号或组织。"
          />
        ) : data.sources.length === 0 ? (
          <EmptyState
            icon={Github}
            title="还没有同步源"
            description="添加账号或组织，或关联已有安装，开始同步 GitHub 仓库。"
          />
        ) : (
          <GithubSourceTable
            sources={data.sources}
            pendingId={pendingId}
            onSync={(source) =>
              void act(source, async () => {
                await syncGithubSource(source.id);
                await refresh();
              })
            }
            onSettings={(source) =>
              void act(source, async () => {
                setSettings((await getGithubSource(source.id)).source);
              })
            }
            onUnlink={setRemoving}
          />
        )}
      </Panel>
      {settings && (
        <GithubSourceSettingsSheet
          accountLogin={settings.accountLogin}
          sourceId={settings.id}
          initial={settings}
          onClose={() => setSettings(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(value) => {
          if (!value) setRemoving(null);
        }}
        title="解除绑定"
        description={`解除「${removing?.accountLogin ?? ""}」的绑定后，已同步的仓库会保留为普通仓库，GitHub 上的 App 安装不会被卸载。`}
        onConfirm={async () => {
          if (removing) {
            await deleteGithubSource(removing.id);
            await refresh();
          }
        }}
      />
    </>
  );
}
