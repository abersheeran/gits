import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import type {
  AgentSessionArtifactRecord,
  AgentSessionAttemptRecord,
  AgentSessionDetail
} from "@/lib/api";
import {
  canCancelAgentSession,
  formatSessionDuration,
  sessionSourceLabel,
  sessionWorkflowLabel
} from "@/lib/agent-session-utils";
import { formatDateTime } from "@/lib/format";

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

type RepositoryActionsSessionWorkspaceProps = {
  owner: string;
  repo: string;
  detail: AgentSessionDetail | null;
  loading: boolean;
  canManageActions: boolean;
  pendingSessionAction: {
    sessionId: string;
    action: "cancel" | "rerun";
  } | null;
  artifactContentById: Record<string, string>;
  loadingArtifactId: string | null;
  onCancelSession: (session: AgentSessionDetail["session"]) => void;
  onRerunSession: (session: AgentSessionDetail["session"]) => void;
  onLoadArtifactContent: (sessionId: string, artifactId: string) => void;
  onOpenSessionsList: () => void;
};

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

function eventStreamLabel(stream: string): string {
  return stream === "system" ? "system" : stream;
}

function selectedArtifactContent(
  artifact: AgentSessionArtifactRecord | null,
  detail: AgentSessionDetail,
  artifactContentById: Record<string, string>
): string {
  if (!artifact) {
    return "";
  }
  const loadedContent = artifactContentById[artifact.id];
  if (loadedContent !== undefined) {
    return loadedContent;
  }
  if (artifact.kind === "session_logs" && detail.session.logs.trim()) {
    return detail.session.logs;
  }
  return artifact.content_text;
}

