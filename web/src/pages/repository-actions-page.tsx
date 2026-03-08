import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelRepositoryAgentSession,
  getActionRunLogStreamPath,
  getActionRunLogs,
  formatApiError,
  getActionRun,
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
import { formatDateTime } from "@/lib/format";

type RepositoryActionsPageProps = {
  user: AuthUser | null;
};

const ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS: Array<{
  value: ActionContainerInstanceType;
  label: string;
  spec: string;
}> = [
  { value: "lite", label: "lite", spec: "1/16 vCPU · 256 MiB · 2 GB" },
  { value: "basic", label: "basic", spec: "1/4 vCPU · 1 GiB · 4 GB" },
  { value: "standard-1", label: "standard-1", spec: "1/2 vCPU · 4 GiB · 8 GB" },
  { value: "standard-2", label: "standard-2", spec: "1 vCPU · 6 GiB · 12 GB" },
  { value: "standard-3", label: "standard-3", spec: "2 vCPU · 8 GiB · 16 GB" },
  { value: "standard-4", label: "standard-4", spec: "4 vCPU · 12 GiB · 20 GB" }
];

function isPendingRun(run: ActionRunRecord): boolean {
  return run.status === "queued" || run.status === "running";
}

function isPendingAgentSession(session: AgentSessionRecord): boolean {
  return session.status === "queued" || session.status === "running";
}

function formatDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt) {
    return "-";
  }
  const end = completedAt ?? Date.now();
  const totalSeconds = Math.max(Math.floor((end - startedAt) / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function runSourceLabel(run: ActionRunRecord): string {
  if (run.trigger_source_type && run.trigger_source_number) {
    return `${run.trigger_source_type} #${run.trigger_source_number}`;
  }
  return run.trigger_event;
}

function sessionSourceLabel(session: AgentSessionRecord): string {
  if (session.source_number !== null) {
    return `${session.source_type} #${session.source_number}`;
  }
  return session.source_type;
}

function canCancelAgentSession(session: AgentSessionRecord): boolean {
  return session.status === "queued";
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

function insertOrReplaceSession(
  currentSessions: AgentSessionRecord[],
  nextSession: AgentSessionRecord
): AgentSessionRecord[] {
  const existingIndex = currentSessions.findIndex((session) => session.id === nextSession.id);
  if (existingIndex === -1) {
    return [...currentSessions, nextSession].sort((left, right) => right.created_at - left.created_at);
  }

  return currentSessions.map((session) => (session.id === nextSession.id ? nextSession : session));
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
  const selectedSessionId = searchParams.get("sessionId")?.trim() || null;

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
  const [expandedRunIds, setExpandedRunIds] = useState<string[]>([]);
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
  const [runnerInstanceType, setRunnerInstanceType] = useState<ActionContainerInstanceType>("lite");
  const [codexConfigFileContent, setCodexConfigFileContent] = useState("");
  const [claudeCodeConfigFileContent, setClaudeCodeConfigFileContent] = useState("");
  const backgroundRefreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const loadDataRef = useRef<((options?: { background?: boolean }) => Promise<void>) | null>(null);
  const runsRef = useRef<ActionRunRecord[]>([]);

  const canManageActions = Boolean(user) && Boolean(detail?.permissions.canManageActions);
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
              .sort((left, right) => right.run_number - left.run_number);
          } catch {
            // Ignore missing run and keep default list.
          }
        }
        if (selectedSessionId && !nextAgentSessions.some((session) => session.id === selectedSessionId)) {
          try {
            const selectedSession = await getRepositoryAgentSession(owner, repo, selectedSessionId);
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
    [owner, repo, selectedRunId, selectedSessionId]
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
      setRunnerInstanceType(nextConfig.instanceType);
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
      setRunnerInstanceType("lite");
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
  const statusOptions = useMemo(
    () => ["all", ...Array.from(new Set(runs.map((run) => run.status))).sort()],
    [runs]
  );
  const eventOptions = useMemo(
    () => ["all", ...Array.from(new Set(runs.map((run) => run.trigger_event))).sort()],
    [runs]
  );
  const refOptions = useMemo(
    () =>
      [
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
        if (eventFilter !== "all" && run.trigger_event !== eventFilter) {
          return false;
        }
        if (refFilter !== "all" && run.trigger_ref !== refFilter) {
          return false;
        }
        if (
          actorFilter.trim() &&
          !(run.triggered_by_username ?? "").toLowerCase().includes(actorFilter.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [actorFilter, eventFilter, refFilter, runs, statusFilter]
  );
  const groupedRuns = useMemo(() => {
    const groups = new Map<string, ActionRunRecord[]>();
    for (const run of filteredRuns) {
      const current = groups.get(run.workflow_name) ?? [];
      current.push(run);
      groups.set(run.workflow_name, current);
    }
    return Array.from(groups.entries()).sort((left, right) => {
      const latestLeft = left[1][0]?.run_number ?? 0;
      const latestRight = right[1][0]?.run_number ?? 0;
      return latestRight - latestLeft;
    });
  }, [filteredRuns]);
  const runSummary = useMemo(
    () => ({
      total: filteredRuns.length,
      running: filteredRuns.filter((run) => run.status === "running" || run.status === "queued").length,
      success: filteredRuns.filter((run) => run.status === "success").length,
      failed: filteredRuns.filter((run) => run.status === "failed").length
    }),
    [filteredRuns]
  );
  const sessionSummary = useMemo(
    () => ({
      total: agentSessions.length,
      running: agentSessions.filter((session) => isPendingAgentSession(session)).length,
      success: agentSessions.filter((session) => session.status === "success").length,
      failed: agentSessions.filter((session) => session.status === "failed").length
    }),
    [agentSessions]
  );
  const hasPendingAgentSessions = useMemo(
    () => agentSessions.some((session) => isPendingAgentSession(session)),
    [agentSessions]
  );
  const selectedAgentSession = useMemo(
    () => agentSessions.find((session) => session.id === selectedSessionId) ?? null,
    [agentSessions, selectedSessionId]
  );
  const visibleAgentSessions = useMemo(() => {
    if (!selectedAgentSession) {
      return agentSessions.slice(0, 12);
    }
    return [
      selectedAgentSession,
      ...agentSessions.filter((session) => session.id !== selectedAgentSession.id)
    ].slice(0, 12);
  }, [agentSessions, selectedAgentSession]);

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
    if (!selectedSessionId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`agent-session-${selectedSessionId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedSessionId, agentSessions.length]);

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
      const nextRun = response.run;
      setAgentSessions((currentSessions) =>
        insertOrReplaceSession(currentSessions, response.session)
      );
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

  async function handleSaveRunnerConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setRunnerInstanceType(nextConfig.instanceType);
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
      setRunnerInstanceType(nextConfig.instanceType);
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

  function toggleRunLogs(runId: string) {
    const run = runsRef.current.find((item) => item.id === runId) ?? null;
    setExpandedRunIds((current) =>
      current.includes(runId) ? current.filter((item) => item !== runId) : [...current, runId]
    );
    if (run && !isPendingRun(run)) {
      void loadFullRunLogs(runId);
    }
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

  if (!detail) {
    return (
      <PageLoadingState
        title="Loading actions"
        description={`Fetching workflows, runs, and config for ${owner}/${repo}.`}
      />
    );
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

      <RepositoryHeader owner={owner} repo={repo} detail={detail} user={user} active="actions" />

      {loading ? (
        <InlineLoadingState
          title="Refreshing actions"
          description="Updating workflow runs and repository-level action config."
        />
      ) : null}


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
            <div className="space-y-4">
              <Card id="actions-config-panel" role="tabpanel" aria-labelledby="actions-config-tab">
                <CardHeader>
                  <CardTitle className="text-base">Cloudflare container config</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingRunnerConfig || !runnerConfig ? (
                    <InlineLoadingState
                      title="Loading repository config"
                      description="Fetching the inherited and overridden container settings."
                    />
                  ) : (
                    <form className="space-y-6" onSubmit={handleSaveRunnerConfig}>
                      <section className="space-y-4 rounded-md border p-4">
                        <div className="space-y-1">
                          <h2 className="text-sm font-semibold">Instance Type</h2>
                          <p className="text-xs text-muted-foreground">
                            这个设置会决定 Cloudflare container 的 CPU、内存和磁盘规格。默认值为 lite。
                          </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_1fr]">
                          <div className="space-y-2">
                            <Label htmlFor="repository-runner-instance-type">实例规格</Label>
                            <Select
                              value={runnerInstanceType}
                              onValueChange={(value) =>
                                setRunnerInstanceType(value as ActionContainerInstanceType)
                              }
                            >
                              <SelectTrigger id="repository-runner-instance-type">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="overflow-x-auto rounded-md border">
                            <table className="min-w-full text-left text-xs">
                              <thead className="bg-muted/40 text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-2 font-medium">Instance Type</th>
                                  <th className="px-3 py-2 font-medium">规格</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS.map((option) => (
                                  <tr
                                    key={option.value}
                                    className={
                                      option.value === runnerInstanceType ? "bg-muted/30" : ""
                                    }
                                  >
                                    <td className="px-3 py-2 font-mono">{option.label}</td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {option.spec}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </section>

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
                        <PendingButton
                          type="submit"
                          pending={runnerConfigAction === "save"}
                          disabled={savingRunnerConfig && runnerConfigAction !== "save"}
                          pendingText="Saving config..."
                        >
                          保存容器配置
                        </PendingButton>
                        <PendingButton
                          type="button"
                          variant="outline"
                          pending={runnerConfigAction === "reset"}
                          disabled={savingRunnerConfig && runnerConfigAction !== "reset"}
                          pendingText="Resetting..."
                          onClick={() => {
                            void handleResetRunnerConfig();
                          }}
                        >
                          恢复全局默认
                        </PendingButton>
                        <p className="text-xs text-muted-foreground">
                          updated: {formatDateTime(runnerConfig.updated_at)}
                        </p>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>

            </div>
          ) : null}
        </div>
      ) : null}

      {!canManageActions || activeTab === "logs" ? (
        <Card id="actions-logs-panel" role="tabpanel" aria-labelledby="actions-logs-tab">
          <CardHeader>
            <CardTitle className="text-base">运行日志</CardTitle>
          </CardHeader>
          <CardContent>
            <section className="mb-6 space-y-4 rounded-md border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Agent sessions</h2>
                  <p className="text-xs text-muted-foreground">
                    最近的任务级 session，会映射到具体 run、来源对象和目标分支。
                  </p>
                </div>
                <Badge variant="outline">{sessionSummary.total} sessions</Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Visible sessions</p>
                  <p className="text-2xl font-semibold">{sessionSummary.total}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Running</p>
                  <p className="text-2xl font-semibold">{sessionSummary.running}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Succeeded</p>
                  <p className="text-2xl font-semibold">{sessionSummary.success}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Failed</p>
                  <p className="text-2xl font-semibold">{sessionSummary.failed}</p>
                </div>
              </div>

              {agentSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agent sessions yet.</p>
              ) : (
                <div className="space-y-3">
                  {selectedAgentSession ? (
                    <div className="rounded-md border bg-background p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <ActionStatusBadge status={selectedAgentSession.status} />
                            <Badge variant="outline">{selectedAgentSession.agent_type}</Badge>
                            <Badge variant="outline">{sessionSourceLabel(selectedAgentSession)}</Badge>
                          </div>
                          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                            <p>Origin: {selectedAgentSession.origin}</p>
                            <p>Actor: {selectedAgentSession.created_by_username ?? "system"}</p>
                            <p>Branch: {selectedAgentSession.branch_ref ?? "-"}</p>
                            <p>Updated: {formatDateTime(selectedAgentSession.updated_at)}</p>
                            <p>Session: {selectedAgentSession.id}</p>
                            <p>Linked run: {selectedAgentSession.linked_run_id ?? "-"}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            This panel stays focused on source, status, and handoff. Prompt and full execution
                            details live in the session detail view.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedAgentSession.linked_run_id ? (
                            <Button size="sm" variant="outline" asChild>
                              <Link to={`?runId=${selectedAgentSession.linked_run_id}`}>Open linked run</Link>
                            </Button>
                          ) : null}
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/repo/${owner}/${repo}/agent-sessions/${selectedAgentSession.id}`}>
                              Open session detail
                            </Link>
                          </Button>
                        </div>
                      </div>
                      {canManageActions ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {canCancelAgentSession(selectedAgentSession) ? (
                            <PendingButton
                              size="sm"
                              variant="outline"
                              pending={
                                pendingSessionAction?.sessionId === selectedAgentSession.id &&
                                pendingSessionAction.action === "cancel"
                              }
                              disabled={pendingSessionAction !== null}
                              pendingText="Cancelling..."
                              onClick={() => {
                                void handleAgentSessionAction(selectedAgentSession);
                              }}
                            >
                              Cancel queued session
                            </PendingButton>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <ul className="space-y-2">
                    {visibleAgentSessions.map((session) => (
                      <li
                        id={`agent-session-${session.id}`}
                        key={session.id}
                        className={`rounded-md border bg-muted/20 p-3 ${
                          selectedSessionId === session.id ? "border-[#fd8c73]" : ""
                        }`}
                      >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <ActionStatusBadge status={session.status} />
                            <Badge variant="outline">{session.agent_type}</Badge>
                            <Badge variant="outline">{sessionSourceLabel(session)}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{session.origin}</span>
                            <span>branch: {session.branch_ref ?? "-"}</span>
                            <span>updated: {formatDateTime(session.updated_at)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/repo/${owner}/${repo}/agent-sessions/${session.id}`}>
                              View session
                            </Link>
                          </Button>
                          {session.linked_run_id ? (
                            <Button size="sm" variant="outline" asChild>
                              <Link to={`?runId=${session.linked_run_id}`}>
                                View run
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Visible runs</p>
                <p className="text-2xl font-semibold">{runSummary.total}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Running</p>
                <p className="text-2xl font-semibold">{runSummary.running}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Succeeded</p>
                <p className="text-2xl font-semibold">{runSummary.success}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-2xl font-semibold">{runSummary.failed}</p>
              </div>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Event</Label>
                <Select value={eventFilter} onValueChange={setEventFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {eventOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ref</Label>
                <Select value={refFilter} onValueChange={setRefFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {refOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="actions-actor-filter">Actor</Label>
                <Input
                  id="actions-actor-filter"
                  value={actorFilter}
                  onChange={(event) => setActorFilter(event.target.value)}
                  placeholder="username"
                />
              </div>
            </div>

            {filteredRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <div className="space-y-4">
                {groupedRuns.map(([workflowName, workflowRuns]) => (
                  <section key={workflowName} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{workflowName}</h3>
                      <Badge variant="outline">{workflowRuns.length} runs</Badge>
                    </div>
                    <ul className="space-y-2">
                      {workflowRuns.map((run) => {
                        const expanded = expandedRunIds.includes(run.id);
                        const fullLogs = fullRunLogsById[run.id];
                        const displayedLogs = fullLogs ?? run.logs;
                        const showingExcerpt = !isPendingRun(run) && fullLogs === undefined;
                        return (
                          <li
                            id={`action-run-${run.id}`}
                            key={run.id}
                            className={`space-y-3 rounded-md border p-3 ${
                              selectedRunId === run.id ? "border-[#fd8c73] bg-muted/20" : ""
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium">
                                    #{run.run_number} {run.workflow_name}
                                  </p>
                                  <ActionStatusBadge status={run.status} />
                                  <Badge variant="outline">{run.agent_type}</Badge>
                                  <Badge variant="outline">{run.instance_type}</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {runSourceLabel(run)}
                                  {run.trigger_ref ? ` · ${run.trigger_ref}` : ""} ·{" "}
                                  {formatDateTime(run.created_at)}
                                </p>
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <Badge variant="outline">
                                    exit: {run.exit_code === null ? "-" : String(run.exit_code)}
                                  </Badge>
                                  <Badge variant="outline">
                                    duration: {formatDuration(run.started_at, run.completed_at)}
                                  </Badge>
                                  {run.triggered_by_username ? (
                                    <Badge variant="outline">actor: {run.triggered_by_username}</Badge>
                                  ) : null}
                                  {run.trigger_sha ? (
                                    <Badge variant="outline">sha: {run.trigger_sha.slice(0, 7)}</Badge>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {canManageActions ? (
                                  <PendingButton
                                    size="sm"
                                    variant="outline"
                                    pending={rerunningRunId === run.id}
                                    disabled={rerunningRunId !== null && rerunningRunId !== run.id}
                                    pendingText="Rerunning..."
                                    onClick={() => {
                                      void handleRerunRun(run);
                                    }}
                                  >
                                    Rerun
                                  </PendingButton>
                                ) : null}
                                <Button size="sm" variant="outline" onClick={() => toggleRunLogs(run.id)}>
                                  {expanded ? "Hide details" : "View details"}
                                </Button>
                              </div>
                            </div>
                            {expanded ? (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                                    <p>Source: {runSourceLabel(run)}</p>
                                    <p>Created: {formatDateTime(run.created_at)}</p>
                                    <p>Claimed: {formatDateTime(run.claimed_at)}</p>
                                    <p>Started: {formatDateTime(run.started_at)}</p>
                                    <p>Completed: {formatDateTime(run.completed_at)}</p>
                                  </div>
                                  <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                                    <p>Container: {run.container_instance ?? "-"}</p>
                                    <p>Actor: {run.triggered_by_username ?? "-"}</p>
                                    <p>Ref: {run.trigger_ref ?? "-"}</p>
                                    <p>SHA: {run.trigger_sha ?? "-"}</p>
                                    <p>Event: {run.trigger_event}</p>
                                  </div>
                                </div>
                                <div className="rounded-md border bg-muted/20 p-3">
                                  <p className="mb-2 text-xs font-medium text-foreground">Prompt</p>
                                  <MonacoTextViewer
                                    value={run.prompt || "(empty prompt)"}
                                    path={`actions/run-${run.id}.prompt.txt`}
                                    scope="action-run-prompt"
                                    minHeight={120}
                                    maxHeight={220}
                                    wrap="on"
                                  />
                                </div>
                                <div className="rounded-md border bg-muted/20 p-3">
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-medium text-foreground">Execution logs</p>
                                      <p className="text-[11px] text-muted-foreground">
                                        {showingExcerpt
                                          ? "Showing excerpt from D1 summary. Load full logs from object storage when needed."
                                          : "Showing full execution logs."}
                                      </p>
                                    </div>
                                    {showingExcerpt ? (
                                      <PendingButton
                                        size="sm"
                                        variant="outline"
                                        pending={loadingRunLogsById[run.id] === true}
                                        disabled={loadingRunLogsById[run.id] === true}
                                        pendingText="Loading logs..."
                                        onClick={() => {
                                          void loadFullRunLogs(run.id);
                                        }}
                                      >
                                        Load full logs
                                      </PendingButton>
                                    ) : null}
                                  </div>
                                  <MonacoTextViewer
                                    value={displayedLogs || "(empty logs)"}
                                    path={`actions/run-${run.id}.log`}
                                    scope="action-run-logs"
                                    minHeight={180}
                                    maxHeight={520}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
