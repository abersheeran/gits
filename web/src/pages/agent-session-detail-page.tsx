import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoadingState } from "@/components/ui/loading-state";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { PendingButton } from "@/components/ui/pending-button";
import {
  cancelRepositoryAgentSession,
  formatApiError,
  getRepositoryAgentSessionArtifactContent,
  getRepositoryAgentSessionDetail,
  getRepositoryAgentSessionTimeline,
  getRepositoryDetail,
  type AgentSessionArtifactRecord,
  type AgentSessionAttemptRecord,
  type AgentSessionDetail,
  type AgentSessionRecord,
  type AgentSessionTimelineEvent,
  type AuthUser,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type AgentSessionDetailPageProps = {
  user: AuthUser | null;
};

function isPendingAgentSession(session: AgentSessionRecord | null): boolean {
  return session?.status === "queued" || session?.status === "running";
}

function canCancelAgentSession(session: AgentSessionRecord | null): boolean {
  return session?.status === "queued" || session?.status === "running";
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

function sessionSourceLabel(detail: AgentSessionDetail): string {
  const number = detail.sourceContext.number ?? detail.session.source_number;
  if (number !== null) {
    return `${detail.session.source_type} #${number}`;
  }
  return detail.session.source_type;
}

function eventLabel(event: AgentSessionTimelineEvent): string {
  if (event.type === "log") {
    return event.title;
  }
  return event.title;
}

function eventBadgeLabel(event: AgentSessionTimelineEvent): string {
  if (event.type === "log") {
    return event.stream ?? "log";
  }
  return event.type.replaceAll("_", " ");
}

function buildActionsLink(owner: string, repo: string, sessionDetail: AgentSessionDetail | null): string {
  if (!sessionDetail) {
    return `/repo/${owner}/${repo}/actions`;
  }
  return `/repo/${owner}/${repo}/actions?sessionId=${sessionDetail.session.id}`;
}

function formatArtifactSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attemptStatusVariant(
  status: AgentSessionAttemptRecord["status"]
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") {
    return "default";
  }
  if (status === "failed" || status === "retryable_failed" || status === "cancelled") {
    return "destructive";
  }
  if (status === "running" || status === "booting") {
    return "secondary";
  }
  return "outline";
}

function attemptStatusLabel(status: AgentSessionAttemptRecord["status"]): string {
  return status.replaceAll("_", " ");
}

function attemptFailureLabel(attempt: AgentSessionAttemptRecord): string {
  if (!attempt.failure_reason) {
    return "-";
  }
  const stage = attempt.failure_stage ? ` · ${attempt.failure_stage}` : "";
  return `${attempt.failure_reason.replaceAll("_", " ")}${stage}`;
}

export function AgentSessionDetailPage({ user }: AgentSessionDetailPageProps) {
  const params = useParams<{ owner: string; repo: string; sessionId: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const sessionId = params.sessionId ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [sessionDetail, setSessionDetail] = useState<AgentSessionDetail | null>(null);
  const [timeline, setTimeline] = useState<AgentSessionTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"cancel" | null>(null);
  const [artifactContentById, setArtifactContentById] = useState<Record<string, string>>({});
  const [loadingArtifactId, setLoadingArtifactId] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const mountedRef = useRef(true);

  const loadData = useCallback(
    async (options?: { background?: boolean }) => {
      if (!owner || !repo || !sessionId) {
        return;
      }
      if (!options?.background) {
        setLoading(true);
      }
      setError(null);
      try {
        const [nextDetail, nextSessionDetail, nextTimeline] = await Promise.all([
          getRepositoryDetail(owner, repo),
          getRepositoryAgentSessionDetail(owner, repo, sessionId),
          getRepositoryAgentSessionTimeline(owner, repo, sessionId)
        ]);
        if (!mountedRef.current) {
          return;
        }
        setDetail(nextDetail);
        setSessionDetail(nextSessionDetail);
        setTimeline(nextTimeline);
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
    [owner, repo, sessionId]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isPendingAgentSession(sessionDetail?.session ?? null)) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadData({ background: true });
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadData, sessionDetail]);

  const canManageActions = Boolean(user) && Boolean(detail?.permissions.canManageActions);
  const actionsLink = useMemo(
    () => buildActionsLink(owner, repo, sessionDetail),
    [owner, repo, sessionDetail]
  );

  async function handleCancel(): Promise<void> {
    if (!owner || !repo || !sessionDetail || pendingAction) {
      return;
    }
    setPendingAction("cancel");
    setError(null);
    try {
      await cancelRepositoryAgentSession(owner, repo, sessionDetail.session.id);
      await loadData();
    } catch (cancelError) {
      setError(formatApiError(cancelError));
    } finally {
      setPendingAction(null);
    }
  }

  async function loadArtifactContent(artifactId: string): Promise<void> {
    if (!owner || !repo || !sessionDetail || artifactContentById[artifactId] !== undefined) {
      return;
    }
    setLoadingArtifactId(artifactId);
    setError(null);
    try {
      const response = await getRepositoryAgentSessionArtifactContent(
        owner,
        repo,
        sessionDetail.session.id,
        artifactId
      );
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

  if (loading) {
    return (
      <div className="app-page">
        <PageLoadingState
          title="Loading agent session"
          description="Loading the session overview and timeline."
        />
      </div>
    );
  }

  if (!detail || !sessionDetail) {
    return (
      <div className="app-page">
        <Alert variant="destructive">
          <AlertTitle>Agent session unavailable</AlertTitle>
          <AlertDescription>{error ?? "Unable to load the requested session."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { session, sourceContext } = sessionDetail;
  const { artifacts, attempts, events, activeAttempt, latestAttempt } = sessionDetail;

  return (
    <div className="app-page">
      <RepositoryHeader owner={owner} repo={repo} detail={detail} user={user} active="actions" />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to refresh agent session</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to={actionsLink}>Back to actions</Link>
        </Button>
        {sourceContext.url ? (
          <Button variant="outline" size="sm" asChild>
            <Link to={sourceContext.url}>Open source</Link>
          </Button>
        ) : null}
        {canManageActions && canCancelAgentSession(session) ? (
          <PendingButton
            size="sm"
            variant="outline"
            pending={pendingAction === "cancel"}
            disabled={pendingAction !== null}
            pendingText="正在取消..."
            onClick={() => {
              void handleCancel();
            }}
          >
            取消 session
          </PendingButton>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <ActionStatusBadge status={session.status} />
                <Badge variant="outline">{session.agent_type}</Badge>
                <Badge variant="outline">{session.origin}</Badge>
                <Badge variant="outline">{sessionSourceLabel(sessionDetail)}</Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="panel-card-compact">
                  <p className="text-xs text-muted-foreground">Session</p>
                  <p className="mt-1 break-all text-sm font-medium">{session.id}</p>
                </div>
                <div className="panel-card-compact">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="mt-1 text-sm font-medium">
                    {formatDuration(session.started_at, session.completed_at)}
                  </p>
                </div>
                <div className="panel-card-compact">
                  <p className="text-xs text-muted-foreground">Updated</p>
                  <p className="mt-1 text-sm font-medium">{formatDateTime(session.updated_at)}</p>
                </div>
                <div className="panel-card-compact">
                  <p className="text-xs text-muted-foreground">Attempts</p>
                  <p className="mt-1 text-sm font-medium">{attempts.length}</p>
                </div>
                <div className="panel-card-compact">
                  <p className="text-xs text-muted-foreground">Latest events</p>
                  <p className="mt-1 text-sm font-medium">{events.length}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Actor: <span className="text-foreground">{session.created_by_username ?? "system"}</span>
                </p>
                <p>
                  Delegated from:{" "}
                  <span className="text-foreground">
                    {session.delegated_from_username ?? session.created_by_username ?? "system"}
                  </span>
                </p>
                <p>
                  Workflow: <span className="text-foreground">{session.workflow_name ?? "-"}</span>
                </p>
                <p>
                  Branch: <span className="break-all text-foreground">{session.branch_ref ?? "-"}</span>
                </p>
                <p>
                  Trigger ref: <span className="break-all text-foreground">{session.trigger_ref ?? "-"}</span>
                </p>
                <p>
                  Trigger sha: <span className="break-all text-foreground">{session.trigger_sha ?? "-"}</span>
                </p>
                <p>
                  Source:{" "}
                  <span className="text-foreground">
                    {sessionSourceLabel(sessionDetail)}
                    {sourceContext.title ? ` · ${sourceContext.title}` : ""}
                  </span>
                </p>
                <p>
                  Created:{" "}
                  <span className="text-foreground">
                    {formatDateTime(session.created_at)} · {formatRelativeTime(session.created_at)}
                  </span>
                </p>
                <p>
                  Started: <span className="text-foreground">{formatDateTime(session.started_at)}</span>
                </p>
                <p>
                  Completed: <span className="text-foreground">{formatDateTime(session.completed_at)}</span>
                </p>
                {sourceContext.commentId ? (
                  <p>
                    Comment id: <span className="break-all text-foreground">{sourceContext.commentId}</span>
                  </p>
                ) : null}
              </div>

              <div className="panel-inset-compact">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">Prompt</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPromptExpanded((current) => !current)}
                  >
                    {promptExpanded ? "Hide prompt" : "Show prompt"}
                  </Button>
                </div>
                {promptExpanded ? (
                  <MonacoTextViewer
                    value={session.prompt || "(empty prompt)"}
                    path={`agent-session/${session.id}/prompt.txt`}
                    scope="agent-session-prompt"
                    className="mt-3"
                    minHeight={140}
                    maxHeight={320}
                    wrap="on"
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Execution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">#{session.session_number}</Badge>
                <ActionStatusBadge status={session.status} />
                <Badge variant="outline">{session.instance_type}</Badge>
                {activeAttempt ? <Badge variant="outline">active #{activeAttempt.attempt_number}</Badge> : null}
                {latestAttempt ? <Badge variant="outline">latest #{latestAttempt.attempt_number}</Badge> : null}
              </div>
              <p>
                Workflow: <span className="text-foreground">{session.workflow_name ?? "-"}</span>
              </p>
              <p>
                Exit code:{" "}
                <span className="text-foreground">
                  {session.exit_code === null ? "-" : String(session.exit_code)}
                </span>
              </p>
              <p>
                Container: <span className="text-foreground">{session.container_instance ?? "-"}</span>
              </p>
              <p>
                Failure: <span className="text-foreground">{session.failure_reason ?? "-"}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attempts</CardTitle>
            </CardHeader>
            <CardContent>
              {attempts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attempts recorded.</p>
              ) : (
                <ol className="space-y-3">
                  {attempts.map((attemptItem) => (
                    <li key={attemptItem.id} className="panel-inset-compact">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">#{attemptItem.attempt_number}</Badge>
                            <Badge variant={attemptStatusVariant(attemptItem.status)}>
                              {attemptStatusLabel(attemptItem.status)}
                            </Badge>
                            <Badge variant="outline">{attemptItem.instance_type}</Badge>
                            {attemptItem.promoted_from_instance_type ? (
                              <Badge variant="outline">
                                from {attemptItem.promoted_from_instance_type}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>Container: {attemptItem.container_instance ?? "-"}</p>
                            <p>
                              Exit code:{" "}
                              {attemptItem.exit_code === null ? "-" : String(attemptItem.exit_code)}
                            </p>
                            <p>Failure: {attemptFailureLabel(attemptItem)}</p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <p>{formatDateTime(attemptItem.created_at)}</p>
                          <p>{formatRelativeTime(attemptItem.created_at)}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Latest Attempt Events</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attempt events recorded.</p>
              ) : (
                <ol className="space-y-3">
                  {events
                    .slice()
                    .reverse()
                    .slice(0, 12)
                    .map((event) => (
                    <li key={event.id} className="panel-inset-compact">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{event.type.replaceAll("_", " ")}</Badge>
                            <Badge variant="outline">{event.stream}</Badge>
                          </div>
                          <p className="text-sm font-medium">{event.message}</p>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <p>{formatDateTime(event.created_at)}</p>
                          <p>{formatRelativeTime(event.created_at)}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Validation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="panel-inset-compact">
                <p className="text-sm font-medium text-foreground">
                  {sessionDetail.validationSummary.headline}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {sessionDetail.validationSummary.detail}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="panel-card-compact">
                  <p className="text-xs text-muted-foreground">Exit code</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {sessionDetail.validationSummary.exit_code === null
                      ? "-"
                      : String(sessionDetail.validationSummary.exit_code)}
                  </p>
                </div>
                <div className="panel-card-compact">
                  <p className="text-xs text-muted-foreground">Stdout</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {sessionDetail.validationSummary.stdout_chars === null
                      ? "-"
                      : `${Math.round(sessionDetail.validationSummary.stdout_chars).toLocaleString()} chars`}
                  </p>
                </div>
                <div className="panel-card-compact">
                  <p className="text-xs text-muted-foreground">Stderr</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {sessionDetail.validationSummary.stderr_chars === null
                      ? "-"
                      : `${Math.round(sessionDetail.validationSummary.stderr_chars).toLocaleString()} chars`}
                  </p>
                </div>
              </div>
              {sessionDetail.validationSummary.checks.length > 0 ? (
                <ul className="space-y-2">
                  {sessionDetail.validationSummary.checks.map((check) => (
                    <li key={`${check.kind}-${check.scope ?? "default"}-${check.command}`} className="panel-inset-compact">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{check.label}</Badge>
                        {check.scope ? <Badge variant="outline">{check.scope}</Badge> : null}
                        <Badge variant="outline">{check.status}</Badge>
                      </div>
                      <p className="mt-2 text-sm font-medium text-foreground">{check.command}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{check.summary}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Execution logs</CardTitle>
            </CardHeader>
            <CardContent>
              {artifacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No structured artifacts yet.</p>
              ) : (
                <div className="space-y-4">
                  {artifacts.map((artifact: AgentSessionArtifactRecord) => {
                    const fullContent = artifactContentById[artifact.id];
                    const showingExcerpt = fullContent === undefined;
                    return (
                      <section key={artifact.id} className="panel-inset-compact">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{artifact.kind.replaceAll("_", " ")}</Badge>
                            <span className="text-sm font-medium">{artifact.title}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatArtifactSize(artifact.size_bytes)}</span>
                            <span>{formatDateTime(artifact.updated_at)}</span>
                            {artifact.has_full_content ? (
                              <PendingButton
                                size="sm"
                                variant="outline"
                                pending={loadingArtifactId === artifact.id}
                                disabled={loadingArtifactId === artifact.id}
                                pendingText="Loading..."
                                onClick={() => {
                                  void loadArtifactContent(artifact.id);
                                }}
                              >
                                {showingExcerpt ? "Load full output" : "Refresh full output"}
                              </PendingButton>
                            ) : null}
                          </div>
                        </div>
                        <MonacoTextViewer
                          value={fullContent ?? artifact.content_text}
                          path={`agent-session/${sessionDetail.session.id}/artifact-${artifact.id}-${artifact.title}.log`}
                          scope="agent-session-artifact"
                          className="mt-3"
                          minHeight={180}
                          maxHeight={520}
                          wrap="on"
                        />
                      </section>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline events yet.</p>
              ) : (
                <ol className="space-y-3">
                  {timeline.map((event) => (
                    <li key={event.id} className="panel-inset-compact">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{eventBadgeLabel(event)}</Badge>
                            {event.stream && event.stream !== "system" ? (
                              <Badge variant="outline">{event.stream}</Badge>
                            ) : null}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{eventLabel(event)}</p>
                            {event.detail ? (
                              <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                                {event.detail}
                              </pre>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <p>{formatDateTime(event.timestamp)}</p>
                          <p>{formatRelativeTime(event.timestamp)}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
