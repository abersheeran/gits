import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import {
  cancelRepositoryAgentSession,
  formatApiError,
  getRepositoryAgentSessionDetail,
  getRepositoryAgentSessionTimeline,
  getRepositoryDetail,
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
  return session?.status === "queued";
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
  if (sessionDetail.linkedRun) {
    return `/repo/${owner}/${repo}/actions?sessionId=${sessionDetail.session.id}&runId=${sessionDetail.linkedRun.id}`;
  }
  return `/repo/${owner}/${repo}/actions?sessionId=${sessionDetail.session.id}`;
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

  if (loading) {
    return (
      <div className="mx-auto w-[min(1200px,92vw)] py-10">
        <PageLoadingState
          title="Loading agent session"
          description="Fetching session metadata, source context, and timeline."
        />
      </div>
    );
  }

  if (!detail || !sessionDetail) {
    return (
      <div className="mx-auto w-[min(1200px,92vw)] py-10">
        <Alert variant="destructive">
          <AlertTitle>Agent session unavailable</AlertTitle>
          <AlertDescription>{error ?? "Unable to load the requested session."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { session, linkedRun, sourceContext } = sessionDetail;

  return (
    <div className="mx-auto flex w-[min(1200px,92vw)] flex-col gap-6 py-6">
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
        {linkedRun ? (
          <Button variant="outline" size="sm" asChild>
            <Link to={actionsLink}>View linked run</Link>
          </Button>
        ) : null}
        {canManageActions && canCancelAgentSession(session) ? (
          <PendingButton
            size="sm"
            variant="outline"
            pending={pendingAction === "cancel"}
            disabled={pendingAction !== null}
            pendingText="Cancelling..."
            onClick={() => {
              void handleCancel();
            }}
          >
            Cancel session
          </PendingButton>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="space-y-6">
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
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Session</p>
                  <p className="mt-1 break-all text-sm font-medium">{session.id}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="mt-1 text-sm font-medium">
                    {formatDuration(session.started_at, session.completed_at)}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Updated</p>
                  <p className="mt-1 text-sm font-medium">{formatDateTime(session.updated_at)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Timeline events</p>
                  <p className="mt-1 text-sm font-medium">{timeline.length}</p>
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

              <div className="rounded-md border bg-muted/20 p-3">
                <p className="mb-2 text-xs font-medium text-foreground">Prompt</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {session.prompt || "(empty prompt)"}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Linked run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {linkedRun ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">#{linkedRun.run_number}</Badge>
                    <ActionStatusBadge status={linkedRun.status} />
                    <Badge variant="outline">{linkedRun.instance_type}</Badge>
                  </div>
                  <p>
                    Workflow: <span className="text-foreground">{linkedRun.workflow_name}</span>
                  </p>
                  <p>
                    Exit code:{" "}
                    <span className="text-foreground">
                      {linkedRun.exit_code === null ? "-" : String(linkedRun.exit_code)}
                    </span>
                  </p>
                  <p>
                    Container: <span className="text-foreground">{linkedRun.container_instance ?? "-"}</span>
                  </p>
                </>
              ) : (
                <p>No linked action run.</p>
              )}
            </CardContent>
          </Card>
        </div>

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
                  <li key={event.id} className="rounded-md border bg-muted/20 p-3">
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
  );
}