export function RepositoryActionsSessionWorkspace({
  owner,
  repo,
  detail,
  loading,
  canManageActions,
  pendingSessionAction,
  artifactContentById,
  loadingArtifactId,
  onCancelSession,
  onRerunSession,
  onLoadArtifactContent,
  onOpenSessionsList
}: RepositoryActionsSessionWorkspaceProps) {
  const [promptSheetOpen, setPromptSheetOpen] = useState(false);
  const [logsSheetOpen, setLogsSheetOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  useEffect(() => {
    if (!detail) {
      setSelectedArtifactId(null);
      return;
    }
    const nextArtifact =
      detail.artifacts.find((artifact) => artifact.kind === "session_logs") ??
      detail.artifacts[0] ??
      null;
    setSelectedArtifactId(nextArtifact?.id ?? null);
  }, [detail]);

  const selectedArtifact = useMemo(
    () => detail?.artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null,
    [detail, selectedArtifactId]
  );

  if (loading && !detail) {
    return (
      <section className="page-panel">
        <div className="panel-content">
          <div className="space-y-3 rounded-[16px] border border-dashed border-border-subtle bg-surface-focus px-4 py-4 text-center">
            <p className="text-body-sm text-text-secondary">正在加载会话工作区...</p>
            <Button size="sm" variant="outline" onClick={onOpenSessionsList}>
              选择会话
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="page-panel">
        <div className="panel-content">
          <div className="space-y-3 rounded-[16px] border border-dashed border-border-subtle bg-surface-focus px-4 py-4 text-center">
            <p className="text-body-sm text-text-secondary">选择一个会话查看摘要与日志。</p>
            <Button size="sm" variant="outline" onClick={onOpenSessionsList}>
              选择会话
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const session = detail.session;
  const latestAttempt = detail.latestAttempt;
  const validation = detail.validationSummary;
  const artifact = selectedArtifact;
  const artifactContent = artifact
    ? selectedArtifactContent(artifact, detail, artifactContentById)
    : "";

  return (
    <section className="page-panel">
      <div className="panel-content space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ActionStatusBadge status={session.status} />
              <Badge variant="outline">{sessionSourceLabel(session)}</Badge>
              <Badge variant="outline">{session.agent_type}</Badge>
              <Badge variant="outline">{session.instance_type}</Badge>
              <Badge variant="outline">{session.runner_type === "local" ? "Local" : "Cloud"}</Badge>
              {session.runner_type === "local" &&
              session.status === "running" &&
              latestAttempt?.updated_at ? (
                <Badge variant="outline" className="text-text-tertiary">
                  heartbeat {formatRelativeTime(latestAttempt.updated_at)}
                </Badge>
              ) : null}
              <Badge variant="outline">{sessionWorkflowLabel(session)}</Badge>
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-heading-3-16-semibold text-text-primary">
                会话 #{session.session_number}
              </h2>
              <p className="text-body-sm text-text-secondary">
                {detail.sourceContext.title ?? sessionSourceLabel(session)} · 更新于{" "}
                {formatDateTime(session.updated_at)}
              </p>
              <p className="text-body-xs text-text-secondary">
                发起人 {session.created_by_username ?? "system"} · 耗时{" "}
                {formatSessionDuration(session.started_at, session.completed_at)} · 执行轮次{" "}
                {detail.attempts.length}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to={`/repo/${owner}/${repo}/agent-sessions/${session.id}`}>查看详情</Link>
            </Button>
            {canManageActions ? (
              <PendingButton
                size="sm"
                variant="outline"
                pending={
                  pendingSessionAction?.sessionId === session.id &&
                  pendingSessionAction.action === "rerun"
                }
                disabled={pendingSessionAction !== null}
                pendingText="正在重新执行..."
                onClick={() => onRerunSession(session)}
              >
                重新执行
              </PendingButton>
            ) : null}
            {canManageActions && canCancelAgentSession(session) ? (
              <PendingButton
                size="sm"
                variant="outline"
                pending={
                  pendingSessionAction?.sessionId === session.id &&
                  pendingSessionAction.action === "cancel"
                }
                disabled={pendingSessionAction !== null}
                pendingText="正在取消..."
                onClick={() => onCancelSession(session)}
              >
                取消会话
              </PendingButton>
            ) : null}
          </div>
        </div>

        <div className="panel-inset space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ActionStatusBadge status={validation.status ?? session.status} />
            {validation.exit_code !== null ? (
              <Badge variant="outline">exit {validation.exit_code}</Badge>
            ) : null}
            {validation.duration_ms !== null ? (
              <Badge variant="outline">{Math.round(validation.duration_ms)} ms</Badge>
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-body-sm font-medium text-text-primary">{validation.headline}</p>
            <p className="text-body-sm text-text-secondary">{validation.detail}</p>
          </div>

          {validation.checks.length > 0 ? (
            <div className="space-y-2">
              {validation.checks.map((check) => (
                <div
                  key={`${check.kind}-${check.command}-${check.scope ?? "default"}`}
                  className="rounded-[12px] bg-surface-base px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-body-xs text-text-secondary">
                    <Badge variant="outline">{check.label}</Badge>
                    {check.scope ? <Badge variant="outline">{check.scope}</Badge> : null}
                    <Badge variant="outline">{check.status}</Badge>
                    <span className="text-body-sm font-medium text-text-primary">
                      {check.command}
                    </span>
                    <span>{check.summary}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <p className="text-label-xs text-text-supporting">执行轮次</p>
          {detail.attempts.length === 0 ? (
            <div className="panel-inset-compact text-body-sm text-text-secondary">
              还没有执行轮次记录。
            </div>
          ) : (
            <ol className="flex flex-wrap gap-2">
              {detail.attempts.map((attempt) => (
                <li key={attempt.id} className="rounded-[12px] bg-surface-base px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">#{attempt.attempt_number}</Badge>
                    <Badge variant={attemptStatusVariant(attempt.status)}>
                      {attemptStatusLabel(attempt.status)}
                    </Badge>
                    <Badge variant="outline">{attempt.instance_type}</Badge>
                  </div>
                  {attempt.failure_reason !== null ? (
                    <p className="mt-2 text-body-xs text-text-secondary">
                      失败原因 {attempt.failure_reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onOpenSessionsList}>
            切换会话
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPromptSheetOpen(true)}>
            查看 Prompt
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLogsSheetOpen(true)}>
            日志与产物
          </Button>
        </div>
      </div>

      <Sheet open={promptSheetOpen} onOpenChange={setPromptSheetOpen}>
        <SheetContent side="right" className="w-full max-w-2xl">
          <SheetHeader className="border-b border-border-subtle px-6 py-5 pr-14">
            <SheetTitle>Prompt</SheetTitle>
            <SheetDescription>查看本次会话的输入内容与运行上下文。</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            <MonacoTextViewer
              value={session.prompt || "（空 Prompt）"}
              path={`agent-session/${session.id}/prompt.txt`}
              scope="agent-session-prompt"
              minHeight={180}
              maxHeight={420}
              wrap="on"
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={logsSheetOpen} onOpenChange={setLogsSheetOpen}>
        <SheetContent side="right" className="w-full max-w-3xl">
          <SheetHeader className="border-b border-border-subtle px-6 py-5 pr-14">
            <SheetTitle>日志与产物</SheetTitle>
            <SheetDescription>查看最新事件、切换产物并按需加载完整输出。</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {detail.events.length > 0 ? (
              <div className="panel-inset space-y-3">
                <p className="text-label-xs text-text-supporting">最新事件</p>
                <ol className="space-y-3">
                  {detail.events
                    .slice()
                    .reverse()
                    .slice(0, 8)
                    .map((event) => (
                      <li key={event.id} className="rounded-[14px] bg-surface-base px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{event.type.replaceAll("_", " ")}</Badge>
                            <Badge variant="outline">{eventStreamLabel(event.stream)}</Badge>
                          </div>
                          <p className="text-body-xs text-text-secondary">
                            {formatDateTime(event.created_at)}
                          </p>
                        </div>
                        <p className="mt-2 text-body-sm text-text-primary">{event.message}</p>
                      </li>
                    ))}
                </ol>
              </div>
            ) : null}

            <div className="panel-inset space-y-3">
              <div className="space-y-1">
                <p className="text-label-xs text-text-supporting">产物</p>
                <p className="text-body-xs text-text-secondary">
                  选择一个产物查看输出内容。
                </p>
              </div>

              {detail.artifacts.length === 0 ? (
                <p className="text-body-sm text-text-secondary">当前会话还没有产物。</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {detail.artifacts.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`rounded-[12px] border px-3 py-2 text-left transition-colors duration-100 ease-in-out ${
                          selectedArtifactId === item.id
                            ? "border-border-default bg-surface-base text-text-primary"
                            : "border-border-subtle bg-surface-focus text-text-secondary hover:bg-surface-base hover:text-text-primary"
                        }`}
                        onClick={() => setSelectedArtifactId(item.id)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{item.kind}</Badge>
                          <span className="text-body-sm font-medium">{item.title}</span>
                        </div>
                        <p className="mt-1 text-body-xs text-text-secondary">
                          更新于 {formatRelativeTime(item.updated_at)}
                        </p>
                      </button>
                    ))}
                  </div>

                  {artifact ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{artifact.kind}</Badge>
                            <span className="text-body-sm font-medium text-text-primary">
                              {artifact.title}
                            </span>
                          </div>
                          <p className="text-body-xs text-text-secondary">
                            更新于 {formatDateTime(artifact.updated_at)}
                          </p>
                        </div>
                        {artifact.has_full_content ? (
                          <PendingButton
                            size="sm"
                            variant="outline"
                            pending={loadingArtifactId === artifact.id}
                            disabled={loadingArtifactId === artifact.id}
                            pendingText="加载中..."
                            onClick={() => onLoadArtifactContent(session.id, artifact.id)}
                          >
                            {artifactContentById[artifact.id] !== undefined
                              ? "刷新完整输出"
                              : "加载完整输出"}
                          </PendingButton>
                        ) : null}
                      </div>

                      <MonacoTextViewer
                        value={artifactContent || "（空产物）"}
                        path={`agent-session/${session.id}/artifact-${artifact.id}.log`}
                        scope="agent-session-artifact"
                        minHeight={240}
                        maxHeight={620}
                        wrap="on"
                      />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
