import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Code2, GitPullRequest, MessageSquareText, Workflow } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getActionRunLogStreamPath,
  formatApiError,
  getActionRun,
  getRepositoryActionsConfig,
  getRepositoryDetail,
  listActionRuns,
  rerunActionRun,
  updateRepositoryActionsConfig,
  type ActionRunLogStreamEvent,
  type ActionRunRecord,
  type AuthUser,
  type RepositoryActionsConfig,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type RepositoryActionsPageProps = {
  user: AuthUser | null;
};

function statusBadgeVariant(status: ActionRunRecord["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") {
    return "default";
  }
  if (status === "failed" || status === "cancelled") {
    return "destructive";
  }
  if (status === "running") {
    return "secondary";
  }
  return "outline";
}

function isPendingRun(run: ActionRunRecord): boolean {
  return run.status === "queued" || run.status === "running";
}

function isActionRunStatus(value: unknown): value is ActionRunRecord["status"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function insertOrReplaceRun(currentRuns: ActionRunRecord[], nextRun: ActionRunRecord): ActionRunRecord[] {
  const existingIndex = currentRuns.findIndex((run) => run.id === nextRun.id);
  if (existingIndex === -1) {
    return [...currentRuns, nextRun].sort((left, right) => right.run_number - left.run_number);
  }

  return currentRuns.map((run) => (run.id === nextRun.id ? nextRun : run));
}

function shouldPreferCurrentRun(currentRun: ActionRunRecord, nextRun: ActionRunRecord): boolean {
  if (currentRun.updated_at !== nextRun.updated_at) {
    return currentRun.updated_at > nextRun.updated_at;
  }
  return currentRun.logs.length > nextRun.logs.length;
}

function mergeRuns(currentRuns: ActionRunRecord[], nextRuns: ActionRunRecord[]): ActionRunRecord[] {
  const mergedRuns = new Map(nextRuns.map((run) => [run.id, run] as const));

  for (const currentRun of currentRuns) {
    const nextRun = mergedRuns.get(currentRun.id);
    if (!nextRun) {
      mergedRuns.set(currentRun.id, currentRun);
      continue;
    }
    if (shouldPreferCurrentRun(currentRun, nextRun)) {
      mergedRuns.set(currentRun.id, currentRun);
    }
  }

  return Array.from(mergedRuns.values()).sort((left, right) => right.run_number - left.run_number);
}

function isActionRunRecord(value: unknown): value is ActionRunRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const run = value as Partial<ActionRunRecord>;
  return (
    typeof run.id === "string" &&
    typeof run.run_number === "number" &&
    typeof run.status === "string" &&
    typeof run.logs === "string" &&
    typeof run.updated_at === "number"
  );
}

function parseActionRunLogStreamEvent(
  eventName: ActionRunLogStreamEvent["event"],
  rawData: string
): ActionRunLogStreamEvent | null {
  type StreamStatusData = {
    runId?: unknown;
    status?: unknown;
    exitCode?: unknown;
    completedAt?: unknown;
    updatedAt?: unknown;
  };

  const parsed = JSON.parse(rawData) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (eventName === "snapshot" || eventName === "replace") {
    const data = parsed as { run?: unknown };
    return isActionRunRecord(data.run)
      ? {
          event: eventName,
          data: {
            run: data.run
          }
        }
      : null;
  }

  if (eventName === "append") {
    const data = parsed as StreamStatusData & { chunk?: unknown };
    return typeof data.runId === "string" &&
      typeof data.chunk === "string" &&
      isActionRunStatus(data.status) &&
      (typeof data.exitCode === "number" || data.exitCode === null) &&
      (typeof data.completedAt === "number" || data.completedAt === null) &&
      typeof data.updatedAt === "number"
      ? {
          event: "append",
          data: {
            runId: data.runId,
            chunk: data.chunk,
            status: data.status,
            exitCode: data.exitCode,
            completedAt: data.completedAt,
            updatedAt: data.updatedAt
          }
        }
      : null;
  }

  if (eventName === "status" || eventName === "done") {
    const data = parsed as StreamStatusData;
    return typeof data.runId === "string" &&
      isActionRunStatus(data.status) &&
      (typeof data.exitCode === "number" || data.exitCode === null) &&
      (typeof data.completedAt === "number" || data.completedAt === null) &&
      typeof data.updatedAt === "number"
      ? {
          event: eventName,
          data: {
            runId: data.runId,
            status: data.status,
            exitCode: data.exitCode,
            completedAt: data.completedAt,
            updatedAt: data.updatedAt
          }
        }
      : null;
  }

  if (eventName === "heartbeat") {
    const data = parsed as { timestamp?: unknown };
    return typeof data.timestamp === "number"
      ? {
          event: "heartbeat",
          data: {
            timestamp: data.timestamp
          }
        }
      : null;
  }

  if (eventName === "stream-error") {
    const data = parsed as { message?: unknown };
    return typeof data.message === "string"
      ? {
          event: "stream-error",
          data: {
            message: data.message
          }
        }
      : null;
  }

  return null;
}

