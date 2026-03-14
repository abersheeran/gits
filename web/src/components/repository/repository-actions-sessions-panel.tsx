import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DetailSection } from "@/components/common/detail-section";
import { LabeledSelectField } from "@/components/common/labeled-select-field";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PendingButton } from "@/components/ui/pending-button";
import type { AgentSessionRecord } from "@/lib/api";
import {
  canCancelAgentSession,
  sessionSourceLabel,
  sessionWorkflowLabel
} from "@/lib/agent-session-utils";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type RepositoryActionsSessionsPanelProps = {
  owner: string;
  repo: string;
  sessions: AgentSessionRecord[];
  selectedSessionId: string | null;
  loading: boolean;
  canManageActions: boolean;
  pendingSessionAction: {
    sessionId: string;
    action: "cancel" | "rerun";
  } | null;
  onSelectSession: (sessionId: string) => void;
  onCancelSession: (session: AgentSessionRecord) => void;
};

const INITIAL_VISIBLE_COUNT = 10;
const SESSION_SOURCE_OPTIONS = [
  { value: "all", label: "全部来源" },
  { value: "issue", label: "Issue" },
  { value: "pull_request", label: "Pull Request" },
  { value: "manual", label: "手动" }
] as const;

function ensureVisibleCount(
  selectedSessionId: string | null,
  sessions: AgentSessionRecord[],
  currentVisibleCount: number
): number {
  const selectedIndex = selectedSessionId
    ? sessions.findIndex((session) => session.id === selectedSessionId)
    : -1;
  if (selectedIndex === -1) {
    return Math.min(currentVisibleCount, sessions.length);
  }
  return Math.min(Math.max(currentVisibleCount, selectedIndex + 1), sessions.length);
}

export function RepositoryActionsSessionsPanel({
  owner,
  repo,
  sessions,
  selectedSessionId,
  loading,
  canManageActions,
  pendingSessionAction,
  onSelectSession,
  onCancelSession
}: RepositoryActionsSessionsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<"all" | AgentSessionRecord["status"]>("all");
  const [sourceFilter, setSourceFilter] =
    useState<(typeof SESSION_SOURCE_OPTIONS)[number]["value"]>("all");
  const [actorFilter, setActorFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  const statusOptions = useMemo(
    () =>
      [
        { value: "all", label: "全部状态" },
        ...Array.from(new Set(sessions.map((session) => session.status)))
          .sort()
          .map((status) => ({
            value: status,
            label: status
          }))
      ] as Array<{
        value: "all" | AgentSessionRecord["status"];
        label: string;
      }>,
    [sessions]
  );

  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) => {
        if (statusFilter !== "all" && session.status !== statusFilter) {
          return false;
        }
        if (sourceFilter !== "all" && session.source_type !== sourceFilter) {
          return false;
        }
        if (
          actorFilter.trim() &&
          !(session.created_by_username ?? "")
            .toLowerCase()
            .includes(actorFilter.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [actorFilter, sessions, sourceFilter, statusFilter]
  );

  const visibleSessions = useMemo(
    () => filteredSessions.slice(0, ensureVisibleCount(selectedSessionId, filteredSessions, visibleCount)),
    [filteredSessions, selectedSessionId, visibleCount]
  );

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [statusFilter, sourceFilter, actorFilter]);

  const hasActiveFilters =
    statusFilter !== "all" || sourceFilter !== "all" || actorFilter.trim().length > 0;

  return (
    <DetailSection
      title="会话"
      description="以会话视图浏览最近的执行轮次。"
      headerActions={
        <Badge variant="outline" className="bg-surface-focus">
          {filteredSessions.length} 个会话
        </Badge>
      }
      className="page-panel-muted xl:sticky xl:top-6 xl:self-start"
    >
      <div className="panel-card-compact space-y-4">
        <div className="grid gap-3">
          <LabeledSelectField
            id="actions-session-status-filter"
            label="状态"
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={statusOptions}
            triggerClassName="bg-surface-base"
          />
          <LabeledSelectField
            id="actions-session-source-filter"
            label="来源"
            value={sourceFilter}
            onValueChange={setSourceFilter}
            options={SESSION_SOURCE_OPTIONS}
            triggerClassName="bg-surface-base"
          />
          <div className="space-y-2">
            <label className="text-label-sm text-text-primary" htmlFor="actions-session-actor-filter">
              发起人
            </label>
            <Input
              id="actions-session-actor-filter"
              value={actorFilter}
              onChange={(event) => setActorFilter(event.target.value)}
              placeholder="按用户名过滤"
              className="bg-surface-base"
            />
          </div>
        </div>

        {hasActiveFilters ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStatusFilter("all");
              setSourceFilter("all");
              setActorFilter("");
            }}
          >
            清空筛选
          </Button>
        ) : null}
      </div>

      {loading && sessions.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-border-subtle bg-surface-base px-4 py-3 text-body-sm text-text-secondary">
          正在加载会话列表...
        </div>
      ) : null}

      {visibleSessions.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-border-subtle bg-surface-base px-4 py-3 text-body-sm text-text-secondary">
          {hasActiveFilters ? "当前筛选条件下没有匹配的会话。" : "当前仓库还没有会话。"}
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleSessions.map((session) => (
            <li
              key={session.id}
              id={`actions-session-nav-${session.id}`}
              className={cn(
                "panel-card-compact space-y-3",
                selectedSessionId === session.id && "ring-1 ring-border-strong bg-surface-base"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 space-y-2 text-left"
                  onClick={() => onSelectSession(session.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionStatusBadge status={session.status} withDot />
                    <Badge variant="outline">{sessionSourceLabel(session)}</Badge>
                    <Badge variant="outline">{session.agent_type}</Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-body-sm font-medium text-text-primary">
                      {sessionWorkflowLabel(session)}
                    </p>
                    <p className="text-body-xs text-text-secondary">
                      {session.branch_ref ?? "-"} · 更新于 {formatDateTime(session.updated_at)}
                    </p>
                  </div>
                </button>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Button size="sm" variant="ghost" asChild>
                    <Link to={`/repo/${owner}/${repo}/agent-sessions/${session.id}`}>详情</Link>
                  </Button>
                  {selectedSessionId === session.id ? (
                    <Badge variant="secondary">当前焦点</Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-body-xs text-text-secondary">
                <span>发起人：{session.created_by_username ?? "system"}</span>
                <span>会话：#{session.session_number}</span>
                <span>来源：{session.origin}</span>
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
                  pendingText="正在取消..."
                  onClick={() => onCancelSession(session)}
                >
                  取消会话
                </PendingButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {visibleSessions.length < filteredSessions.length ? (
        <Button size="sm" variant="ghost" onClick={() => setVisibleCount((current) => current + 10)}>
          显示更多
        </Button>
      ) : null}
    </DetailSection>
  );
}
