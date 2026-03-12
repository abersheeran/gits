import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RepositoryActionsConfigPanel } from "@/components/repository/repository-actions-config-panel";
import { RepositoryActionsLogView } from "@/components/repository/repository-actions-log-view";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import {
  cancelRepositoryAgentSession,
  formatApiError,
  getActionRun,
  getActionRunLogStreamPath,
  getActionRunLogs,
  getRepositoryAgentSession,
  getRepositoryActionsConfig,
  getRepositoryDetail,
  listActionRuns,
  listRepositoryAgentSessions,
  rerunActionRun,
  updateRepositoryActionsConfig,
  type ActionContainerInstanceType,
  type ActionRunLogStreamEvent,
  type ActionRunRecord,
  type AgentSessionRecord,
  type AuthUser,
  type RepositoryActionsConfig,
  type RepositoryDetailResponse
} from "@/lib/api";
import {
  applyRunStreamEvent,
  insertOrReplaceRun,
  insertOrReplaceSession,
  isPendingAgentSession,
  isPendingRun,
  mergeRuns,
  parseActionRunLogStreamEvent,
  runGroupLabel
} from "@/lib/action-run-utils";
import { useParams, useSearchParams } from "react-router-dom";

type RepositoryActionsPageProps = {
  user: AuthUser | null;
};

const INITIAL_SESSION_LIMIT = 8;
const SESSION_LIMIT_STEP = 8;
const INITIAL_RUN_LIMIT = 10;
const RUN_LIMIT_STEP = 10;

function ensureSelectedItemVisible(
  selectedId: string | null,
  items: Array<{ id: string }>,
  currentLimit: number
): number {
  const selectedIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;
  if (selectedIndex === -1) {
    return Math.min(currentLimit, items.length);
  }
  return Math.min(Math.max(currentLimit, selectedIndex + 1), items.length);
}

