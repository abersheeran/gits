import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { PendingButton } from "@/components/ui/pending-button";
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
import { formatDateTime, formatRelativeTime } from "@/lib/format";

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
};

type WorkspaceView = "prompt" | "validation" | "artifacts";

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
  onLoadArtifactContent
}: RepositoryActionsSessionWorkspaceProps) {
  const [activeView, setActiveView] = useState<WorkspaceView>("prompt");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  useEffect(() => {
    if (!detail) {
      setSelectedArtifactId(null);
      return;
    }
    const nextArtifact =
      detail.artifacts.find((artifact) => artifact.kind === "session_logs") ?? detail.artifacts[0] ?? null;
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
          <div className="rounded-[16px] border border-dashed border-border-subtle bg-surface-focus px-4 py-4 text-body-sm text-text-secondary">
            正在加载会话工作区...
          </div>
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="page-panel">
        <div className="panel-content">
          <div className="rounded-[16px] border border-dashed border-border-subtle bg-surface-focus px-4 py-4 text-body-sm text-text-secondary">
            选择一个会话查看 Prompt、执行轮次、验证与产物。
          </div>
        </div>
      </section>
    );
  }

  const session = detail.session;
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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="panel-inset-compact space-y-1">
            <p className="text-label-xs text-text-supporting">来源</p>
            <p className="text-body-sm font-medium text-text-primary">
              {detail.sourceContext.title ?? sessionSourceLabel(session)}
            </p>
            <p className="text-body-xs text-text-secondary">
              {detail.sourceContext.commentId ? `评论 ${detail.sourceContext.commentId}` : session.origin}
            </p>
          </div>
          <div className="panel-inset-compact space-y-1">
            <p className="text-label-xs text-text-supporting">发起人</p>
            <p className="text-body-sm font-medium text-text-primary">
              {session.created_by_username ?? "system"}
            </p>
            <p className="text-body-xs text-text-secondary">
              委托自 {session.delegated_from_username ?? session.created_by_username ?? "system"}
            </p>
          </div>
          <div className="panel-inset-compact space-y-1">
            <p className="text-label-xs text-text-supporting">耗时</p>
            <p className="text-body-sm font-medium text-text-primary">
              {formatSessionDuration(session.started_at, session.completed_at)}
            </p>
            <p className="text-body-xs text-text-secondary">
              开始于 {formatRelativeTime(session.started_at)}
            </p>
          </div>
          <div className="panel-inset-compact space-y-1">
            <p className="text-label-xs text-text-supporting">执行轮次</p>
            <p className="text-body-sm font-medium text-text-primary">{detail.attempts.length}</p>
            <p className="text-body-xs text-text-secondary">
              最新 {detail.latestAttempt ? `#${detail.latestAttempt.attempt_number}` : "-"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="panel-inset space-y-3">
            <p className="text-label-xs text-text-supporting">执行轮次</p>
            {detail.attempts.length === 0 ? (
              <p className="text-body-sm text-text-secondary">还没有执行轮次记录。</p>
            ) : (
              <ol className="space-y-3">
                {detail.attempts.map((attempt) => (
                  <li key={attempt.id} className="rounded-[14px] bg-surface-base px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">#{attempt.attempt_number}</Badge>
                      <Badge variant={attemptStatusVariant(attempt.status)}>
                        {attemptStatusLabel(attempt.status)}
                      </Badge>
                      <Badge variant="outline">{attempt.instance_type}</Badge>
                    </div>
                    <div className="mt-2 space-y-1 text-body-xs text-text-secondary">
                      <p>创建于 {formatDateTime(attempt.created_at)}</p>
                      <p>容器 {attempt.container_instance ?? "-"}</p>
                      <p>失败原因 {attempt.failure_reason ?? "-"}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="space-y-4">
            <div className="segmented-control w-full sm:w-fit" role="tablist" aria-label="会话工作区视图">
              <button
                type="button"
                className="segmented-control__item"
                data-active={activeView === "prompt"}
                onClick={() => setActiveView("prompt")}
              >
                Prompt
              </button>
              <button
                type="button"
                className="segmented-control__item"
                data-active={activeView === "validation"}
                onClick={() => setActiveView("validation")}
              >
                验证
              </button>
              <button
                type="button"
                className="segmented-control__item"
                data-active={activeView === "artifacts"}
                onClick={() => setActiveView("artifacts")}
              >
                产物
              </button>
            </div>

            {activeView === "prompt" ? (
              <div className="space-y-4">
                <div className="panel-inset space-y-3">
                  <p className="text-label-xs text-text-supporting">Prompt</p>
                  <MonacoTextViewer
                    value={session.prompt || "（空 Prompt）"}
                    path={`agent-session/${session.id}/prompt.txt`}
                    scope="agent-session-prompt"
                    minHeight={180}
                    maxHeight={420}
                    wrap="on"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="panel-inset-compact space-y-2">
                    <p className="text-label-xs text-text-supporting">分支</p>
                    <p className="text-body-sm font-medium text-text-primary">
                      {session.branch_ref ?? "-"}
                    </p>
                    <p className="text-body-xs text-text-secondary">
                      触发 ref {session.trigger_ref ?? "-"}
                    </p>
                  </div>
                  <div className="panel-inset-compact space-y-2">
                    <p className="text-label-xs text-text-supporting">运行时</p>
                    <p className="text-body-sm font-medium text-text-primary">
                      {session.container_instance ?? "等待容器分配"}
                    </p>
                    <p className="text-body-xs text-text-secondary">
                      触发 sha {session.trigger_sha ?? "-"}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {activeView === "validation" ? (
              <div className="space-y-4">
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
                    <p className="text-body-sm font-medium text-text-primary">
                      {validation.headline}
                    </p>
                    <p className="text-body-sm text-text-secondary">{validation.detail}</p>
                  </div>
                </div>

                {validation.checks.length > 0 ? (
                  <div className="grid gap-3">
                    {validation.checks.map((check) => (
                      <div
                        key={`${check.kind}-${check.command}-${check.scope ?? "default"}`}
                        className="panel-inset-compact space-y-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{check.label}</Badge>
                          {check.scope ? <Badge variant="outline">{check.scope}</Badge> : null}
                          <Badge variant="outline">{check.status}</Badge>
                        </div>
                        <p className="text-body-sm font-medium text-text-primary">{check.command}</p>
                        <p className="text-body-xs text-text-secondary">{check.summary}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="panel-inset-compact text-body-sm text-text-secondary">
                    当前还没有结构化验证检查。
                  </div>
                )}

                <div className="panel-inset space-y-3">
                  <p className="text-label-xs text-text-supporting">最新事件</p>
                  {detail.events.length === 0 ? (
                    <p className="text-body-sm text-text-secondary">还没有执行事件。</p>
                  ) : (
                    <ol className="space-y-3">
                      {detail.events
                        .slice()
                        .reverse()
                        .slice(0, 8)
                        .map((event) => (
                          <li key={event.id} className="rounded-[14px] bg-surface-base px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">
                                  {event.type.replaceAll("_", " ")}
                                </Badge>
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
                  )}
                </div>
              </div>
            ) : null}

            {activeView === "artifacts" ? (
              <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                <div className="panel-inset space-y-3">
                  <p className="text-label-xs text-text-supporting">产物</p>
                  {detail.artifacts.length === 0 ? (
                    <p className="text-body-sm text-text-secondary">当前会话还没有产物。</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.artifacts.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`w-full rounded-[12px] px-4 py-3 text-left transition-colors ${
                            selectedArtifactId === item.id
                              ? "bg-surface-base text-text-primary"
                              : "bg-transparent text-text-secondary hover:bg-surface-base hover:text-text-primary"
                          }`}
                          onClick={() => setSelectedArtifactId(item.id)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{item.kind}</Badge>
                          </div>
                          <p className="mt-2 text-body-sm font-medium">{item.title}</p>
                          <p className="mt-1 text-body-xs text-text-secondary">
                            更新于 {formatRelativeTime(item.updated_at)}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="panel-inset space-y-3">
                  {artifact ? (
                    <>
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
                    </>
                  ) : (
                    <p className="text-body-sm text-text-secondary">
                      选择一个产物查看输出内容。
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