function applyRunStreamEvent(
  currentRuns: ActionRunRecord[],
  streamEvent: ActionRunLogStreamEvent
): ActionRunRecord[] {
  if (streamEvent.event === "heartbeat" || streamEvent.event === "stream-error") {
    return currentRuns;
  }

  if (streamEvent.event === "snapshot" || streamEvent.event === "replace") {
    return insertOrReplaceRun(currentRuns, streamEvent.data.run);
  }

  if (streamEvent.event === "append") {
    return currentRuns.map((run) =>
      run.id === streamEvent.data.runId
        ? {
            ...run,
            logs: `${run.logs ?? ""}${streamEvent.data.chunk}`,
            status: streamEvent.data.status,
            exit_code: streamEvent.data.exitCode,
            completed_at: streamEvent.data.completedAt,
            updated_at: streamEvent.data.updatedAt
          }
        : run
    );
  }

  if (streamEvent.event === "status" || streamEvent.event === "done") {
    return currentRuns.map((run) =>
      run.id === streamEvent.data.runId
        ? {
            ...run,
            status: streamEvent.data.status,
            exit_code: streamEvent.data.exitCode,
            completed_at: streamEvent.data.completedAt,
            updated_at: streamEvent.data.updatedAt
          }
        : run
    );
  }

  return currentRuns;
}

