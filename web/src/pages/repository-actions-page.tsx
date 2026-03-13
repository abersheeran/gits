import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { RepositoryActionsConfigPanel } from "@/components/repository/repository-actions-config-panel";
import { RepositoryActionsSessionWorkspace } from "@/components/repository/repository-actions-session-workspace";
import { RepositoryActionsSessionsPanel } from "@/components/repository/repository-actions-sessions-panel";
import { RepositoryActionsWorkflowSheet } from "@/components/repository/repository-actions-workflow-sheet";
import { RepositoryActionsWorkflowsPanel } from "@/components/repository/repository-actions-workflows-panel";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import {
  cancelRepositoryAgentSession,
  createActionWorkflow,
  dispatchActionWorkflow,
  formatApiError,
  getAgentSessionLogStreamPath,
  getRepositoryAgentSession,
  getRepositoryAgentSessionArtifactContent,
  getRepositoryAgentSessionDetail,
  getRepositoryActionsConfig,
  getRepositoryDetail,
  listActionWorkflows,
  listRepositoryAgentSessions,
  rerunRepositoryAgentSession,
  updateActionWorkflow,
  updateRepositoryActionsConfig,
  type ActionContainerInstanceType,
  type ActionWorkflowRecord,
  type AgentSessionDetail,
  type AgentSessionRecord,
  type AuthUser,
  type RepositoryActionsConfig,
  type RepositoryDetailResponse
} from "@/lib/api";
import {
  ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS,
  applyAgentSessionStreamEvent,
  insertOrReplaceSession,
  isPendingAgentSession,
  parseAgentSessionLogStreamEvent
} from "@/lib/agent-session-utils";
import { formatDateTime } from "@/lib/format";

type RepositoryActionsPageProps = {
  user: AuthUser | null;
};

type ActionsTab = "sessions" | "workflows" | "runtime";

type WorkflowSheetState =
  | { mode: "create"; workflow: null }
  | { mode: "edit"; workflow: ActionWorkflowRecord };

function dispatchRefForRepository(detail: RepositoryDetailResponse | null): string | null {
  if (!detail) {
    return null;
  }
  if (detail.selectedRef) {
    return detail.selectedRef;
  }
  if (detail.defaultBranch) {
    return `refs/heads/${detail.defaultBranch}`;
  }
  return null;
}

