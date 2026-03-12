import { Link } from "react-router-dom";
import { Activity, ArrowUpRight, Bot, GitBranch, ListFilter, TerminalSquare } from "lucide-react";
import { DetailSection } from "@/components/common/detail-section";
import { HelpTip } from "@/components/common/help-tip";
import { LabeledSelectField } from "@/components/common/labeled-select-field";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { PendingButton } from "@/components/ui/pending-button";
import type { ActionRunRecord, AgentSessionRecord } from "@/lib/api";
import {
  canCancelAgentSession,
  formatDuration,
  isPendingRun,
  runGroupLabel,
  runSourceLabel,
  sessionSourceLabel
} from "@/lib/action-run-utils";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type SummaryStats = {
  total: number;
  running: number;
  success: number;
  failed: number;
};

type RepositoryActionsLogViewProps = {
  owner: string;
  repo: string;
  selectedExecutionId: string | null;
  selectedAgentSession: AgentSessionRecord | null;
  selectedRun: ActionRunRecord | null;
  sessionSummary: SummaryStats;
  runSummary: SummaryStats;
  agentSessions: AgentSessionRecord[];
  visibleAgentSessions: AgentSessionRecord[];
  filteredRuns: ActionRunRecord[];
  visibleRuns: ActionRunRecord[];
  canShowMoreSessions: boolean;
  canShowMoreRuns: boolean;
  canManageActions: boolean;
  pendingSessionAction: {
    sessionId: string;
    action: "cancel";
  } | null;
  rerunningRunId: string | null;
  loadingRunLogsById: Record<string, boolean>;
  fullRunLogsById: Record<string, string>;
  statusFilter: string;
  eventFilter: string;
  refFilter: string;
  actorFilter: string;
  statusOptions: string[];
  eventOptions: string[];
  refOptions: string[];
  onStatusFilterChange: (value: string) => void;
  onEventFilterChange: (value: string) => void;
  onRefFilterChange: (value: string) => void;
  onActorFilterChange: (value: string) => void;
  onClearFilters: () => void;
  onShowMoreSessions: () => void;
  onShowMoreRuns: () => void;
  onCancelSession: (session: AgentSessionRecord) => void;
  onRerunRun: (run: ActionRunRecord) => void;
  onLoadFullRunLogs: (runId: string) => void;
};

function actionsSelectionPath(id: string): string {
  return `?sessionId=${id}`;
}

function hasActiveFilters(
  statusFilter: string,
  eventFilter: string,
  refFilter: string,
  actorFilter: string
): boolean {
  return (
    statusFilter !== "all" ||
    eventFilter !== "all" ||
    refFilter !== "all" ||
    actorFilter.trim().length > 0
  );
}

function MetricCard({
  label,
  value,
  hint
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="panel-card-compact space-y-1">
      <p className="text-label-xs text-text-supporting">{label}</p>
      <p className="font-display text-card-title text-text-primary">{value}</p>
      <p className="text-body-xs text-text-secondary">{hint}</p>
    </div>
  );
}