export function RepositoryActionsPage({ user }: RepositoryActionsPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const [searchParams] = useSearchParams();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const selectedRunId = searchParams.get("runId")?.trim() || null;

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [runs, setRuns] = useState<ActionRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rerunningRunId, setRerunningRunId] = useState<string | null>(null);
  const [expandedRunIds, setExpandedRunIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"logs" | "config">("logs");
  const [runnerConfig, setRunnerConfig] = useState<RepositoryActionsConfig | null>(null);
  const [loadingRunnerConfig, setLoadingRunnerConfig] = useState(false);
  const [savingRunnerConfig, setSavingRunnerConfig] = useState(false);
  const [runnerConfigSuccess, setRunnerConfigSuccess] = useState<string | null>(null);

  const [codexConfigFileContent, setCodexConfigFileContent] = useState("");
  const [claudeCodeConfigFileContent, setClaudeCodeConfigFileContent] = useState("");
  const backgroundRefreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const loadDataRef = useRef<((options?: { background?: boolean }) => Promise<void>) | null>(null);
  const runsRef = useRef<ActionRunRecord[]>([]);

  const canManageActions = Boolean(user) && Boolean(detail?.permissions.canCreateIssueOrPullRequest);
  const configEditorStyle = {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
  } as const;

  const loadData = useCallback(
    async (options?: { background?: boolean }) => {
      if (!owner || !repo) {
        return;
      }

      if (!options?.background) {
        setLoading(true);
      }
      setError(null);
      try {
        const [nextDetail, nextRuns] = await Promise.all([
          getRepositoryDetail(owner, repo),
          listActionRuns(owner, repo, { limit: 50 })
        ]);
        let mergedRuns = nextRuns;
        if (selectedRunId && !nextRuns.some((run) => run.id === selectedRunId)) {
          try {
            const selectedRun = await getActionRun(owner, repo, selectedRunId);
            mergedRuns = [selectedRun, ...nextRuns]
              .filter(
                (run, index, array) => array.findIndex((item) => item.id === run.id) === index
              )
              .sort((left, right) => right.run_number - left.run_number);
          } catch {
            // Ignore missing run and keep default list.
          }
        }
        if (!mountedRef.current) {
          return;
        }
        setDetail(nextDetail);
        setRuns((currentRuns) => mergeRuns(currentRuns, mergedRuns));
      } catch (loadError) {
        if (mountedRef.current) {
          setError(formatApiError(loadError));
        }
      } finally {
        if (!options?.background && mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [owner, repo, selectedRunId]
  );

  const refreshDataInBackground = useCallback(() => {
    if (backgroundRefreshInFlightRef.current) {
      return;
    }
    backgroundRefreshInFlightRef.current = true;
    void loadDataRef.current?.({ background: true }).finally(() => {
      backgroundRefreshInFlightRef.current = false;
    });
  }, []);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadRunnerConfig = useCallback(async () => {
    if (!owner || !repo || !canManageActions) {
      return;
    }

    setLoadingRunnerConfig(true);
    try {
      const nextConfig = await getRepositoryActionsConfig(owner, repo);
      if (!mountedRef.current) {
        return;
      }
      setRunnerConfig(nextConfig);
      setCodexConfigFileContent(nextConfig.codexConfigFileContent);
      setClaudeCodeConfigFileContent(nextConfig.claudeCodeConfigFileContent);
    } catch (loadError) {
      if (mountedRef.current) {
        setError(formatApiError(loadError));
      }
    } finally {
      if (mountedRef.current) {
        setLoadingRunnerConfig(false);
      }
    }
  }, [canManageActions, owner, repo]);

  useEffect(() => {
    if (!canManageActions) {
      setRunnerConfig(null);
      setRunnerConfigSuccess(null);
      setCodexConfigFileContent("");
      setClaudeCodeConfigFileContent("");
      return;
    }
    void loadRunnerConfig();
  }, [canManageActions, loadRunnerConfig]);

  const liveExpandedRunIds = useMemo(
    () =>
      runs
        .filter((run) => expandedRunIds.includes(run.id) && isPendingRun(run))
        .map((run) => run.id)
        .sort(),
    [expandedRunIds, runs]
  );
  const liveExpandedRunIdsKey = liveExpandedRunIds.join("|");
  const hasPendingRunsWithoutLiveStream = useMemo(
    () =>
      runs.some((run) => isPendingRun(run) && !liveExpandedRunIds.includes(run.id)),
    [liveExpandedRunIds, runs]
  );

  useEffect(() => {
    if (!hasPendingRunsWithoutLiveStream) {
      return;
    }
    const timer = window.setInterval(() => {
      refreshDataInBackground();
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingRunsWithoutLiveStream, refreshDataInBackground]);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    setExpandedRunIds((current) =>
      current.includes(selectedRunId) ? current : [...current, selectedRunId]
    );
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`action-run-${selectedRunId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedRunId, runs.length]);

  useEffect(() => {
    if (!owner || !repo || liveExpandedRunIds.length === 0) {
      return;
    }

    const sources = liveExpandedRunIds.map((runId) => {
      const source = new EventSource(getActionRunLogStreamPath(owner, repo, runId));
      const handleEvent = (streamEvent: ActionRunLogStreamEvent) => {
        if (!mountedRef.current) {
          source.close();
          return;
        }
        if (streamEvent.event === "stream-error") {
          source.close();
          refreshDataInBackground();
          return;
        }
        if (
          (streamEvent.event === "append" ||
            streamEvent.event === "status" ||
            streamEvent.event === "done") &&
          !runsRef.current.some((run) => run.id === streamEvent.data.runId)
        ) {
          refreshDataInBackground();
          return;
        }
        setRuns((currentRuns) => applyRunStreamEvent(currentRuns, streamEvent));
        if (streamEvent.event === "done") {
          source.close();
        }
      };
      const bind = (eventName: ActionRunLogStreamEvent["event"]) => {
        source.addEventListener(eventName, (message) => {
          try {
            const event = parseActionRunLogStreamEvent(
              eventName,
              (message as MessageEvent<string>).data
            );
            if (!event) {
              throw new Error(`Invalid ${eventName} event payload`);
            }
            handleEvent(event);
          } catch (error) {
            console.error("Failed to parse action run stream event", error);
            source.close();
            refreshDataInBackground();
          }
        });
      };

      bind("snapshot");
      bind("append");
      bind("replace");
      bind("status");
      bind("done");
      bind("heartbeat");
      bind("stream-error");
      source.addEventListener("error", () => {
        if (!mountedRef.current) {
          source.close();
          return;
        }
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          refreshDataInBackground();
          return;
        }
        console.warn("Action run log stream error", { runId, readyState: source.readyState });
      });

      return source;
    });

    return () => {
      for (const source of sources) {
        source.close();
      }
    };
  }, [liveExpandedRunIdsKey, owner, repo]);

  async function handleRerunRun(run: ActionRunRecord) {
    if (!canManageActions || rerunningRunId) {
      return;
    }

    setRerunningRunId(run.id);
    setError(null);
    try {
      await rerunActionRun(owner, repo, run.id);
      await loadData();
    } catch (rerunError) {
      setError(formatApiError(rerunError));
    } finally {
      setRerunningRunId(null);
    }
  }

  async function handleSaveRunnerConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageActions || savingRunnerConfig) {
      return;
    }

    setSavingRunnerConfig(true);
    setError(null);
    setRunnerConfigSuccess(null);
    try {
      const nextConfig = await updateRepositoryActionsConfig(owner, repo, {
        codexConfigFileContent,
        claudeCodeConfigFileContent
      });
      if (!mountedRef.current) {
        return;
      }
      setRunnerConfig(nextConfig);
      setCodexConfigFileContent(nextConfig.codexConfigFileContent);
      setClaudeCodeConfigFileContent(nextConfig.claudeCodeConfigFileContent);
      setRunnerConfigSuccess("容器配置已保存。新的 Actions run 会使用当前仓库配置。");
    } catch (saveError) {
      if (mountedRef.current) {
        setError(formatApiError(saveError));
      }
    } finally {
      if (mountedRef.current) {
        setSavingRunnerConfig(false);
      }
    }
  }

  async function handleResetRunnerConfig() {
    if (!canManageActions || savingRunnerConfig) {
      return;
    }

    setSavingRunnerConfig(true);
    setError(null);
    setRunnerConfigSuccess(null);
    try {
      const nextConfig = await updateRepositoryActionsConfig(owner, repo, {
        codexConfigFileContent: null,
        claudeCodeConfigFileContent: null
      });
      if (!mountedRef.current) {
        return;
      }
      setRunnerConfig(nextConfig);
      setCodexConfigFileContent(nextConfig.codexConfigFileContent);
      setClaudeCodeConfigFileContent(nextConfig.claudeCodeConfigFileContent);
      setRunnerConfigSuccess("已恢复为继承全局默认容器配置。");
    } catch (resetError) {
      if (mountedRef.current) {
        setError(formatApiError(resetError));
      }
    } finally {
      if (mountedRef.current) {
        setSavingRunnerConfig(false);
      }
    }
  }

  function toggleRunLogs(runId: string) {
    setExpandedRunIds((current) =>
      current.includes(runId) ? current.filter((item) => item !== runId) : [...current, runId]
    );
  }

  if (!owner || !repo) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>仓库路径不完整。</AlertDescription>
      </Alert>
    );
  }

  if (error && !detail) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !detail) {
    return <p className="text-sm text-muted-foreground">正在加载 Actions...</p>;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {runnerConfigSuccess ? (
        <Alert>
          <AlertTitle>已保存</AlertTitle>
          <AlertDescription>{runnerConfigSuccess}</AlertDescription>
        </Alert>
      ) : null}

      <header className="space-y-3 rounded-md border bg-card p-4 shadow-sm">
        <h1 className="text-xl font-semibold">
          <Link className="gh-link" to={`/repo/${owner}/${repo}`}>
            {owner}/{repo}
          </Link>{" "}
          <span className="text-muted-foreground">/ Actions</span>
        </h1>
        <nav className="flex flex-wrap items-end gap-1 border-b border-border px-1" aria-label="Repository sections">
          <Link
            to={`/repo/${owner}/${repo}`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          >
            <Code2 className="h-4 w-4" />
            Code
          </Link>
          <Link
            to={`/repo/${owner}/${repo}/issues`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          >
            <MessageSquareText className="h-4 w-4" />
            Issues
            <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">{detail.openIssueCount}</span>
          </Link>
          <Link
            to={`/repo/${owner}/${repo}/pulls`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          >
            <GitPullRequest className="h-4 w-4" />
            Pull requests
            <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">
              {detail.openPullRequestCount}
            </span>
          </Link>
          <Link
            to={`/repo/${owner}/${repo}/actions`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-[#fd8c73] px-3 py-2 text-sm font-medium text-foreground"
          >
            <Workflow className="h-4 w-4" />
            Actions
          </Link>
        </nav>
      </header>


      {canManageActions ? (
        <div className="space-y-4">
          <div
            className="inline-flex items-center rounded-lg border bg-muted/30 p-1"
            role="tablist"
            aria-label="Actions 内容切换"
          >
            <button
              id="actions-logs-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === "logs"}
              aria-controls="actions-logs-panel"
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                activeTab === "logs"
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("logs")}
            >
              运行日志
            </button>
            <button
              id="actions-config-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === "config"}
              aria-controls="actions-config-panel"
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                activeTab === "config"
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("config")}
            >
              配置
            </button>
          </div>

          {activeTab === "config" ? (
            <Card id="actions-config-panel" role="tabpanel" aria-labelledby="actions-config-tab">
              <CardHeader>
                <CardTitle className="text-base">Cloudflare container config</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingRunnerConfig || !runnerConfig ? (
                  <p className="text-sm text-muted-foreground">正在加载容器配置...</p>
                ) : (
                  <form className="space-y-6" onSubmit={handleSaveRunnerConfig}>
                    <section className="space-y-4 rounded-md border p-4">
                      <div className="space-y-1">
                        <h2 className="text-sm font-semibold">Codex</h2>
                        <p className="text-xs text-muted-foreground">
                          {runnerConfig.inheritsGlobalCodexConfig
                            ? "当前继承全局默认值。保存后会写入当前仓库覆盖配置。"
                            : "当前使用当前仓库保存的覆盖配置。"}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="repository-codex-config-file-content">
                          配置文件内容（映射到容器 `/home/rootless/.codex/config.toml`）
                        </Label>
                        <Textarea
                          id="repository-codex-config-file-content"
                          value={codexConfigFileContent}
                          onChange={(event) => setCodexConfigFileContent(event.target.value)}
                          rows={10}
                          wrap="off"
                          spellCheck={false}
                          autoCapitalize="off"
                          autoCorrect="off"
                          autoComplete="off"
                          className="font-mono text-xs leading-5 whitespace-pre overflow-x-auto"
                          style={configEditorStyle}
                        />
                      </div>
                    </section>

                    <section className="space-y-4 rounded-md border p-4">
                      <div className="space-y-1">
                        <h2 className="text-sm font-semibold">Claude Code</h2>
                        <p className="text-xs text-muted-foreground">
                          {runnerConfig.inheritsGlobalClaudeCodeConfig
                            ? "当前继承全局默认值。保存后会写入当前仓库覆盖配置。"
                            : "当前使用当前仓库保存的覆盖配置。"}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="repository-claude-code-config-file-content">
                          配置文件内容（映射到容器 `/home/rootless/.claude/settings.json`）
                        </Label>
                        <Textarea
                          id="repository-claude-code-config-file-content"
                          value={claudeCodeConfigFileContent}
                          onChange={(event) => setClaudeCodeConfigFileContent(event.target.value)}
                          rows={10}
                          wrap="off"
                          spellCheck={false}
                          autoCapitalize="off"
                          autoCorrect="off"
                          autoComplete="off"
                          className="font-mono text-xs leading-5 whitespace-pre overflow-x-auto"
                          style={configEditorStyle}
                        />
                      </div>
                    </section>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="submit" disabled={savingRunnerConfig}>
                        {savingRunnerConfig ? "保存中..." : "保存容器配置"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={savingRunnerConfig}
                        onClick={() => {
                          void handleResetRunnerConfig();
                        }}
                      >
                        恢复全局默认
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        updated: {formatDateTime(runnerConfig.updated_at)}
                      </p>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {!canManageActions || activeTab === "logs" ? (
        <Card id="actions-logs-panel" role="tabpanel" aria-labelledby="actions-logs-tab">
          <CardHeader>
            <CardTitle className="text-base">运行日志</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <ul className="space-y-2">
                {runs.map((run) => {
                  const expanded = expandedRunIds.includes(run.id);
                  return (
                    <li
                      id={`action-run-${run.id}`}
                      key={run.id}
                      className={`space-y-2 rounded-md border p-3 ${
                        selectedRunId === run.id ? "border-[#fd8c73] bg-muted/20" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            #{run.run_number} {run.workflow_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {run.trigger_event}
                            {run.trigger_ref ? ` · ${run.trigger_ref}` : ""} · {formatDateTime(run.created_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                          <Badge variant="outline">{run.agent_type}</Badge>
                          <Badge variant="outline">
                            exit: {run.exit_code === null ? "-" : String(run.exit_code)}
                          </Badge>
                          {canManageActions ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={rerunningRunId !== null}
                              onClick={() => {
                                void handleRerunRun(run);
                              }}
                            >
                              {rerunningRunId === run.id ? "Rerunning..." : "Rerun"}
                            </Button>
                          ) : null}
                          <Button size="sm" variant="outline" onClick={() => toggleRunLogs(run.id)}>
                            {expanded ? "Hide logs" : "View logs"}
                          </Button>
                        </div>
                      </div>
                      {expanded ? (
                        <pre className="max-h-80 overflow-auto rounded-md bg-muted/30 p-2 text-xs">{run.logs || "(empty logs)"}</pre>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