export function RepositoryActionsPage({ user }: RepositoryActionsPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const [searchParams] = useSearchParams();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const selectedRunId = searchParams.get("runId")?.trim() || null;
  const selectedSessionId = searchParams.get("sessionId")?.trim() || null;
  const selectedExecutionId = selectedSessionId ?? selectedRunId;

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [runs, setRuns] = useState<ActionRunRecord[]>([]);
  const [agentSessions, setAgentSessions] = useState<AgentSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rerunningRunId, setRerunningRunId] = useState<string | null>(null);
  const [pendingSessionAction, setPendingSessionAction] = useState<{
    sessionId: string;
    action: "cancel";
  } | null>(null);
  const [fullRunLogsById, setFullRunLogsById] = useState<Record<string, string>>({});
  const [loadingRunLogsById, setLoadingRunLogsById] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<"logs" | "config">("logs");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [refFilter, setRefFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState("");
  const [runnerConfig, setRunnerConfig] = useState<RepositoryActionsConfig | null>(null);
  const [loadingRunnerConfig, setLoadingRunnerConfig] = useState(false);
  const [savingRunnerConfig, setSavingRunnerConfig] = useState(false);
  const [runnerConfigAction, setRunnerConfigAction] = useState<"save" | "reset" | null>(null);
  const [runnerConfigSuccess, setRunnerConfigSuccess] = useState<string | null>(null);
  const [runnerConfigEditing, setRunnerConfigEditing] = useState(false);
  const [runnerInstanceType, setRunnerInstanceType] =
    useState<ActionContainerInstanceType>("lite");
  const [codexConfigFileContent, setCodexConfigFileContent] = useState("");
  const [claudeCodeConfigFileContent, setClaudeCodeConfigFileContent] = useState("");
  const [visibleSessionLimit, setVisibleSessionLimit] = useState(INITIAL_SESSION_LIMIT);
  const [visibleRunLimit, setVisibleRunLimit] = useState(INITIAL_RUN_LIMIT);

  const backgroundRefreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const loadDataRef = useRef<((options?: { background?: boolean }) => Promise<void>) | null>(null);
  const runsRef = useRef<ActionRunRecord[]>([]);

  const canManageActions = Boolean(user) && Boolean(detail?.permissions.canManageActions);

  function resetRunnerConfigDraft(nextConfig: RepositoryActionsConfig) {
    setRunnerInstanceType(nextConfig.instanceType);
    setCodexConfigFileContent(nextConfig.codexConfigFileContent);
    setClaudeCodeConfigFileContent(nextConfig.claudeCodeConfigFileContent);
  }

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
        const [nextDetail, nextRuns, nextAgentSessions] = await Promise.all([
          getRepositoryDetail(owner, repo),
          listActionRuns(owner, repo, { limit: 50 }),
          listRepositoryAgentSessions(owner, repo, { limit: 30 })
        ]);

        let mergedRuns = nextRuns;
        let mergedSessions = nextAgentSessions;

        if (selectedRunId && !nextRuns.some((run) => run.id === selectedRunId)) {
          try {
            const selectedRun = await getActionRun(owner, repo, selectedRunId);
            mergedRuns = [selectedRun, ...nextRuns]
              .filter(
                (run, index, array) => array.findIndex((item) => item.id === run.id) === index
              )
              .sort(
                (left, right) =>
                  (right.run_number ?? right.session_number) -
                  (left.run_number ?? left.session_number)
              );
          } catch {
            // Ignore missing run and keep default list.
          }
        }

        if (
          selectedExecutionId &&
          !nextAgentSessions.some((session) => session.id === selectedExecutionId)
        ) {
          try {
            const selectedSession = await getRepositoryAgentSession(
              owner,
              repo,
              selectedExecutionId
            );
            mergedSessions = [selectedSession, ...nextAgentSessions]
              .filter(
                (session, index, array) =>
                  array.findIndex((item) => item.id === session.id) === index
              )
              .sort((left, right) => right.created_at - left.created_at);
          } catch {
            // Ignore missing session and keep default list.
          }
        }

        if (!mountedRef.current) {
          return;
        }

        setDetail(nextDetail);
        setRuns((currentRuns) => mergeRuns(currentRuns, mergedRuns));
        setAgentSessions(mergedSessions);
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
    [owner, repo, selectedExecutionId, selectedRunId]
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
      resetRunnerConfigDraft(nextConfig);
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
      setRunnerConfigEditing(false);
      setRunnerInstanceType("lite");
      setCodexConfigFileContent("");
      setClaudeCodeConfigFileContent("");
      return;
    }
    void loadRunnerConfig();
  }, [canManageActions, loadRunnerConfig]);

  const focusedExecutionId = useMemo(
    () => selectedExecutionId ?? agentSessions[0]?.id ?? runs[0]?.id ?? null,
    [agentSessions, runs, selectedExecutionId]
  );

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === focusedExecutionId) ?? null,
    [focusedExecutionId, runs]
  );
  const selectedAgentSession = useMemo(
    () =>
      agentSessions.find((session) => session.id === focusedExecutionId) ??
      (selectedRun ? selectedRun : null),
    [agentSessions, focusedExecutionId, selectedRun]
  );

  const liveRunId = selectedRun && isPendingRun(selectedRun) ? selectedRun.id : null;
  const hasPendingRunsWithoutLiveStream = useMemo(
    () => runs.some((run) => isPendingRun(run) && run.id !== liveRunId),
    [liveRunId, runs]
  );
  const hasPendingAgentSessions = useMemo(
    () => agentSessions.some((session) => isPendingAgentSession(session)),
    [agentSessions]
  );

  const statusOptions = useMemo(
    () => ["all", ...Array.from(new Set(runs.map((run) => run.status))).sort()],
    [runs]
  );
  const eventOptions = useMemo(
    () => ["all", ...Array.from(new Set(runs.map((run) => runGroupLabel(run)))).sort()],
    [runs]
  );
  const refOptions = useMemo(
    () => [
      "all",
      ...Array.from(
        new Set(runs.map((run) => run.trigger_ref).filter((value): value is string => Boolean(value)))
      ).sort()
    ],
    [runs]
  );

  const filteredRuns = useMemo(
    () =>
      runs.filter((run) => {
        if (statusFilter !== "all" && run.status !== statusFilter) {
          return false;
        }
        if (eventFilter !== "all" && runGroupLabel(run) !== eventFilter) {
          return false;
        }
        if (refFilter !== "all" && run.trigger_ref !== refFilter) {
          return false;
        }
        if (
          actorFilter.trim() &&
          !(run.triggered_by_username ?? "")
            .toLowerCase()
            .includes(actorFilter.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [actorFilter, eventFilter, refFilter, runs, statusFilter]
  );

  const runSummary = useMemo(
    () => ({
      total: filteredRuns.length,
      running: filteredRuns.filter((run) => run.status === "running" || run.status === "queued")
        .length,
      success: filteredRuns.filter((run) => run.status === "success").length,
      failed: filteredRuns.filter(
        (run) => run.status === "failed" || run.status === "cancelled"
      ).length
    }),
    [filteredRuns]
  );
  const sessionSummary = useMemo(
    () => ({
      total: agentSessions.length,
      running: agentSessions.filter((session) => isPendingAgentSession(session)).length,
      success: agentSessions.filter((session) => session.status === "success").length,
      failed: agentSessions.filter(
        (session) => session.status === "failed" || session.status === "cancelled"
      ).length
    }),
    [agentSessions]
  );

  const visibleSessionCount = useMemo(
    () => ensureSelectedItemVisible(focusedExecutionId, agentSessions, visibleSessionLimit),
    [agentSessions, focusedExecutionId, visibleSessionLimit]
  );
  const visibleRunCount = useMemo(
    () => ensureSelectedItemVisible(focusedExecutionId, filteredRuns, visibleRunLimit),
    [filteredRuns, focusedExecutionId, visibleRunLimit]
  );
  const visibleAgentSessions = useMemo(
    () => agentSessions.slice(0, visibleSessionCount),
    [agentSessions, visibleSessionCount]
  );
  const visibleRuns = useMemo(
    () => filteredRuns.slice(0, visibleRunCount),
    [filteredRuns, visibleRunCount]
  );

  useEffect(() => {
    setVisibleSessionLimit(INITIAL_SESSION_LIMIT);
  }, [owner, repo]);

  useEffect(() => {
    setVisibleRunLimit(INITIAL_RUN_LIMIT);
  }, [owner, repo, statusFilter, eventFilter, refFilter, actorFilter]);

  useEffect(() => {
    if (!hasPendingRunsWithoutLiveStream && !hasPendingAgentSessions) {
      return;
    }
    const timer = window.setInterval(() => {
      refreshDataInBackground();
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingAgentSessions, hasPendingRunsWithoutLiveStream, refreshDataInBackground]);

  useEffect(() => {
    if (!focusedExecutionId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const sessionElement = document.getElementById(`actions-session-nav-${focusedExecutionId}`);
      sessionElement?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const runElement = document.getElementById(`actions-run-row-${focusedExecutionId}`);
      runElement?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, [focusedExecutionId, visibleRunCount, visibleSessionCount]);

  useEffect(() => {
    if (!owner || !repo || !liveRunId) {
      return;
    }

    const source = new EventSource(getActionRunLogStreamPath(owner, repo, liveRunId));
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
        } catch (streamError) {
          console.error("Failed to parse action run stream event", streamError);
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
      console.warn("Action run log stream error", { runId: liveRunId, readyState: source.readyState });
    });

    return () => {
      source.close();
    };
  }, [liveRunId, owner, refreshDataInBackground, repo]);

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

  async function handleAgentSessionAction(session: AgentSessionRecord) {
    if (!canManageActions || pendingSessionAction) {
      return;
    }

    setPendingSessionAction({ sessionId: session.id, action: "cancel" });
    setError(null);
    try {
      const response = await cancelRepositoryAgentSession(owner, repo, session.id);
      if (!mountedRef.current) {
        return;
      }
      setAgentSessions((currentSessions) =>
        insertOrReplaceSession(currentSessions, response.session)
      );
      const nextRun = response.run;
      if (nextRun) {
        setRuns((currentRuns) => insertOrReplaceRun(currentRuns, nextRun));
      }
      await loadData();
    } catch (sessionActionError) {
      if (mountedRef.current) {
        setError(formatApiError(sessionActionError));
      }
    } finally {
      if (mountedRef.current) {
        setPendingSessionAction(null);
      }
    }
  }

  async function handleSaveRunnerConfig() {
    if (!canManageActions || savingRunnerConfig) {
      return;
    }

    setSavingRunnerConfig(true);
    setRunnerConfigAction("save");
    setError(null);
    setRunnerConfigSuccess(null);
    try {
      const nextConfig = await updateRepositoryActionsConfig(owner, repo, {
        instanceType: runnerInstanceType,
        codexConfigFileContent,
        claudeCodeConfigFileContent
      });
      if (!mountedRef.current) {
        return;
      }
      setRunnerConfig(nextConfig);
      resetRunnerConfigDraft(nextConfig);
      setRunnerConfigEditing(false);
      setRunnerConfigSuccess("容器配置已保存。新的 Actions session 会使用当前仓库配置。");
    } catch (saveError) {
      if (mountedRef.current) {
        setError(formatApiError(saveError));
      }
    } finally {
      if (mountedRef.current) {
        setSavingRunnerConfig(false);
        setRunnerConfigAction(null);
      }
    }
  }

  async function handleResetRunnerConfig() {
    if (!canManageActions || savingRunnerConfig) {
      return;
    }

    setSavingRunnerConfig(true);
    setRunnerConfigAction("reset");
    setError(null);
    setRunnerConfigSuccess(null);
    try {
      const nextConfig = await updateRepositoryActionsConfig(owner, repo, {
        instanceType: null,
        codexConfigFileContent: null,
        claudeCodeConfigFileContent: null
      });
      if (!mountedRef.current) {
        return;
      }
      setRunnerConfig(nextConfig);
      resetRunnerConfigDraft(nextConfig);
      setRunnerConfigEditing(false);
      setRunnerConfigSuccess("已恢复为继承全局默认容器配置。");
    } catch (resetError) {
      if (mountedRef.current) {
        setError(formatApiError(resetError));
      }
    } finally {
      if (mountedRef.current) {
        setSavingRunnerConfig(false);
        setRunnerConfigAction(null);
      }
    }
  }

  async function loadFullRunLogs(runId: string) {
    if (!owner || !repo || loadingRunLogsById[runId] || fullRunLogsById[runId] !== undefined) {
      return;
    }
    setLoadingRunLogsById((current) => ({ ...current, [runId]: true }));
    try {
      const response = await getActionRunLogs(owner, repo, runId);
      if (!mountedRef.current) {
        return;
      }
      setFullRunLogsById((current) => ({ ...current, [runId]: response.logs }));
    } catch (loadError) {
      if (mountedRef.current) {
        setError(formatApiError(loadError));
      }
    } finally {
      if (mountedRef.current) {
        setLoadingRunLogsById((current) => ({ ...current, [runId]: false }));
      }
    }
  }

  function clearFilters() {
    setStatusFilter("all");
    setEventFilter("all");
    setRefFilter("all");
    setActorFilter("");
  }

  const runnerConfigDirty =
    !!runnerConfig &&
    (runnerInstanceType !== runnerConfig.instanceType ||
      codexConfigFileContent !== runnerConfig.codexConfigFileContent ||
      claudeCodeConfigFileContent !== runnerConfig.claudeCodeConfigFileContent);

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

  if (!detail) {
    return (
      <PageLoadingState
        title="Loading actions"
        description={`Fetching workflows, sessions, and config for ${owner}/${repo}.`}
      />
    );
  }

  return (
    <div className="app-page">
      <RepositoryHeader owner={owner} repo={repo} detail={detail} user={user} active="actions" />

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

      {loading ? (
        <InlineLoadingState
          title="Refreshing actions"
          description="Updating sessions, logs, and repository-level runtime config."
        />
      ) : null}

      {canManageActions ? (
        <div className="segmented-control w-fit" role="tablist" aria-label="Actions 内容切换">
          <button
            id="actions-logs-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === "logs"}
            aria-controls="actions-logs-panel"
            className="segmented-control__item"
            data-active={activeTab === "logs"}
            onClick={() => setActiveTab("logs")}
          >
            查看
          </button>
          <button
            id="actions-config-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === "config"}
            aria-controls="actions-config-panel"
            className="segmented-control__item"
            data-active={activeTab === "config"}
            onClick={() => setActiveTab("config")}
          >
            配置
          </button>
        </div>
      ) : null}

      {!canManageActions || activeTab === "logs" ? (
        <section id="actions-logs-panel" role="tabpanel" aria-labelledby="actions-logs-tab">
          <RepositoryActionsLogView
            owner={owner}
            repo={repo}
            selectedExecutionId={focusedExecutionId}
            selectedAgentSession={selectedAgentSession}
            selectedRun={selectedRun}
            sessionSummary={sessionSummary}
            runSummary={runSummary}
            agentSessions={agentSessions}
            visibleAgentSessions={visibleAgentSessions}
            filteredRuns={filteredRuns}
            visibleRuns={visibleRuns}
            canShowMoreSessions={visibleSessionCount < agentSessions.length}
            canShowMoreRuns={visibleRunCount < filteredRuns.length}
            canManageActions={canManageActions}
            pendingSessionAction={pendingSessionAction}
            rerunningRunId={rerunningRunId}
            loadingRunLogsById={loadingRunLogsById}
            fullRunLogsById={fullRunLogsById}
            statusFilter={statusFilter}
            eventFilter={eventFilter}
            refFilter={refFilter}
            actorFilter={actorFilter}
            statusOptions={statusOptions}
            eventOptions={eventOptions}
            refOptions={refOptions}
            onStatusFilterChange={setStatusFilter}
            onEventFilterChange={setEventFilter}
            onRefFilterChange={setRefFilter}
            onActorFilterChange={setActorFilter}
            onClearFilters={clearFilters}
            onShowMoreSessions={() =>
              setVisibleSessionLimit((current) => current + SESSION_LIMIT_STEP)
            }
            onShowMoreRuns={() => setVisibleRunLimit((current) => current + RUN_LIMIT_STEP)}
            onCancelSession={handleAgentSessionAction}
            onRerunRun={handleRerunRun}
            onLoadFullRunLogs={loadFullRunLogs}
          />
        </section>
      ) : null}

      {canManageActions && activeTab === "config" ? (
        <RepositoryActionsConfigPanel
          loading={loadingRunnerConfig}
          config={runnerConfig}
          editing={runnerConfigEditing}
          dirty={runnerConfigDirty}
          saving={savingRunnerConfig}
          action={runnerConfigAction}
          instanceType={runnerInstanceType}
          codexConfigFileContent={codexConfigFileContent}
          claudeCodeConfigFileContent={claudeCodeConfigFileContent}
          onInstanceTypeChange={setRunnerInstanceType}
          onCodexConfigChange={setCodexConfigFileContent}
          onClaudeCodeConfigChange={setClaudeCodeConfigFileContent}
          onStartEditing={() => {
            setRunnerConfigEditing(true);
            setError(null);
          }}
          onCancelEditing={() => {
            if (runnerConfig) {
              resetRunnerConfigDraft(runnerConfig);
            }
            setRunnerConfigEditing(false);
            setError(null);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveRunnerConfig();
          }}
          onReset={() => {
            void handleResetRunnerConfig();
          }}
        />
      ) : null}
    </div>
  );
}