function SessionNavigatorItem({
  owner,
  repo,
  session,
  selected,
  canManageActions,
  pendingSessionAction,
  onCancelSession
}: {
  owner: string;
  repo: string;
  session: AgentSessionRecord;
  selected: boolean;
  canManageActions: boolean;
  pendingSessionAction: RepositoryActionsLogViewProps["pendingSessionAction"];
  onCancelSession: (session: AgentSessionRecord) => void;
}) {
  return (
    <li
      id={`actions-session-nav-${session.id}`}
      className={cn(
        "panel-card-compact space-y-3",
        selected && "ring-1 ring-border-strong bg-surface-focus"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ActionStatusBadge status={session.status} withDot />
            <Badge variant="outline">{sessionSourceLabel(session)}</Badge>
            <Badge variant="outline">{session.agent_type}</Badge>
          </div>
          <div className="space-y-1">
            <p className="text-body-sm font-medium text-text-primary">{session.origin}</p>
            <p className="text-body-xs text-text-secondary">
              branch: {session.branch_ref ?? "-"} · updated {formatDateTime(session.updated_at)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {selected ? (
            <Badge variant="secondary">Focused</Badge>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link to={actionsSelectionPath(session.id)}>Focus</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link to={`/repo/${owner}/${repo}/agent-sessions/${session.id}`}>Detail</Link>
          </Button>
        </div>
      </div>
      {canManageActions && canCancelAgentSession(session) ? (
        <PendingButton
          size="sm"
          variant="outline"
          pending={
            pendingSessionAction?.sessionId === session.id &&
            pendingSessionAction.action === "cancel"
          }
          disabled={pendingSessionAction !== null}
          pendingText="Cancelling..."
          onClick={() => onCancelSession(session)}
        >
          Cancel queued session
        </PendingButton>
      ) : null}
    </li>
  );
}

function ExecutionExplorerItem({
  owner,
  repo,
  run,
  selected
}: {
  owner: string;
  repo: string;
  run: ActionRunRecord;
  selected: boolean;
}) {
  return (
    <li
      id={`actions-run-row-${run.id}`}
      className={cn(
        "panel-card-compact space-y-3",
        selected && "ring-1 ring-border-strong bg-surface-focus"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ActionStatusBadge status={run.status} withDot />
            <Badge variant="outline">{runGroupLabel(run)}</Badge>
            <Badge variant="outline">{run.agent_type}</Badge>
            <Badge variant="outline">{run.instance_type}</Badge>
          </div>
          <div className="space-y-1">
            <p className="text-body-sm font-medium text-text-primary">
              Session #{run.session_number} · {runSourceLabel(run)}
            </p>
            <p className="text-body-xs text-text-secondary">
              {run.trigger_ref ? `${run.trigger_ref} · ` : ""}
              updated {formatDateTime(run.updated_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-body-xs text-text-secondary">
            <span>actor: {run.triggered_by_username ?? "-"}</span>
            <span>duration: {formatDuration(run.started_at, run.completed_at)}</span>
            <span>exit: {run.exit_code === null ? "-" : String(run.exit_code)}</span>
            {run.trigger_sha ? <span>sha: {run.trigger_sha.slice(0, 7)}</span> : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {selected ? (
            <Badge variant="secondary">Inspecting</Badge>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link to={actionsSelectionPath(run.id)}>Inspect</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link to={`/repo/${owner}/${repo}/agent-sessions/${run.id}`}>Detail</Link>
          </Button>
        </div>
      </div>
    </li>
  );
}

export function RepositoryActionsLogView({
  owner,
  repo,
  selectedExecutionId,
  selectedAgentSession,
  selectedRun,
  sessionSummary,
  runSummary,
  agentSessions,
  visibleAgentSessions,
  filteredRuns,
  visibleRuns,
  canShowMoreSessions,
  canShowMoreRuns,
  canManageActions,
  pendingSessionAction,
  rerunningRunId,
  loadingRunLogsById,
  fullRunLogsById,
  statusFilter,
  eventFilter,
  refFilter,
  actorFilter,
  statusOptions,
  eventOptions,
  refOptions,
  onStatusFilterChange,
  onEventFilterChange,
  onRefFilterChange,
  onActorFilterChange,
  onClearFilters,
  onShowMoreSessions,
  onShowMoreRuns,
  onCancelSession,
  onRerunRun,
  onLoadFullRunLogs
}: RepositoryActionsLogViewProps) {
  const focusedSession = selectedAgentSession;
  const displayedLogs =
    selectedRun && fullRunLogsById[selectedRun.id] !== undefined
      ? fullRunLogsById[selectedRun.id]
      : selectedRun?.logs ?? "";
  const showingExcerpt =
    selectedRun !== null &&
    !isPendingRun(selectedRun) &&
    fullRunLogsById[selectedRun.id] === undefined;
  const filtersActive = hasActiveFilters(
    statusFilter,
    eventFilter,
    refFilter,
    actorFilter
  );

  return (
    <div className="space-y-4">
      <section className="page-hero">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-section-heading-mobile text-text-primary md:text-section-heading">
                  Actions
                </h1>
                <HelpTip content="根据 PRD，session 是主视图，workflow 只是触发来源。这里优先展示任务轮次，再查看对应的 prompt 与日志。" />
              </div>
              <p className="max-w-3xl text-body-sm text-text-secondary">
                以 session 为中心查看最近的任务轮次，在同一工作区里切换 prompt、日志与 rerun。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Recent sessions"
                value={sessionSummary.total}
                hint="最近收敛到仓库 actions 页的任务轮次"
              />
              <MetricCard
                label="In progress"
                value={sessionSummary.running}
                hint="包含 queued 与 running"
              />
              <MetricCard
                label="Visible executions"
                value={runSummary.total}
                hint="当前筛选下可浏览的执行记录"
              />
              <MetricCard
                label="Need attention"
                value={runSummary.failed}
                hint="当前筛选下 failed 或 cancelled 需要回看"
              />
            </div>
          </div>

          <div className="panel-inset space-y-3">
            <div className="flex items-center gap-2 text-label-xs text-text-supporting">
              <Activity className="size-3.5" />
              Current focus
            </div>
            {focusedSession ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <ActionStatusBadge status={focusedSession.status} />
                  <Badge variant="outline">{sessionSourceLabel(focusedSession)}</Badge>
                  <Badge variant="outline">{focusedSession.agent_type}</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-body-sm font-medium text-text-primary">
                    {focusedSession.origin}
                  </p>
                  <p className="text-body-xs text-text-secondary">
                    branch: {focusedSession.branch_ref ?? "-"} · updated{" "}
                    {formatDateTime(focusedSession.updated_at)}
                  </p>
                </div>
                <div className="grid gap-2 text-body-xs text-text-secondary sm:grid-cols-2">
                  <p>session: {focusedSession.id}</p>
                  <p>parent: {focusedSession.parent_session_id ?? "-"}</p>
                </div>
              </>
            ) : (
              <div className="rounded-[20px] border border-dashed border-border-subtle bg-surface-base px-4 py-5 text-body-sm text-text-secondary">
                当前仓库还没有可浏览的 session。
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <DetailSection
          title="Task Rounds"
          description="左侧导航只保留最近任务轮次，避免把 workflow 和日志都堆在同一块。"
          headerActions={
            <Badge variant="outline" className="bg-surface-focus">
              {agentSessions.length} sessions
            </Badge>
          }
          className="page-panel-muted xl:sticky xl:top-6 xl:self-start"
        >
          {visibleAgentSessions.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-border-subtle bg-surface-base px-4 py-5 text-body-sm text-text-secondary">
              No agent sessions yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {visibleAgentSessions.map((session) => (
                <SessionNavigatorItem
                  key={session.id}
                  owner={owner}
                  repo={repo}
                  session={session}
                  selected={selectedExecutionId === session.id}
                  canManageActions={canManageActions}
                  pendingSessionAction={pendingSessionAction}
                  onCancelSession={onCancelSession}
                />
              ))}
            </ul>
          )}
          {canShowMoreSessions ? (
            <Button size="sm" variant="ghost" onClick={onShowMoreSessions}>
              Show more sessions
            </Button>
          ) : null}
        </DetailSection>

        <div className="space-y-4">
          <DetailSection
            title="Execution Workspace"
            description="当前聚焦的 session 会在这里显示摘要、prompt 和日志。"
            headerActions={
              focusedSession ? (
                <>
                  {focusedSession.parent_session_id ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={actionsSelectionPath(focusedSession.parent_session_id)}>
                        Open parent
                      </Link>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/repo/${owner}/${repo}/agent-sessions/${focusedSession.id}`}>
                      Open detail
                    </Link>
                  </Button>
                  {canManageActions && selectedRun ? (
                    <PendingButton
                      size="sm"
                      variant="outline"
                      pending={rerunningRunId === selectedRun.id}
                      disabled={rerunningRunId !== null && rerunningRunId !== selectedRun.id}
                      pendingText="Rerunning session..."
                      onClick={() => onRerunRun(selectedRun)}
                    >
                      Rerun session
                    </PendingButton>
                  ) : null}
                </>
              ) : undefined
            }
            className="page-panel"
          >
            {focusedSession ? (
              <>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="panel-inset space-y-3">
                    <div className="flex items-center gap-2 text-label-xs text-text-supporting">
                      <Bot className="size-3.5" />
                      Session summary
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionStatusBadge status={focusedSession.status} />
                      <Badge variant="outline">{sessionSourceLabel(focusedSession)}</Badge>
                      <Badge variant="outline">{focusedSession.agent_type}</Badge>
                      <Badge variant="outline">{focusedSession.instance_type}</Badge>
                    </div>
                    <div className="grid gap-2 text-body-sm text-text-secondary sm:grid-cols-2">
                      <p>origin: {focusedSession.origin}</p>
                      <p>actor: {focusedSession.created_by_username ?? "system"}</p>
                      <p>branch: {focusedSession.branch_ref ?? "-"}</p>
                      <p>workflow: {focusedSession.workflow_name ?? "-"}</p>
                      <p>source: {sessionSourceLabel(focusedSession)}</p>
                      <p>updated: {formatDateTime(focusedSession.updated_at)}</p>
                    </div>
                    {canManageActions && canCancelAgentSession(focusedSession) ? (
                      <PendingButton
                        size="sm"
                        variant="outline"
                        pending={
                          pendingSessionAction?.sessionId === focusedSession.id &&
                          pendingSessionAction.action === "cancel"
                        }
                        disabled={pendingSessionAction !== null}
                        pendingText="Cancelling..."
                        onClick={() => onCancelSession(focusedSession)}
                      >
                        Cancel queued session
                      </PendingButton>
                    ) : null}
                  </div>

                  <div className="panel-inset space-y-3">
                    <div className="flex items-center gap-2 text-label-xs text-text-supporting">
                      <GitBranch className="size-3.5" />
                      Execution metadata
                    </div>
                    <div className="grid gap-2 text-body-sm text-text-secondary sm:grid-cols-2">
                      <p>created: {formatDateTime(focusedSession.created_at)}</p>
                      <p>claimed: {formatDateTime(focusedSession.claimed_at)}</p>
                      <p>started: {formatDateTime(focusedSession.started_at)}</p>
                      <p>completed: {formatDateTime(focusedSession.completed_at)}</p>
                      <p>duration: {formatDuration(focusedSession.started_at, focusedSession.completed_at)}</p>
                      <p>container: {focusedSession.container_instance ?? "-"}</p>
                    </div>
                    {focusedSession.trigger_ref || focusedSession.trigger_sha ? (
                      <div className="flex flex-wrap gap-2">
                        {focusedSession.trigger_ref ? (
                          <Badge variant="outline">{focusedSession.trigger_ref}</Badge>
                        ) : null}
                        {focusedSession.trigger_sha ? (
                          <Badge variant="outline">{focusedSession.trigger_sha}</Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                {selectedRun ? (
                  <div className="space-y-4">
                    <div className="panel-inset space-y-3">
                      <div className="flex items-center gap-2 text-label-xs text-text-supporting">
                        <TerminalSquare className="size-3.5" />
                        Prompt
                      </div>
                      <MonacoTextViewer
                        value={selectedRun.prompt || "(empty prompt)"}
                        path={`actions/session-${selectedRun.id}.prompt.txt`}
                        scope="action-run-prompt"
                        minHeight={140}
                        maxHeight={240}
                        wrap="on"
                      />
                    </div>

                    <div className="panel-inset space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-label-xs text-text-supporting">
                            <Activity className="size-3.5" />
                            Session logs
                          </div>
                          <p className="text-body-xs text-text-secondary">
                            {showingExcerpt
                              ? "当前显示的是 D1 摘要。需要时再从对象存储加载全文。"
                              : "当前显示的是完整或实时更新中的日志。"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {showingExcerpt ? (
                            <PendingButton
                              size="sm"
                              variant="outline"
                              pending={loadingRunLogsById[selectedRun.id] === true}
                              disabled={loadingRunLogsById[selectedRun.id] === true}
                              pendingText="Loading logs..."
                              onClick={() => onLoadFullRunLogs(selectedRun.id)}
                            >
                              Load full logs
                            </PendingButton>
                          ) : null}
                          <Button size="sm" variant="ghost" asChild>
                            <Link to={`/repo/${owner}/${repo}/agent-sessions/${selectedRun.id}`}>
                              Open timeline
                              <ArrowUpRight className="size-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                      <MonacoTextViewer
                        value={displayedLogs || "(empty logs)"}
                        path={`actions/session-${selectedRun.id}.log`}
                        scope="action-run-logs"
                        minHeight={220}
                        maxHeight={560}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="panel-inset text-body-sm text-text-secondary">
                    当前聚焦的 session 还没有可浏览的 prompt / logs 记录。可以直接打开 detail
                    页查看完整上下文。
                  </div>
                )}
              </>
            ) : (
              <div className="panel-inset text-body-sm text-text-secondary">
                选择一个 session 后，这里会展示它的执行上下文。
              </div>
            )}
          </DetailSection>

          <DetailSection
            title="Execution Explorer"
            description="按状态、workflow / origin、ref、actor 筛选最近执行记录。"
            headerActions={
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-surface-focus">
                  {filteredRuns.length} matching
                </Badge>
                {filtersActive ? (
                  <Button size="sm" variant="ghost" onClick={onClearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            }
            className="page-panel"
          >
            <div className="panel-inset space-y-4">
              <div className="flex items-center gap-2 text-label-xs text-text-supporting">
                <ListFilter className="size-3.5" />
                Filters
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <LabeledSelectField
                  id="actions-status-filter"
                  label="Status"
                  value={statusFilter}
                  onValueChange={onStatusFilterChange}
                  options={statusOptions.map((option) => ({
                    value: option,
                    label: option
                  }))}
                  triggerClassName="bg-surface-base"
                />
                <LabeledSelectField
                  id="actions-event-filter"
                  label="Workflow / origin"
                  value={eventFilter}
                  onValueChange={onEventFilterChange}
                  options={eventOptions.map((option) => ({
                    value: option,
                    label: option
                  }))}
                  triggerClassName="bg-surface-base"
                />
                <LabeledSelectField
                  id="actions-ref-filter"
                  label="Ref"
                  value={refFilter}
                  onValueChange={onRefFilterChange}
                  options={refOptions.map((option) => ({
                    value: option,
                    label: option
                  }))}
                  triggerClassName="bg-surface-base"
                />
                <div className="space-y-2">
                  <Label htmlFor="actions-actor-filter">Actor</Label>
                  <Input
                    id="actions-actor-filter"
                    value={actorFilter}
                    onChange={(event) => onActorFilterChange(event.target.value)}
                    placeholder="username"
                    className="bg-surface-base"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Visible"
                value={runSummary.total}
                hint="当前筛选下的执行记录"
              />
              <MetricCard
                label="Running"
                value={runSummary.running}
                hint="会继续自动刷新"
              />
              <MetricCard
                label="Succeeded"
                value={runSummary.success}
                hint="可直接回看 prompt 与日志"
              />
              <MetricCard
                label="Failed"
                value={runSummary.failed}
                hint="优先关注失败与取消记录"
              />
            </div>

            {visibleRuns.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-border-subtle bg-surface-focus px-4 py-5 text-body-sm text-text-secondary">
                {filtersActive ? "当前筛选条件下没有匹配的执行记录。" : "No execution sessions yet."}
              </div>
            ) : (
              <ul className="space-y-3">
                {visibleRuns.map((run) => (
                  <ExecutionExplorerItem
                    key={run.id}
                    owner={owner}
                    repo={repo}
                    run={run}
                    selected={selectedExecutionId === run.id}
                  />
                ))}
              </ul>
            )}

            {canShowMoreRuns ? (
              <Button size="sm" variant="ghost" onClick={onShowMoreRuns}>
                Show more executions
              </Button>
            ) : null}
          </DetailSection>
        </div>
      </div>
    </div>
  );
}
