import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { IssueTaskStatusBadge } from "@/components/repository/issue-task-status-badge";
import { MarkdownBody } from "@/components/repository/markdown-body";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { ReactionStrip } from "@/components/repository/reaction-strip";
import { RepositoryMetadataFields } from "@/components/repository/repository-metadata-fields";
import { RepositoryStateBadge } from "@/components/repository/repository-state-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import { Textarea } from "@/components/ui/textarea";
import {
  addReaction,
  assignIssueAgent,
  type AgentSessionDetail,
  listLatestAgentSessionsBySource,
  listLatestActionRunsByCommentIds,
  listLatestActionRunsBySource,
  listLatestPullRequestProvenance,
  createIssueComment,
  formatApiError,
  getIssue,
  getRepositoryDetail,
  listRepositoryLabels,
  listRepositoryMilestones,
  listRepositoryParticipants,
  listIssueComments,
  removeReaction,
  resumeIssueAgent,
  updateIssue,
  type ActionAgentType,
  type ActionRunRecord,
  type AgentSessionRecord,
  type AuthUser,
  type IssueCommentRecord,
  type IssueLinkedPullRequestRecord,
  type IssueRecord,
  type IssueTaskStatus,
  type ReactionContent,
  type RepositoryLabelRecord,
  type RepositoryDetailResponse,
  type RepositoryMilestoneRecord,
  type RepositoryUserSummary
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type IssueDetailPageProps = {
  user: AuthUser | null;
};

const FALLBACK_AGENT_TYPES: ActionAgentType[] = ["codex", "claude_code"];
const ISSUE_TASK_STATUS_OPTIONS: IssueTaskStatus[] = [
  "open",
  "agent-working",
  "waiting-human",
  "done"
];

function isPendingAgentSession(session: AgentSessionRecord | null): boolean {
  return session?.status === "queued" || session?.status === "running";
}

function issueTaskStatusHint(status: IssueTaskStatus): string {
  if (status === "agent-working") {
    return "Agent 正在推进实现或整理下一次交付。";
  }
  if (status === "waiting-human") {
    return "当前在等待人类补充信息、确认方案或继续评审。";
  }
  if (status === "done") {
    return "任务目标已经收敛，剩余动作应当是合并或回顾。";
  }
  return "任务已打开，尚未进入明确的下一轮执行。";
}

function shortBranchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
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

function excerptText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function usageRecordValue(
  detail: AgentSessionDetail | null,
  kind: "duration_ms" | "exit_code" | "run_log_chars" | "stdout_chars" | "stderr_chars"
): number | null {
  const record = detail?.usageRecords.find((item) => item.kind === kind);
  return record ? record.value : null;
}

function latestValidationStatus(
  detail: AgentSessionDetail | null
): ActionRunRecord["status"] | AgentSessionRecord["status"] | null {
  return detail?.linkedRun?.status ?? detail?.session.status ?? null;
}

export function IssueDetailPage({ user }: IssueDetailPageProps) {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const number = Number.parseInt(params.number ?? "", 10);

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [issue, setIssue] = useState<IssueRecord | null>(null);
  const [linkedPullRequests, setLinkedPullRequests] = useState<IssueLinkedPullRequestRecord[]>([]);
  const [comments, setComments] = useState<IssueCommentRecord[]>([]);
  const [availableLabels, setAvailableLabels] = useState<RepositoryLabelRecord[]>([]);
  const [availableMilestones, setAvailableMilestones] = useState<RepositoryMilestoneRecord[]>([]);
  const [participants, setParticipants] = useState<RepositoryUserSummary[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [latestActionRun, setLatestActionRun] = useState<ActionRunRecord | null>(null);
  const [latestAgentSession, setLatestAgentSession] = useState<AgentSessionRecord | null>(null);
  const [latestPullRequestProvenanceByNumber, setLatestPullRequestProvenanceByNumber] =
    useState<Record<number, AgentSessionDetail | null>>({});
  const [selectedAgentType, setSelectedAgentType] = useState<ActionAgentType>("codex");
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentSubmitAction, setAgentSubmitAction] = useState<"assign" | "resume" | null>(null);
  const [latestRunByCommentId, setLatestRunByCommentId] = useState<Record<string, ActionRunRecord>>({});
  const [taskStatusDraft, setTaskStatusDraft] = useState<IssueTaskStatus>("open");
  const [acceptanceCriteriaDraft, setAcceptanceCriteriaDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [taskStatusSaving, setTaskStatusSaving] = useState(false);
  const [acceptanceCriteriaSaving, setAcceptanceCriteriaSaving] = useState(false);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [reactionPendingKey, setReactionPendingKey] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  async function refreshLatestRunStatus(): Promise<void> {
    if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
      return;
    }
    const latestRunItems = await listLatestActionRunsBySource(owner, repo, {
      sourceType: "issue",
      numbers: [number]
    });
    setLatestActionRun(latestRunItems[0]?.run ?? null);
  }

  async function refreshLatestAgentSessionStatus(): Promise<void> {
    if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
      return;
    }
    const latestSessionItems = await listLatestAgentSessionsBySource(owner, repo, {
      sourceType: "issue",
      numbers: [number]
    });
    setLatestAgentSession(latestSessionItems[0]?.session ?? null);
  }

  async function refreshCommentRunStatuses(
    nextCommentsInput?: IssueCommentRecord[]
  ): Promise<void> {
    const nextComments = nextCommentsInput ?? comments;
    if (!owner || !repo || nextComments.length === 0) {
      setLatestRunByCommentId({});
      return;
    }
    const latestRunItems = await listLatestActionRunsByCommentIds(
      owner,
      repo,
      nextComments.map((comment) => comment.id)
    );
    const nextRunByCommentId: Record<string, ActionRunRecord> = {};
    for (const item of latestRunItems) {
      if (item.run) {
        nextRunByCommentId[item.commentId] = item.run;
      }
    }
    setLatestRunByCommentId(nextRunByCommentId);
  }

  async function refreshLinkedPullRequestProvenance(
    nextLinkedPullRequestsInput?: IssueLinkedPullRequestRecord[]
  ): Promise<void> {
    const nextLinkedPullRequests = nextLinkedPullRequestsInput ?? linkedPullRequests;
    if (!owner || !repo || nextLinkedPullRequests.length === 0) {
      setLatestPullRequestProvenanceByNumber({});
      return;
    }
    const items = await listLatestPullRequestProvenance(
      owner,
      repo,
      nextLinkedPullRequests.map((pullRequest) => pullRequest.number)
    );
    const nextProvenanceByPullRequestNumber: Record<number, AgentSessionDetail | null> = {};
    for (const item of items) {
      if (item.latestSession) {
        nextProvenanceByPullRequestNumber[item.sourceNumber] = item.latestSession;
      }
    }
    setLatestPullRequestProvenanceByNumber(nextProvenanceByPullRequestNumber);
  }

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const [
          nextDetail,
          nextIssueDetail,
          nextComments,
          latestRunItems,
          latestSessionItems,
          nextLabels,
          nextMilestones,
          nextParticipants
        ] = await Promise.all([
          getRepositoryDetail(owner, repo),
          getIssue(owner, repo, number),
          listIssueComments(owner, repo, number),
          listLatestActionRunsBySource(owner, repo, {
            sourceType: "issue",
            numbers: [number]
          }),
          listLatestAgentSessionsBySource(owner, repo, {
            sourceType: "issue",
            numbers: [number]
          }),
          listRepositoryLabels(owner, repo),
          listRepositoryMilestones(owner, repo),
          user ? listRepositoryParticipants(owner, repo) : Promise.resolve([])
        ]);
        const latestCommentRunItemsPromise =
          nextComments.length > 0
            ? listLatestActionRunsByCommentIds(
                owner,
                repo,
                nextComments.map((comment) => comment.id)
              )
            : Promise.resolve([]);
        const linkedPullRequestNumbers = nextIssueDetail.linkedPullRequests.map(
          (pullRequest) => pullRequest.number
        );
        const [latestCommentRunItems, latestPullRequestProvenanceItems] = await Promise.all([
          latestCommentRunItemsPromise,
          linkedPullRequestNumbers.length > 0
            ? listLatestPullRequestProvenance(owner, repo, linkedPullRequestNumbers)
            : Promise.resolve([])
        ]);
        if (canceled) {
          return;
        }
        const nextRunByCommentId: Record<string, ActionRunRecord> = {};
        const nextPullRequestProvenanceByNumber: Record<number, AgentSessionDetail | null> = {};
        for (const item of latestCommentRunItems) {
          if (item.run) {
            nextRunByCommentId[item.commentId] = item.run;
          }
        }
        for (const item of latestPullRequestProvenanceItems) {
          if (item.latestSession) {
            nextPullRequestProvenanceByNumber[item.sourceNumber] = item.latestSession;
          }
        }
        setDetail(nextDetail);
        setIssue(nextIssueDetail.issue);
        setLinkedPullRequests(nextIssueDetail.linkedPullRequests);
        setComments(nextComments);
        setAvailableLabels(nextLabels);
        setAvailableMilestones(nextMilestones);
        setParticipants(nextParticipants);
        setLatestActionRun(latestRunItems[0]?.run ?? null);
        setLatestAgentSession(latestSessionItems[0]?.session ?? null);
        setLatestRunByCommentId(nextRunByCommentId);
        setLatestPullRequestProvenanceByNumber(nextPullRequestProvenanceByNumber);
      } catch (loadError) {
        if (!canceled) {
          setLoadError(formatApiError(loadError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [number, owner, repo, user]);

  useEffect(() => {
    if (!issue) {
      return;
    }
    setSelectedLabelIds(issue.labels.map((label) => label.id));
    setSelectedAssigneeIds(issue.assignees.map((assignee) => assignee.id));
    setSelectedMilestoneId(issue.milestone?.id ?? null);
    setTaskStatusDraft(issue.task_status);
    setAcceptanceCriteriaDraft(issue.acceptance_criteria);
  }, [issue]);

  const hasPendingRun =
    latestActionRun !== null &&
    (latestActionRun.status === "queued" || latestActionRun.status === "running");
  const hasPendingAgentSession = isPendingAgentSession(latestAgentSession);
  const hasPendingCommentRun = comments.some((comment) => {
    const run = latestRunByCommentId[comment.id];
    return run ? run.status === "queued" || run.status === "running" : false;
  });
  const hasPendingPullRequestValidation = linkedPullRequests.some((pullRequest) => {
    const status = latestValidationStatus(
      latestPullRequestProvenanceByNumber[pullRequest.number] ?? null
    );
    return status === "queued" || status === "running";
  });
  const linkedPullRequestsWithValidation = linkedPullRequests.filter(
    (pullRequest) => latestPullRequestProvenanceByNumber[pullRequest.number]
  ).length;

  useEffect(() => {
    if (
      (!hasPendingRun &&
        !hasPendingAgentSession &&
        !hasPendingCommentRun &&
        !hasPendingPullRequestValidation) ||
      !owner ||
      !repo ||
      !Number.isInteger(number) ||
      number <= 0
    ) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        await Promise.all([
          refreshLatestRunStatus(),
          refreshLatestAgentSessionStatus(),
          refreshCommentRunStatuses(),
          refreshLinkedPullRequestProvenance()
        ]);
      } catch {
        // Ignore transient polling errors.
      }
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    comments,
    hasPendingAgentSession,
    hasPendingCommentRun,
    hasPendingPullRequestValidation,
    hasPendingRun,
    linkedPullRequests,
    number,
    owner,
    repo
  ]);

  if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>Issue 编号无效。</AlertDescription>
      </Alert>
    );
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !detail || !issue) {
    return (
      <PageLoadingState
        title="Loading issue"
        description={`Fetching issue #${number} and its conversation history.`}
      />
    );
  }

  const canUpdate = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canComment = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canReact = Boolean(user);
  const canRunAgents = detail.permissions.canRunAgents && Boolean(user);
  const allowedAgentTypes = FALLBACK_AGENT_TYPES;

  async function saveMetadata() {
    if (metadataSaving) {
      return;
    }
    setMetadataSaving(true);
    setActionError(null);
    try {
      const updated = await updateIssue(owner, repo, number, {
        labelIds: selectedLabelIds,
        assigneeUserIds: selectedAssigneeIds,
        milestoneId: selectedMilestoneId
      });
      setIssue(updated);
    } catch (error) {
      setActionError(formatApiError(error));
    } finally {
      setMetadataSaving(false);
    }
  }

  async function changeState(nextState: "open" | "closed") {
    if (updating) {
      return;
    }
    setUpdating(true);
    setActionError(null);
    try {
      const updated = await updateIssue(owner, repo, number, {
        state: nextState
      });
      setIssue(updated);
    } catch (updateError) {
      setActionError(formatApiError(updateError));
    } finally {
      setUpdating(false);
    }
  }

  async function saveTaskStatus() {
    if (!issue || taskStatusSaving || taskStatusDraft === issue.task_status) {
      return;
    }
    setTaskStatusSaving(true);
    setActionError(null);
    try {
      const updated = await updateIssue(owner, repo, number, {
        taskStatus: taskStatusDraft
      });
      setIssue(updated);
    } catch (error) {
      setActionError(formatApiError(error));
    } finally {
      setTaskStatusSaving(false);
    }
  }

  async function saveAcceptanceCriteria() {
    if (!issue || acceptanceCriteriaSaving || acceptanceCriteriaDraft === issue.acceptance_criteria) {
      return;
    }
    setAcceptanceCriteriaSaving(true);
    setActionError(null);
    try {
      const updated = await updateIssue(owner, repo, number, {
        acceptanceCriteria: acceptanceCriteriaDraft
      });
      setIssue(updated);
    } catch (error) {
      setActionError(formatApiError(error));
    } finally {
      setAcceptanceCriteriaSaving(false);
    }
  }

  async function submitComment() {
    const trimmedBody = commentBody.trim();
    if (!trimmedBody || commentSubmitting) {
      if (!trimmedBody) {
        setActionError("评论内容不能为空。");
      }
      return;
    }

    setCommentSubmitting(true);
    setActionError(null);
    try {
      const created = await createIssueComment(owner, repo, number, {
        body: trimmedBody
      });
      const nextComments = [...comments, created];
      setComments(nextComments);
      setIssue((previous) =>
        previous
          ? {
              ...previous,
              comment_count: previous.comment_count + 1
            }
          : previous
      );
      setCommentBody("");
      await Promise.all([refreshLatestRunStatus(), refreshCommentRunStatuses(nextComments)]);
    } catch (submitError) {
      setActionError(formatApiError(submitError));
    } finally {
      setCommentSubmitting(false);
    }
  }

  async function toggleIssueReaction(content: ReactionContent, viewerReacted: boolean) {
    if (!issue || !canReact) {
      return;
    }
    const reactionKey = `issue:${issue.id}`;
    setReactionPendingKey(reactionKey);
    setActionError(null);
    try {
      const reactions = viewerReacted
        ? await removeReaction(owner, repo, {
            subjectType: "issue",
            subjectId: issue.id,
            content
          })
        : await addReaction(owner, repo, {
            subjectType: "issue",
            subjectId: issue.id,
            content
          });
      setIssue((previous) => (previous ? { ...previous, reactions } : previous));
    } catch (error) {
      setActionError(formatApiError(error));
    } finally {
      setReactionPendingKey(null);
    }
  }

  async function toggleCommentReaction(
    commentId: string,
    content: ReactionContent,
    viewerReacted: boolean
  ) {
    if (!canReact) {
      return;
    }
    const reactionKey = `comment:${commentId}`;
    setReactionPendingKey(reactionKey);
    setActionError(null);
    try {
      const reactions = viewerReacted
        ? await removeReaction(owner, repo, {
            subjectType: "issue_comment",
            subjectId: commentId,
            content
          })
        : await addReaction(owner, repo, {
            subjectType: "issue_comment",
            subjectId: commentId,
            content
          });
      setComments((previous) =>
        previous.map((comment) => (comment.id === commentId ? { ...comment, reactions } : comment))
      );
    } catch (error) {
      setActionError(formatApiError(error));
    } finally {
      setReactionPendingKey(null);
    }
  }

  async function triggerAgentSession(intent: "assign" | "resume") {
    if (!canRunAgents || !issue || issue.state !== "open" || agentSubmitAction) {
      return;
    }

    setAgentSubmitAction(intent);
    setActionError(null);
    try {
      const response =
        intent === "assign"
          ? await assignIssueAgent(owner, repo, number, {
              agentType: selectedAgentType,
              ...(agentInstruction.trim() ? { prompt: agentInstruction.trim() } : {})
            })
          : await resumeIssueAgent(owner, repo, number, {
              agentType: selectedAgentType,
              ...(agentInstruction.trim() ? { prompt: agentInstruction.trim() } : {})
            });
      setLatestAgentSession(response.session);
      setLatestActionRun(response.run);
      setIssue((previous) =>
        response.issue
          ? response.issue
          : previous
            ? {
                ...previous,
                task_status: "agent-working"
              }
            : previous
      );
      setAgentInstruction("");
    } catch (error) {
      setActionError(formatApiError(error));
    } finally {
      setAgentSubmitAction(null);
    }
  }

  return (
    <div className="space-y-4">
      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      <header className="space-y-2 rounded-md border bg-[#f6f8fa] p-4">
        <h1 className="text-xl font-semibold">
          {issue.title} <span className="text-muted-foreground">#{issue.number}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <IssueTaskStatusBadge status={issue.task_status} />
          <RepositoryStateBadge state={issue.state} kind="issue" />
          <span>{issue.author_username}</span>
          <span>opened {formatRelativeTime(issue.created_at)}</span>
          <span>updated {formatDateTime(issue.updated_at)}</span>
          {latestActionRun ? (
            <Link
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              to={`/repo/${owner}/${repo}/actions?runId=${latestActionRun.id}`}
            >
              <ActionStatusBadge status={latestActionRun.status} withDot className="border-0 bg-transparent p-0 text-[11px] font-normal text-inherit shadow-none" />
            </Link>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to={`/repo/${owner}/${repo}/issues`}>返回 Issues</Link>
          </Button>
          {canUpdate ? (
            <PendingButton
              variant={issue.state === "open" ? "secondary" : "default"}
              pending={updating}
              pendingText={issue.state === "open" ? "Closing issue..." : "Reopening issue..."}
              onClick={() => {
                void changeState(issue.state === "open" ? "closed" : "open");
              }}
            >
              {issue.state === "open" ? "Close issue" : "Reopen issue"}
            </PendingButton>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-md border p-4">
            <MarkdownBody content={issue.body} emptyText="(no description)" />
            <ReactionStrip
              reactions={issue.reactions}
              disabled={reactionPendingKey === `issue:${issue.id}`}
              onToggle={
                canReact
                  ? (content, viewerReacted) => {
                      void toggleIssueReaction(content, viewerReacted);
                    }
                  : undefined
              }
            />
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Acceptance criteria</h2>
              <p className="text-sm text-muted-foreground">
                让 Issue 里始终保留一份稳定的完成定义，供 Agent 交付和人类验收对照。
              </p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <MarkdownBody
                content={issue.acceptance_criteria}
                emptyText="(no acceptance criteria)"
              />
            </div>
            {canUpdate ? (
              <div className="space-y-3">
                <MarkdownEditor
                  label="Edit acceptance criteria"
                  value={acceptanceCriteriaDraft}
                  onChange={setAcceptanceCriteriaDraft}
                  rows={6}
                  previewEmptyText="暂无验收标准。"
                />
                <div className="flex flex-wrap gap-2">
                  <PendingButton
                    pending={acceptanceCriteriaSaving}
                    pendingText="Saving acceptance criteria..."
                    disabled={acceptanceCriteriaDraft === issue.acceptance_criteria}
                    onClick={() => {
                      void saveAcceptanceCriteria();
                    }}
                  >
                    保存验收标准
                  </PendingButton>
                </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-base font-semibold">Comments ({comments.length})</h2>
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无评论。</p>
            ) : (
              <ul className="space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="rounded-md border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{comment.author_username}</span>
                      <span>commented {formatRelativeTime(comment.created_at)}</span>
                      <span>{formatDateTime(comment.created_at)}</span>
                      {latestRunByCommentId[comment.id] ? (
                        <Link
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                          to={`/repo/${owner}/${repo}/actions?runId=${latestRunByCommentId[comment.id].id}`}
                        >
                          <ActionStatusBadge
                            status={latestRunByCommentId[comment.id].status}
                            withDot
                            className="border-0 bg-transparent p-0 text-[11px] font-normal text-inherit shadow-none"
                          />
                        </Link>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <MarkdownBody content={comment.body} emptyText="(empty comment)" />
                    </div>
                    <div className="mt-3">
                      <ReactionStrip
                        reactions={comment.reactions}
                        disabled={reactionPendingKey === `comment:${comment.id}`}
                        onToggle={
                          canReact
                            ? (content, viewerReacted) => {
                                void toggleCommentReaction(comment.id, content, viewerReacted);
                              }
                            : undefined
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canComment ? (
            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-base font-semibold">Add comment</h2>
              <MarkdownEditor
                label="Comment"
                value={commentBody}
                onChange={setCommentBody}
                rows={6}
                placeholder="Leave a comment"
                previewEmptyText="Nothing to preview."
              />
              <div className="flex flex-wrap gap-2">
                <PendingButton
                  onClick={() => {
                    void submitComment();
                  }}
                  pending={commentSubmitting}
                  pendingText="Posting comment..."
                >
                  Comment
                </PendingButton>
              </div>
            </section>
          ) : (
            <section className="rounded-md border p-4 text-sm text-muted-foreground">
              仅仓库所有者或协作者可以发表评论。
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <section className="space-y-4 rounded-md border p-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Task center</h2>
              <p className="text-sm text-muted-foreground">
                这里展示当前在等谁、最近一轮交付状态，以及 Issue 作为任务入口的最小控制面。
              </p>
            </div>
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <IssueTaskStatusBadge status={issue.task_status} />
                <RepositoryStateBadge state={issue.state} kind="issue" />
              </div>
              <p className="text-sm text-muted-foreground">{issueTaskStatusHint(issue.task_status)}</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Comments: {issue.comment_count}</p>
                <p>Updated: {formatDateTime(issue.updated_at)}</p>
                <p>Linked pull requests: {linkedPullRequests.length}</p>
                <p>PRs with validation summary: {linkedPullRequestsWithValidation}</p>
              </div>
              {latestActionRun ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionStatusBadge status={latestActionRun.status} />
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/repo/${owner}/${repo}/actions?runId=${latestActionRun.id}`}>
                      查看最新 issue run
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">当前 Issue 还没有交付 run。</p>
              )}
            </div>
            {canUpdate ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="issue-task-status">Task status</Label>
                  <select
                    id="issue-task-status"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={taskStatusDraft}
                    onChange={(event) => setTaskStatusDraft(event.target.value as IssueTaskStatus)}
                  >
                    {ISSUE_TASK_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <PendingButton
                  pending={taskStatusSaving}
                  pendingText="Saving task status..."
                  disabled={taskStatusDraft === issue.task_status}
                  onClick={() => {
                    void saveTaskStatus();
                  }}
                >
                  保存任务状态
                </PendingButton>
              </div>
            ) : null}
          </section>

          <section className="space-y-4 rounded-md border p-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Linked pull requests</h2>
              <p className="text-sm text-muted-foreground">
                直接在 Issue 里回看当前交付入口，以及 PR 上的最新 Agent、run 和验证摘要。
              </p>
            </div>
            {linkedPullRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前 Issue 还没有关联的 pull request。</p>
            ) : (
              <div className="space-y-3">
                {linkedPullRequests.map((pullRequest) => {
                  const pullRequestProvenance =
                    latestPullRequestProvenanceByNumber[pullRequest.number] ?? null;
                  const pullRequestRun = pullRequestProvenance?.linkedRun ?? null;
                  const pullRequestSession = pullRequestProvenance?.session ?? null;
                  const pullRequestValidationStatus =
                    latestValidationStatus(pullRequestProvenance);
                  const pullRequestValidationDurationMs = usageRecordValue(
                    pullRequestProvenance,
                    "duration_ms"
                  );
                  const pullRequestValidationExitCode = usageRecordValue(
                    pullRequestProvenance,
                    "exit_code"
                  );
                  return (
                    <div key={pullRequest.id} className="space-y-3 rounded-md border bg-muted/20 p-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className="text-sm font-medium gh-link"
                            to={`/repo/${owner}/${repo}/pulls/${pullRequest.number}`}
                          >
                            PR #{pullRequest.number} {pullRequest.title}
                          </Link>
                          <RepositoryStateBadge
                            state={pullRequest.state}
                            kind="pull_request"
                            draft={pullRequest.draft}
                          />
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          <p>
                            {pullRequest.author_username} · {shortBranchName(pullRequest.head_ref)} into{" "}
                            {shortBranchName(pullRequest.base_ref)}
                          </p>
                          <p>Updated: {formatDateTime(pullRequest.updated_at)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {pullRequestSession ? (
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              to={`/repo/${owner}/${repo}/agent-sessions/${pullRequestSession.id}`}
                            >
                              Session · {pullRequestSession.status}
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">暂无 PR session</span>
                        )}
                        {pullRequestRun ? (
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              to={`/repo/${owner}/${repo}/actions?runId=${pullRequestRun.id}`}
                            >
                              Run · {pullRequestRun.status}
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">暂无 PR run</span>
                        )}
                      </div>
                      {pullRequestProvenance ? (
                        <div className="space-y-3 rounded-md border bg-background/70 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">Latest validation</span>
                            {pullRequestValidationStatus ? (
                              <ActionStatusBadge status={pullRequestValidationStatus} />
                            ) : null}
                            <Badge variant="outline">
                              artifacts: {pullRequestProvenance.artifacts.length}
                            </Badge>
                            {pullRequestValidationDurationMs !== null ? (
                              <Badge variant="outline">
                                {Math.round(pullRequestValidationDurationMs)} ms
                              </Badge>
                            ) : null}
                            {pullRequestValidationExitCode !== null ? (
                              <Badge variant="outline">
                                exit: {Math.round(pullRequestValidationExitCode)}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>
                              Updated:{" "}
                              {formatDateTime(
                                pullRequestRun?.updated_at ?? pullRequestSession?.updated_at ?? null
                              )}
                            </p>
                            <p>
                              Duration:{" "}
                              {formatDuration(
                                pullRequestRun?.started_at ?? pullRequestSession?.started_at ?? null,
                                pullRequestRun?.completed_at ??
                                  pullRequestSession?.completed_at ??
                                  null
                              )}
                            </p>
                          </div>
                          {pullRequestProvenance.artifacts.length > 0 ? (
                            <div className="space-y-2">
                              {pullRequestProvenance.artifacts.slice(0, 2).map((artifact) => (
                                <div
                                  key={artifact.id}
                                  className="space-y-1 rounded-md border bg-muted/20 p-3"
                                >
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <Badge variant="outline">{artifact.kind}</Badge>
                                    <span>{artifact.title}</span>
                                  </div>
                                  <p className="text-sm text-muted-foreground">
                                    {excerptText(artifact.content_text, 180) || "(empty artifact)"}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">暂无关键 artifact 摘要。</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          当前 PR 还没有可展示的验证摘要。
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-4 rounded-md border p-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Agent session</h2>
              <p className="text-sm text-muted-foreground">
                将当前 Issue 作为任务入口，创建或继续一个受仓库策略约束的 Agent session。
              </p>
            </div>

            {latestAgentSession ? (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ActionStatusBadge status={latestAgentSession.status} />
                  <span className="rounded-full border px-2 py-0.5 text-[11px]">
                    {latestAgentSession.agent_type}
                  </span>
                  <span className="rounded-full border px-2 py-0.5 text-[11px]">
                    {latestAgentSession.origin}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Session: {latestAgentSession.id}</p>
                  <p>Branch: {latestAgentSession.branch_ref ?? "-"}</p>
                  <p>Triggered by: {latestAgentSession.created_by_username ?? "system"}</p>
                  <p>Updated: {formatDateTime(latestAgentSession.updated_at)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/repo/${owner}/${repo}/agent-sessions/${latestAgentSession.id}`}>
                      查看 session
                    </Link>
                  </Button>
                  {latestAgentSession.linked_run_id ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        to={`/repo/${owner}/${repo}/actions?runId=${latestAgentSession.linked_run_id}`}
                      >
                        查看对应 run
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">当前 Issue 还没有 Agent session。</p>
            )}

            {canRunAgents ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="issue-agent-type">Agent</Label>
                  <select
                    id="issue-agent-type"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={selectedAgentType}
                    onChange={(event) =>
                      setSelectedAgentType(event.target.value as ActionAgentType)
                    }
                  >
                    {allowedAgentTypes.map((agentType) => (
                      <option key={agentType} value={agentType}>
                        {agentType}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="issue-agent-instruction">Extra instruction</Label>
                  <Textarea
                    id="issue-agent-instruction"
                    value={agentInstruction}
                    onChange={(event) => setAgentInstruction(event.target.value)}
                    rows={6}
                    placeholder="Optional guidance for the next session"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <PendingButton
                    pending={agentSubmitAction === "assign"}
                    disabled={agentSubmitAction !== null || issue.state !== "open"}
                    pendingText="Assigning agent..."
                    onClick={() => {
                      void triggerAgentSession("assign");
                    }}
                  >
                    分配 Agent
                  </PendingButton>
                  <PendingButton
                    variant="outline"
                    pending={agentSubmitAction === "resume"}
                    disabled={agentSubmitAction !== null || issue.state !== "open"}
                    pendingText="Resuming agent..."
                    onClick={() => {
                      void triggerAgentSession("resume");
                    }}
                  >
                    继续 Agent
                  </PendingButton>
                </div>
                <p className="text-xs text-muted-foreground">
                  运行日志仍会出现在 Actions 页面；Issue 这里保留的是面向任务的 session 视图。
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                仅仓库所有者或协作者可以为当前 Issue 运行 Agent。
              </p>
            )}
          </section>

          <section className="rounded-md border p-4">
            <RepositoryMetadataFields
              canEdit={canUpdate}
              labels={availableLabels}
              selectedLabelIds={selectedLabelIds}
              onSelectedLabelIdsChange={setSelectedLabelIds}
              participants={participants}
              assigneeIds={selectedAssigneeIds}
              onAssigneeIdsChange={setSelectedAssigneeIds}
              milestones={availableMilestones}
              milestoneId={selectedMilestoneId}
              onMilestoneIdChange={setSelectedMilestoneId}
              onSave={() => {
                void saveMetadata();
              }}
              saving={metadataSaving}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