export function RepositoryActionsPage({ user }: RepositoryActionsPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const requestedSessionId = searchParams.get("sessionId")?.trim() || null;

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [sessions, setSessions] = useState<AgentSessionRecord[]>([]);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<AgentSessionDetail | null>(null);
  const [workflows, setWorkflows] = useState<ActionWorkflowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActionsTab>("sessions");

  const [pendingSessionAction, setPendingSessionAction] = useState<{
    sessionId: string;
    action: "cancel" | "rerun";
  } | null>(null);
  const [workflowSheetState, setWorkflowSheetState] = useState<WorkflowSheetState | null>(null);
  const [savingWorkflowId, setSavingWorkflowId] = useState<string | null>(null);
  const [savingWorkflowSheet, setSavingWorkflowSheet] = useState(false);
  const [dispatchingWorkflowId, setDispatchingWorkflowId] = useState<string | null>(null);
  const [artifactContentById, setArtifactContentById] = useState<Record<string, string>>({});
  const [loadingArtifactId, setLoadingArtifactId] = useState<string | null>(null);

  const [runnerConfig, setRunnerConfig] = useState<RepositoryActionsConfig | null>(null);
  const [loadingRunnerConfig, setLoadingRunnerConfig] = useState(false);
  const [savingRunnerConfig, setSavingRunnerConfig] = useState(false);
  const [runnerConfigAction, setRunnerConfigAction] = useState<"save" | "reset" | null>(null);
  const [runnerConfigEditing, setRunnerConfigEditing] = useState(false);
  const [runnerInstanceType, setRunnerInstanceType] =
    useState<ActionContainerInstanceType>(ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS[0].value);
  const [codexConfigFileContent, setCodexConfigFileContent] = useState("");
  const [claudeCodeConfigFileContent, setClaudeCodeConfigFileContent] = useState("");

  const mountedRef = useRef(true);
  const sessionsRef = useRef<AgentSessionRecord[]>([]);

  const canManageActions = Boolean(user) && Boolean(detail?.permissions.canManageActions);
  const dispatchRef = useMemo(() => dispatchRefForRepository(detail), [detail]);
  const selectedSessionId = requestedSessionId ?? sessions[0]?.id ?? null;
  const visibleWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.trigger_event !== "mention_actions"),
    [workflows]
  );
  const hasPendingSession = useMemo(
    () => sessions.some((session) => isPendingAgentSession(session)),
    [sessions]
  );
  const selectedSessionStreamId = selectedSessionDetail?.session.id ?? null;
  const selectedSessionIsPending = isPendingAgentSession(selectedSessionDetail?.session);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetRunnerConfigDraft = useCallback((nextConfig: RepositoryActionsConfig) => {
    setRunnerInstanceType(nextConfig.instanceType);
    setCodexConfigFileContent(nextConfig.codexConfigFileContent);
    setClaudeCodeConfigFileContent(nextConfig.claudeCodeConfigFileContent);
  }, []);

  const loadOverview = useCallback(
    async (options?: { background?: boolean }) => {
      if (!owner || !repo) {
        return;
      }
      if (!options?.background) {
        setLoading(true);
      }
      setError(null);
      try {
        const [nextDetail, nextSessions, nextWorkflows] = await Promise.all([
          getRepositoryDetail(owner, repo),
          listRepositoryAgentSessions(owner, repo, { limit: 60 }),
          listActionWorkflows(owner, repo)
        ]);

        let mergedSessions = nextSessions;
        if (requestedSessionId && !nextSessions.some((session) => session.id === requestedSessionId)) {
          try {
            const requestedSession = await getRepositoryAgentSession(owner, repo, requestedSessionId);
            mergedSessions = insertOrReplaceSession(nextSessions, requestedSession);
          } catch {
            mergedSessions = nextSessions;
          }
        }

        if (!mountedRef.current) {
          return;
        }
        setDetail(nextDetail);
        setSessions(mergedSessions);
        setWorkflows(nextWorkflows);
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
    [owner, repo, requestedSessionId]
  );

  const loadSessionDetail = useCallback(async () => {
    if (!owner || !repo || !selectedSessionId) {
      if (mountedRef.current) {
        setSelectedSessionDetail(null);
      }
      return;
    }
    setLoadingSessionDetail(true);
    try {
      const nextDetail = await getRepositoryAgentSessionDetail(owner, repo, selectedSessionId);
      if (!mountedRef.current) {
        return;
      }
      setSelectedSessionDetail(nextDetail);
      setSessions((currentSessions) => insertOrReplaceSession(currentSessions, nextDetail.session));
    } catch (loadError) {
      if (mountedRef.current) {
        setError(formatApiError(loadError));
      }
    } finally {
      if (mountedRef.current) {
        setLoadingSessionDetail(false);
      }
    }
  }, [owner, repo, selectedSessionId]);

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
  }, [canManageActions, owner, repo, resetRunnerConfigDraft]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadSessionDetail();
  }, [loadSessionDetail]);

  useEffect(() => {
    if (!canManageActions) {
      setRunnerConfig(null);
      setRunnerConfigEditing(false);
      setCodexConfigFileContent("");
      setClaudeCodeConfigFileContent("");
      return;
    }
    void loadRunnerConfig();
  }, [canManageActions, loadRunnerConfig]);

  useEffect(() => {
    if (!selectedSessionId || !owner || !repo) {
      return;
    }
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`actions-session-nav-${selectedSessionId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, [owner, repo, selectedSessionId, sessions.length]);

  useEffect(() => {
    if (!hasPendingSession) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadOverview({ background: true });
      if (selectedSessionId) {
        void loadSessionDetail();
      }
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingSession, loadOverview, loadSessionDetail, selectedSessionId]);

  useEffect(() => {
    if (!owner || !repo || !selectedSessionStreamId || !selectedSessionIsPending) {
      return;
    }

    const sessionId = selectedSessionStreamId;
    const source = new EventSource(getAgentSessionLogStreamPath(owner, repo, sessionId));

    const applyEvent = (event: ReturnType<typeof parseAgentSessionLogStreamEvent>) => {
      if (!event || !mountedRef.current) {
        return;
      }
      if (event.event === "stream-error") {
        source.close();
        void loadOverview({ background: true });
        void loadSessionDetail();
        return;
      }

      setSessions((currentSessions) => applyAgentSessionStreamEvent(currentSessions, event));
      setSelectedSessionDetail((currentDetail) => {
        if (!currentDetail || currentDetail.session.id !== sessionId) {
          return currentDetail;
        }
        const [updatedSession] = applyAgentSessionStreamEvent([currentDetail.session], event);
        return updatedSession
          ? {
              ...currentDetail,
              session: updatedSession
            }
          : currentDetail;
      });

      if (event.event === "done") {
        source.close();
        void loadOverview({ background: true });
        void loadSessionDetail();
      }
    };

    const bind = (eventName: Parameters<typeof parseAgentSessionLogStreamEvent>[0]) => {
      source.addEventListener(eventName, (message) => {
        try {
          applyEvent(
            parseAgentSessionLogStreamEvent(eventName, (message as MessageEvent<string>).data)
          );
        } catch (streamError) {
          console.error("Failed to parse agent session stream event", streamError);
          source.close();
          void loadOverview({ background: true });
          void loadSessionDetail();
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
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        void loadOverview({ background: true });
        void loadSessionDetail();
      }
    });

    return () => {
      source.close();
    };
  }, [loadOverview, loadSessionDetail, owner, repo, selectedSessionIsPending, selectedSessionStreamId]);

  function handleSelectSession(sessionId: string) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("sessionId", sessionId);
    setSearchParams(nextParams);
  }

  async function handleCancelSession(session: AgentSessionRecord) {
    if (!canManageActions || pendingSessionAction) {
      return;
    }
    setPendingSessionAction({ sessionId: session.id, action: "cancel" });
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await cancelRepositoryAgentSession(owner, repo, session.id);
      if (!mountedRef.current || !response.session) {
        return;
      }
      setSessions((currentSessions) => insertOrReplaceSession(currentSessions, response.session));
      await loadOverview({ background: true });
      await loadSessionDetail();
    } catch (cancelError) {
      if (mountedRef.current) {
        setError(formatApiError(cancelError));
      }
    } finally {
      if (mountedRef.current) {
        setPendingSessionAction(null);
      }
    }
  }

  async function handleRerunSession(session: AgentSessionRecord) {
    if (!canManageActions || pendingSessionAction) {
      return;
    }
    setPendingSessionAction({ sessionId: session.id, action: "rerun" });
    setError(null);
    setSuccessMessage(null);
    try {
      const nextSession = await rerunRepositoryAgentSession(owner, repo, session.id);
      if (!mountedRef.current) {
        return;
      }
      setSessions((currentSessions) => insertOrReplaceSession(currentSessions, nextSession));
      setSuccessMessage("已创建新的重新执行会话。");
      handleSelectSession(nextSession.id);
      await loadOverview({ background: true });
    } catch (rerunError) {
      if (mountedRef.current) {
        setError(formatApiError(rerunError));
      }
    } finally {
      if (mountedRef.current) {
        setPendingSessionAction(null);
      }
    }
  }

  async function handleLoadArtifactContent(sessionId: string, artifactId: string) {
    if (!owner || !repo || loadingArtifactId === artifactId) {
      return;
    }
    setLoadingArtifactId(artifactId);
    try {
      const response = await getRepositoryAgentSessionArtifactContent(owner, repo, sessionId, artifactId);
      if (!mountedRef.current) {
        return;
      }
      setArtifactContentById((current) => ({
        ...current,
        [artifactId]: response.content
      }));
    } catch (loadError) {
      if (mountedRef.current) {
        setError(formatApiError(loadError));
      }
    } finally {
      if (mountedRef.current) {
        setLoadingArtifactId(null);
      }
    }
  }

  async function handleSubmitWorkflow(input: {
    name: string;
    triggerEvent: ActionWorkflowRecord["trigger_event"];
    agentType: ActionWorkflowRecord["agent_type"];
    prompt: string;
    pushBranchRegex: string | null;
    pushTagRegex: string | null;
    enabled: boolean;
  }) {
    if (!workflowSheetState) {
      return;
    }
    setSavingWorkflowSheet(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const nextWorkflow =
        workflowSheetState.mode === "create"
          ? await createActionWorkflow(owner, repo, input)
          : await updateActionWorkflow(owner, repo, workflowSheetState.workflow.id, input);
      if (!mountedRef.current) {
        return;
      }
      setWorkflows((currentWorkflows) => {
        const existingIndex = currentWorkflows.findIndex((workflow) => workflow.id === nextWorkflow.id);
        if (existingIndex === -1) {
          return [nextWorkflow, ...currentWorkflows];
        }
        return currentWorkflows.map((workflow) =>
          workflow.id === nextWorkflow.id ? nextWorkflow : workflow
        );
      });
      setWorkflowSheetState(null);
      setSuccessMessage(
        workflowSheetState.mode === "create" ? "工作流已创建。" : "工作流已更新。"
      );
    } catch (workflowError) {
      if (mountedRef.current) {
        setError(formatApiError(workflowError));
      }
    } finally {
      if (mountedRef.current) {
        setSavingWorkflowSheet(false);
      }
    }
  }

  async function handleToggleWorkflowEnabled(workflow: ActionWorkflowRecord) {
    if (!canManageActions || savingWorkflowId) {
      return;
    }
    setSavingWorkflowId(workflow.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const nextWorkflow = await updateActionWorkflow(owner, repo, workflow.id, {
        enabled: workflow.enabled !== 1
      });
      if (!mountedRef.current) {
        return;
      }
      setWorkflows((currentWorkflows) =>
        currentWorkflows.map((item) => (item.id === nextWorkflow.id ? nextWorkflow : item))
      );
    } catch (workflowError) {
      if (mountedRef.current) {
        setError(formatApiError(workflowError));
      }
    } finally {
      if (mountedRef.current) {
        setSavingWorkflowId(null);
      }
    }
  }

  async function handleDispatchWorkflow(workflow: ActionWorkflowRecord) {
    if (!canManageActions || dispatchingWorkflowId) {
      return;
    }
    setDispatchingWorkflowId(workflow.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const nextSession = await dispatchActionWorkflow(owner, repo, workflow.id, dispatchRef ? { ref: dispatchRef } : undefined);
      if (!mountedRef.current) {
        return;
      }
      setSessions((currentSessions) => insertOrReplaceSession(currentSessions, nextSession));
      setSuccessMessage("已创建新的手动执行会话。");
      handleSelectSession(nextSession.id);
      setActiveTab("sessions");
      await loadOverview({ background: true });
    } catch (dispatchError) {
      if (mountedRef.current) {
        setError(formatApiError(dispatchError));
      }
    } finally {
      if (mountedRef.current) {
        setDispatchingWorkflowId(null);
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
    setSuccessMessage(null);
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
      setSuccessMessage("仓库运行时配置已保存。");
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
    setSuccessMessage(null);
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
      setSuccessMessage("仓库已恢复为继承全局运行时配置。");
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

  const runnerConfigDirty =
    !!runnerConfig &&
    (runnerInstanceType !== runnerConfig.instanceType ||
      codexConfigFileContent !== runnerConfig.codexConfigFileContent ||
      claudeCodeConfigFileContent !== runnerConfig.claudeCodeConfigFileContent);

  const sessionSummary = useMemo(
    () => ({
      total: sessions.length,
      pending: sessions.filter((session) => isPendingAgentSession(session)).length,
      failed: sessions.filter(
        (session) => session.status === "failed" || session.status === "cancelled"
      ).length
    }),
    [sessions]
  );

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
        title="正在加载 Actions"
        description={`正在同步 ${owner}/${repo} 的执行记录、工作流规则和运行时配置。`}
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

      {successMessage ? (
        <Alert>
          <AlertTitle>已完成</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <InlineLoadingState
          title="正在刷新 Actions"
          description="正在更新执行记录、工作流规则和运行时配置。"
        />
      ) : null}

      <section className="page-hero">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="space-y-2">
              <h1 className="font-display text-section-heading-mobile text-text-primary md:text-section-heading">
                Actions
              </h1>
              <p className="max-w-3xl text-body-sm text-text-secondary">
                用会话回看任务执行，用工作流决定何时触发，用运行时控制仓库级运行策略。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-surface-focus">
                {sessionSummary.total} 个会话
              </Badge>
              <Badge variant="outline" className="bg-surface-focus">
                {visibleWorkflows.length} 条工作流规则
              </Badge>
              <Badge variant="outline" className="bg-surface-focus">
                {sessionSummary.pending} 个进行中
              </Badge>
              <Badge variant="outline" className="bg-surface-focus">
                {sessionSummary.failed} 个待处理
              </Badge>
            </div>
          </div>

          <div className="panel-inset space-y-3">
            <p className="text-label-xs text-text-supporting">当前焦点</p>
            {selectedSessionDetail ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <ActionStatusBadge status={selectedSessionDetail.session.status} />
                  <Badge variant="outline">{selectedSessionDetail.session.agent_type}</Badge>
                  <Badge variant="outline">
                    {selectedSessionDetail.session.workflow_name ?? selectedSessionDetail.session.origin}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-body-sm font-medium text-text-primary">
                    会话 #{selectedSessionDetail.session.session_number}
                  </p>
                  <p className="text-body-xs text-text-secondary">
                    {selectedSessionDetail.sourceContext.title ?? "当前会话"} · 更新于{" "}
                    {formatDateTime(selectedSessionDetail.session.updated_at)}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-body-sm text-text-secondary">当前仓库还没有可聚焦的会话。</p>
            )}
          </div>
        </div>
      </section>

      <div className="segmented-control w-fit" role="tablist" aria-label="Actions 标签">
        <button
          type="button"
          className="segmented-control__item"
          data-active={activeTab === "sessions"}
          onClick={() => setActiveTab("sessions")}
        >
          会话
        </button>
        <button
          type="button"
          className="segmented-control__item"
          data-active={activeTab === "workflows"}
          onClick={() => setActiveTab("workflows")}
        >
          工作流
        </button>
        {canManageActions ? (
          <button
            type="button"
            className="segmented-control__item"
            data-active={activeTab === "runtime"}
            onClick={() => setActiveTab("runtime")}
          >
            运行时
          </button>
        ) : null}
      </div>

      {activeTab === "sessions" ? (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <RepositoryActionsSessionsPanel
            owner={owner}
            repo={repo}
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            loading={loading}
            canManageActions={canManageActions}
            pendingSessionAction={pendingSessionAction}
            onSelectSession={handleSelectSession}
            onCancelSession={handleCancelSession}
          />

          <RepositoryActionsSessionWorkspace
            owner={owner}
            repo={repo}
            detail={selectedSessionDetail}
            loading={loadingSessionDetail}
            canManageActions={canManageActions}
            pendingSessionAction={pendingSessionAction}
            artifactContentById={artifactContentById}
            loadingArtifactId={loadingArtifactId}
            onCancelSession={handleCancelSession}
            onRerunSession={handleRerunSession}
            onLoadArtifactContent={handleLoadArtifactContent}
          />
        </div>
      ) : null}

      {activeTab === "workflows" ? (
        <RepositoryActionsWorkflowsPanel
          workflows={visibleWorkflows}
          canManageActions={canManageActions}
          loading={loading}
          savingWorkflowId={savingWorkflowId}
          dispatchingWorkflowId={dispatchingWorkflowId}
          dispatchRef={dispatchRef}
          onCreate={() => setWorkflowSheetState({ mode: "create", workflow: null })}
          onEdit={(workflow) => setWorkflowSheetState({ mode: "edit", workflow })}
          onToggleEnabled={handleToggleWorkflowEnabled}
          onDispatch={handleDispatchWorkflow}
        />
      ) : null}

      {canManageActions && activeTab === "runtime" ? (
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

      <RepositoryActionsWorkflowSheet
        open={workflowSheetState !== null}
        mode={workflowSheetState?.mode ?? "create"}
        workflow={workflowSheetState?.workflow ?? null}
        saving={savingWorkflowSheet}
        onOpenChange={(open) => {
          if (!open) {
            setWorkflowSheetState(null);
          }
        }}
        onSubmit={handleSubmitWorkflow}
      />
    </div>
  );
}
