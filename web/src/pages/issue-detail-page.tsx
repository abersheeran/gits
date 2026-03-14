import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { IssueAcceptanceCriteriaPanel } from "@/components/repository/issue-acceptance-criteria-panel";
import { IssueTaskStatusBadge } from "@/components/repository/issue-task-status-badge";
import { MarkdownBody } from "@/components/repository/markdown-body";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { RepositoryStateBadge } from "@/components/repository/repository-state-badge";
import { DetailSection } from "@/components/common/detail-section";
import { HelpTip } from "@/components/common/help-tip";
import { LabeledSelectField } from "@/components/common/labeled-select-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import { Textarea } from "@/components/ui/textarea";
import {
  assignIssueAgent,
  type AgentSessionDetail,
  listLatestAgentSessionsByCommentIds,
  listLatestAgentSessionsBySource,
  listLatestPullRequestProvenance,
  createIssueComment,
  formatApiError,
  getIssue,
  getRepositoryDetail,
  listIssueComments,
  resumeIssueAgent,
  updateIssue,
  type ActionAgentType,
  type AgentSessionRecord,
  type AuthUser,
  type IssueCommentRecord,
  type IssueDetailResponse,
  type IssueLinkedPullRequestRecord,
  type IssueRecord,
  type IssueTaskFlowRecord,
  type IssueTaskStatus,
  type RepositoryDetailResponse,
  type TaskFlowWaitingOn
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import {
  excerptText,
  formatDuration,
  highlightedValidationArtifacts,
  latestValidationStatus,
  validationCheckBadgeVariant,
  validationCheckStatusLabel
} from "@/lib/validation-summary";

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
const ISSUE_TASK_STATUS_SELECT_OPTIONS = ISSUE_TASK_STATUS_OPTIONS.map((status) => ({
  value: status,
  label: status
}));
const FALLBACK_AGENT_TYPE_OPTIONS = FALLBACK_AGENT_TYPES.map((agentType) => ({
  value: agentType,
  label: agentType
}));

function isPendingAgentSession(session: AgentSessionRecord | null): boolean {
  return session?.status === "queued" || session?.status === "running";
}

function shortBranchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

function taskFlowWaitingLabel(waitingOn: TaskFlowWaitingOn): string {
  if (waitingOn === "agent") {
    return "Waiting on Agent";
  }
  if (waitingOn === "human") {
    return "Waiting on Human";
  }
  return "No active blocker";
}

export function IssueDetailPage({ user }: IssueDetailPageProps) {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const number = Number.parseInt(params.number ?? "", 10);

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [issue, setIssue] = useState<IssueRecord | null>(null);
  const [linkedPullRequests, setLinkedPullRequests] = useState<IssueLinkedPullRequestRecord[]>([]);
  const [taskFlow, setTaskFlow] = useState<IssueTaskFlowRecord | null>(null);
  const [comments, setComments] = useState<IssueCommentRecord[]>([]);
  const [latestIssueSession, setLatestIssueSession] = useState<AgentSessionRecord | null>(null);
  const [latestPullRequestProvenanceByNumber, setLatestPullRequestProvenanceByNumber] =
    useState<Record<number, AgentSessionDetail | null>>({});
  const [selectedAgentType, setSelectedAgentType] = useState<ActionAgentType>("codex");
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentSubmitAction, setAgentSubmitAction] = useState<"assign" | "resume" | null>(null);
  const [latestSessionByCommentId, setLatestSessionByCommentId] = useState<
    Record<string, AgentSessionRecord>
  >({});
  const [taskStatusDraft, setTaskStatusDraft] = useState<IssueTaskStatus>("open");
  const [acceptanceCriteriaDraft, setAcceptanceCriteriaDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [taskStatusSaving, setTaskStatusSaving] = useState(false);
  const [acceptanceCriteriaSaving, setAcceptanceCriteriaSaving] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentEditorExpanded, setCommentEditorExpanded] = useState(false);

  const refreshLatestIssueSession = useCallback(async (): Promise<void> => {
    if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
      return;
    }
    const latestSessionItems = await listLatestAgentSessionsBySource(owner, repo, {
      sourceType: "issue",
      numbers: [number]
    });
    setLatestIssueSession(latestSessionItems[0]?.session ?? null);
  }, [number, owner, repo]);

  const refreshIssueDetail = useCallback(async (): Promise<IssueDetailResponse | null> => {
    if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
      return null;
    }
    const nextIssueDetail = await getIssue(owner, repo, number);
    setIssue(nextIssueDetail.issue);
    setLinkedPullRequests(nextIssueDetail.linkedPullRequests);
    setTaskFlow(nextIssueDetail.taskFlow);
    return nextIssueDetail;
  }, [number, owner, repo]);

  const refreshCommentSessionStatuses = useCallback(async (
    nextCommentsInput?: IssueCommentRecord[]
  ): Promise<void> => {
    const nextComments = nextCommentsInput ?? comments;
    if (!owner || !repo || nextComments.length === 0) {
      setLatestSessionByCommentId({});
      return;
    }
    const latestSessionItems = await listLatestAgentSessionsByCommentIds(
      owner,
      repo,
      nextComments.map((comment) => comment.id)
    );
    const nextSessionByCommentId: Record<string, AgentSessionRecord> = {};
    for (const item of latestSessionItems) {
      if (item.session) {
        nextSessionByCommentId[item.commentId] = item.session;
      }
    }
    setLatestSessionByCommentId(nextSessionByCommentId);
  }, [comments, owner, repo]);

  const refreshLinkedPullRequestProvenance = useCallback(async (
    nextLinkedPullRequestsInput?: IssueLinkedPullRequestRecord[]
  ): Promise<void> => {
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
  }, [linkedPullRequests, owner, repo]);

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
          latestSessionItems
        ] = await Promise.all([
          getRepositoryDetail(owner, repo),
          getIssue(owner, repo, number),
          listIssueComments(owner, repo, number),
          listLatestAgentSessionsBySource(owner, repo, {
            sourceType: "issue",
            numbers: [number]
          })
        ]);
        const latestCommentSessionItemsPromise =
          nextComments.length > 0
            ? listLatestAgentSessionsByCommentIds(
                owner,
                repo,
                nextComments.map((comment) => comment.id)
              )
            : Promise.resolve([]);
        const linkedPullRequestNumbers = nextIssueDetail.linkedPullRequests.map(
          (pullRequest) => pullRequest.number
        );
        const [latestCommentSessionItems, latestPullRequestProvenanceItems] = await Promise.all([
          latestCommentSessionItemsPromise,
          linkedPullRequestNumbers.length > 0
            ? listLatestPullRequestProvenance(owner, repo, linkedPullRequestNumbers)
            : Promise.resolve([])
        ]);
        if (canceled) {
          return;
        }
        const nextSessionByCommentId: Record<string, AgentSessionRecord> = {};
        const nextPullRequestProvenanceByNumber: Record<number, AgentSessionDetail | null> = {};
        for (const item of latestCommentSessionItems) {
          if (item.session) {
            nextSessionByCommentId[item.commentId] = item.session;
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
        setTaskFlow(nextIssueDetail.taskFlow);
        setComments(nextComments);
        setLatestIssueSession(latestSessionItems[0]?.session ?? null);
        setLatestSessionByCommentId(nextSessionByCommentId);
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
    setTaskStatusDraft(issue.task_status);
    setAcceptanceCriteriaDraft(issue.acceptance_criteria);
  }, [issue]);

  const hasPendingIssueSession = isPendingAgentSession(latestIssueSession);
  const hasPendingCommentSession = comments.some((comment) => {
    const session = latestSessionByCommentId[comment.id];
    return session ? session.status === "queued" || session.status === "running" : false;
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
      (!hasPendingIssueSession &&
        !hasPendingCommentSession &&
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
        const nextIssueDetail = await refreshIssueDetail();
        await Promise.all([
          refreshLatestIssueSession(),
          refreshCommentSessionStatuses(),
          refreshLinkedPullRequestProvenance(nextIssueDetail?.linkedPullRequests)
        ]);
      } catch {
        // Ignore transient polling errors.
      }
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    hasPendingCommentSession,
    hasPendingIssueSession,
    hasPendingPullRequestValidation,
    number,
    owner,
    refreshCommentSessionStatuses,
    refreshIssueDetail,
    refreshLatestIssueSession,
    refreshLinkedPullRequestProvenance,
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

  if (loading || !detail || !issue || !taskFlow) {
    return (
      <PageLoadingState
        title="Loading issue"
        description={`Fetching issue #${number} and its conversation history.`}
      />
    );
  }

  const canUpdate = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canComment = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canRunAgents = detail.permissions.canRunAgents && Boolean(user);
  const currentTaskFlow: IssueTaskFlowRecord = taskFlow;

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
      await refreshIssueDetail();
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
      await refreshIssueDetail();
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
      setCommentEditorExpanded(false);
      await Promise.all([refreshLatestIssueSession(), refreshCommentSessionStatuses(nextComments)]);
    } catch (submitError) {
      setActionError(formatApiError(submitError));
    } finally {
      setCommentSubmitting(false);
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
      setLatestIssueSession(response.session);
      if (response.issue) {
        setIssue(response.issue);
      }
      const nextIssueDetail = await refreshIssueDetail();
      await refreshLinkedPullRequestProvenance(nextIssueDetail?.linkedPullRequests);
      setAgentInstruction("");
    } catch (error) {
      setActionError(formatApiError(error));
    } finally {
      setAgentSubmitAction(null);
    }
  }

  return (
    <div className="app-page">
      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      <header className="page-hero space-y-3">
        <h1 className="font-display text-heading-3-16-semibold text-text-primary md:text-card-title">
          {issue.title} <span className="text-muted-foreground">#{issue.number}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-body-sm text-text-secondary">
          <IssueTaskStatusBadge status={currentTaskFlow.status} />
          <RepositoryStateBadge state={issue.state} kind="issue" />
          <span>{issue.author_username}</span>
          <span>opened {formatRelativeTime(issue.created_at)}</span>
          <span>updated {formatDateTime(issue.updated_at)}</span>
          {latestIssueSession ? (
            <Link
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              to={`/repo/${owner}/${repo}/actions?sessionId=${latestIssueSession.id}`}
            >
              <ActionStatusBadge status={latestIssueSession.status} withDot className="border-0 bg-transparent p-0 text-[11px] font-normal text-inherit shadow-none" />
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
          <DetailSection contentClassName="space-y-3">
            <MarkdownBody content={issue.body} emptyText="(no description)" />
          </DetailSection>

          <IssueAcceptanceCriteriaPanel
            canUpdate={canUpdate}
            content={issue.acceptance_criteria}
            draft={acceptanceCriteriaDraft}
            onDraftChange={setAcceptanceCriteriaDraft}
            saving={acceptanceCriteriaSaving}
            onSave={() => {
              void saveAcceptanceCriteria();
            }}
          />

          <DetailSection title={`Comments (${comments.length})`} contentClassName="space-y-3">
            {comments.length === 0 ? (
              <p className="text-body-sm text-text-secondary">暂无评论。</p>
            ) : (
              <ul className="space-y-3">
                {comments.map((comment) => (
                  <li
                    key={comment.id}
                    className="panel-inset-compact"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{comment.author_username}</span>
                      <span>commented {formatRelativeTime(comment.created_at)}</span>
                      <span>{formatDateTime(comment.created_at)}</span>
                      {latestSessionByCommentId[comment.id] ? (
                        <Link
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                          to={`/repo/${owner}/${repo}/actions?sessionId=${latestSessionByCommentId[comment.id].id}`}
                        >
                          <ActionStatusBadge
                            status={latestSessionByCommentId[comment.id].status}
                            withDot
                            className="border-0 bg-transparent p-0 text-[11px] font-normal text-inherit shadow-none"
                          />
                        </Link>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <MarkdownBody content={comment.body} emptyText="(empty comment)" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>

          {canComment ? (
            <DetailSection
              variant="muted"
              title="Add comment"
            >
              <MarkdownEditor
                label="Comment"
                value={commentBody}
                onChange={setCommentBody}
                rows={6}
                placeholder="Leave a comment"
                previewEmptyText="Nothing to preview."
                collapsible
                expanded={commentEditorExpanded}
                onExpandedChange={setCommentEditorExpanded}
                enterEditLabel="Add comment"
                collapsedHint="补充任务进展、说明验收结果，或继续推进当前 Issue。"
              />
              {commentEditorExpanded ? (
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
              ) : null}
            </DetailSection>
          ) : (
            <DetailSection contentClassName="text-body-sm text-text-secondary">
              仅仓库所有者或协作者可以发表评论。
            </DetailSection>
          )}
        </div>

        <aside className="space-y-4">
          <DetailSection
            title={
              <>
                Task center <HelpTip content="查看任务状态、最近交付和 Agent 操作。" />
              </>
            }
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <IssueTaskStatusBadge status={currentTaskFlow.status} />
                <RepositoryStateBadge state={issue.state} kind="issue" />
                <Badge variant="outline">{taskFlowWaitingLabel(currentTaskFlow.waiting_on)}</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{currentTaskFlow.headline}</p>
                <p className="text-sm text-muted-foreground">{currentTaskFlow.detail}</p>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Comments: {issue.comment_count}</p>
                <p>Updated: {formatDateTime(issue.updated_at)}</p>
                <p>Linked pull requests: {linkedPullRequests.length}</p>
                <p>PRs with validation summary: {linkedPullRequestsWithValidation}</p>
                {currentTaskFlow.driver_pull_request_number !== null ? (
                  <p>
                    Driver pull request:{" "}
                    <Link
                      className="gh-link"
                      to={`/repo/${owner}/${repo}/pulls/${currentTaskFlow.driver_pull_request_number}`}
                    >
                      #{currentTaskFlow.driver_pull_request_number}
                    </Link>
                  </p>
                ) : null}
              </div>
              {latestIssueSession ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionStatusBadge status={latestIssueSession.status} />
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/repo/${owner}/${repo}/actions?sessionId=${latestIssueSession.id}`}>
                      查看最新 issue session
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">当前 Issue 还没有交付 session。</p>
              )}
            </div>
            {canUpdate ? (
              <div className="space-y-3">
                <LabeledSelectField
                  id="issue-task-status"
                  label="Task status"
                  value={taskStatusDraft}
                  onValueChange={(nextStatus) => setTaskStatusDraft(nextStatus)}
                  options={ISSUE_TASK_STATUS_SELECT_OPTIONS}
                />
                <div className="flex flex-wrap items-center gap-2">
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
                  <HelpTip content="手动修改 task status 仅作为临时覆盖；后续 assign/resume、PR review、thread 处理、merge 与 session 完成都会按主流程自动回写。" />
                </div>
              </div>
            ) : null}
          </DetailSection>

          <DetailSection
            title={
              <>
                Linked pull requests{" "}
                <HelpTip content="直接在 Issue 里回看当前交付入口，以及 PR 上的最新 Agent session 和验证摘要。" />
              </>
            }
          >
            {linkedPullRequests.length === 0 ? (
              <p className="text-body-sm text-text-secondary">
                当前 Issue 还没有关联的 pull request。
              </p>
            ) : (
              <div className="space-y-3">
                {linkedPullRequests.map((pullRequest) => {
                  const pullRequestProvenance =
                    latestPullRequestProvenanceByNumber[pullRequest.number] ?? null;
                  const pullRequestSession = pullRequestProvenance?.session ?? null;
                  const pullRequestValidationStatus =
                    latestValidationStatus(pullRequestProvenance);
                  const pullRequestValidationSummary =
                    pullRequestProvenance?.validationSummary ?? null;
                  const pullRequestValidationDurationMs =
                    pullRequestValidationSummary?.duration_ms ?? null;
                  const pullRequestValidationExitCode =
                    pullRequestValidationSummary?.exit_code ?? null;
                  const pullRequestHighlightedArtifacts =
                    highlightedValidationArtifacts(pullRequestProvenance).slice(0, 2);
                  return (
                    <div key={pullRequest.id} className="panel-inset-compact space-y-3">
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
                      </div>
                      {pullRequestProvenance ? (
                        <div className="space-y-3">
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
                          <div className="space-y-1">
                            <p className="text-sm font-medium">
                              {pullRequestValidationSummary?.headline ??
                                "Structured validation summary unavailable."}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {pullRequestValidationSummary?.detail ??
                                "The latest validation output has not been turned into a reviewable summary yet."}
                            </p>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>
                              Updated:{" "}
                              {formatDateTime(pullRequestSession?.updated_at ?? null)}
                            </p>
                            <p>
                              Duration:{" "}
                              {formatDuration(
                                pullRequestSession?.started_at ?? null,
                                pullRequestSession?.completed_at ?? null
                              )}
                            </p>
                          </div>
                          {pullRequestValidationSummary?.checks.length ? (
                            <div className="flex flex-wrap gap-2">
                              {pullRequestValidationSummary.checks.map((check) => (
                                <Badge
                                  key={`${check.kind}:${check.scope ?? ""}:${check.command}`}
                                  variant={validationCheckBadgeVariant(check.status)}
                                >
                                  {validationCheckStatusLabel(check)}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              当前还没有从输出中识别出明确的 test / build / lint 命令。
                            </p>
                          )}
                          {pullRequestHighlightedArtifacts.length > 0 ? (
                            <div className="space-y-2">
                              {pullRequestHighlightedArtifacts.map((artifact) => (
                                <div key={artifact.id} className="space-y-1">
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
          </DetailSection>

          <DetailSection
            title={
              <>
                Agent session{" "}
                <HelpTip content="将当前 Issue 作为任务入口，创建或继续一个受仓库策略约束的 Agent session。" />
              </>
            }
          >

            {latestIssueSession ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ActionStatusBadge status={latestIssueSession.status} />
                  <span className="rounded-full border px-2 py-0.5 text-[11px]">
                    {latestIssueSession.agent_type}
                  </span>
                  <span className="rounded-full border px-2 py-0.5 text-[11px]">
                    {latestIssueSession.origin}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Session: {latestIssueSession.id}</p>
                  <p>Branch: {latestIssueSession.branch_ref ?? "-"}</p>
                  <p>Triggered by: {latestIssueSession.created_by_username ?? "system"}</p>
                  <p>Updated: {formatDateTime(latestIssueSession.updated_at)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/repo/${owner}/${repo}/agent-sessions/${latestIssueSession.id}`}>
                      查看 session
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-body-sm text-text-secondary">当前 Issue 还没有 Agent session。</p>
            )}

            {canRunAgents ? (
              <div className="space-y-3">
                <LabeledSelectField
                  id="issue-agent-type"
                  label="Agent"
                  value={selectedAgentType}
                  onValueChange={(nextAgentType) => setSelectedAgentType(nextAgentType)}
                  options={FALLBACK_AGENT_TYPE_OPTIONS}
                />
                <div className="space-y-2">
                  <Label htmlFor="issue-agent-instruction">Extra instruction</Label>
                  <Textarea
                    id="issue-agent-instruction"
                    value={agentInstruction}
                    onChange={(event) => setAgentInstruction(event.target.value)}
                    rows={6}
                    placeholder="Optional guidance for the next session"
                    className="min-h-[180px] bg-surface-focus"
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
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                仅仓库所有者或协作者可以为当前 Issue 运行 Agent。
              </p>
            )}
          </DetailSection>

        </aside>
      </div>
    </div>
  );
}
