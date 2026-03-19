import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { RepositoryActionsConfigPanel } from "@/components/repository/repository-actions-config-panel";
import { RepositoryActionsSessionWorkspace } from "@/components/repository/repository-actions-session-workspace";
import { RepositoryActionsSessionsPanel } from "@/components/repository/repository-actions-sessions-panel";
import { RepositoryActionsWorkflowSheet } from "@/components/repository/repository-actions-workflow-sheet";
import { RepositoryActionsWorkflowsPanel } from "@/components/repository/repository-actions-workflows-panel";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
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
  type ActionRunnerType,
  type ActionWorkflowRecord,
  type AgentSessionDetail,
  type AgentSessionRecord,
  type AuthUser,
  type RepositoryActionsConfig,
  type RepositoryDetailResponse
} from "@/lib/api";
import {
  ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS,
  ACTION_RUNNER_TYPE_OPTIONS,
  applyAgentSessionStreamEvent,
  insertOrReplaceSession,
  isPendingAgentSession,
  parseAgentSessionLogStreamEvent
} from "@/lib/agent-session-utils";

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
  const [activeTab, setActiveTab] = useState<ActionsTab>("sessions");
  const [sessionsSheetOpen, setSessionsSheetOpen] = useState(false);

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
  const [runnerType, setRunnerType] = useState<ActionRunnerType>(
    ACTION_RUNNER_TYPE_OPTIONS[0].value
  );
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
    setRunnerType(nextConfig.runnerType);
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
      setRunnerType(ACTION_RUNNER_TYPE_OPTIONS[0].value);
      setRunnerInstanceType(ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS[0].value);
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
    setSessionsSheetOpen(false);
  }

  async function handleCancelSession(session: AgentSessionRecord) {
    if (!canManageActions || pendingSessionAction) {
      return;
    }
    setPendingSessionAction({ sessionId: session.id, action: "cancel" });
    setError(null);
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
    try {
      const nextSession = await rerunRepositoryAgentSession(owner, repo, session.id);
      if (!mountedRef.current) {
        return;
      }
      setSessions((currentSessions) => insertOrReplaceSession(currentSessions, nextSession));
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
    try {
      const nextSession = await dispatchActionWorkflow(owner, repo, workflow.id, dispatchRef ? { ref: dispatchRef } : undefined);
      if (!mountedRef.current) {
        return;
      }
      setSessions((currentSessions) => insertOrReplaceSession(currentSessions, nextSession));
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
    try {
      const nextConfig = await updateRepositoryActionsConfig(owner, repo, {
        runnerType,
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
    try {
      const nextConfig = await updateRepositoryActionsConfig(owner, repo, {
        runnerType: null,
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
    (runnerType !== runnerConfig.runnerType ||
      runnerInstanceType !== runnerConfig.instanceType ||
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
        title="正在加载 Actions"
        description={`正在同步 ${owner}/${repo} 的执行记录、工作流规则和运行时配置。`}
      />
    );
  }

  return (
    <div className="app-page">
      <RepositoryHeader owner={owner} repo={repo} detail={detail} user={user} active="actions" />

      {loading ? (
        <InlineLoadingState
          title="正在刷新 Actions"
          description="正在更新执行记录、工作流规则和运行时配置。"
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading-3-16-semibold font-display text-text-primary">Actions</h1>
        <div
          className="segmented-control ml-auto w-full sm:w-fit"
          role="tablist"
          aria-label="Actions 标签"
        >
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
      </div>

      {activeTab === "sessions" ? (
        <>
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
            onOpenSessionsList={() => setSessionsSheetOpen(true)}
          />
          <Sheet open={sessionsSheetOpen} onOpenChange={setSessionsSheetOpen}>
            <SheetContent side="left" className="w-full max-w-sm">
              <SheetHeader className="border-b border-border-subtle px-6 py-5 pr-14">
                <SheetTitle>会话列表</SheetTitle>
                <SheetDescription>筛选并选择要查看的会话。</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-6">
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
              </div>
            </SheetContent>
          </Sheet>
        </>
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
          runnerType={runnerType}
          instanceType={runnerInstanceType}
          codexConfigFileContent={codexConfigFileContent}
          claudeCodeConfigFileContent={claudeCodeConfigFileContent}
          onRunnerTypeChange={setRunnerType}
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
