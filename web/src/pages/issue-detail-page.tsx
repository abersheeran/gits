import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { MarkdownBody } from "@/components/repository/markdown-body";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { ReactionStrip } from "@/components/repository/reaction-strip";
import { RepositoryMetadataFields } from "@/components/repository/repository-metadata-fields";
import { RepositoryStateBadge } from "@/components/repository/repository-state-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import { Textarea } from "@/components/ui/textarea";
import {
  addReaction,
  assignIssueAgent,
  listLatestAgentSessionsBySource,
  listLatestActionRunsByCommentIds,
  listLatestActionRunsBySource,
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
  type IssueRecord,
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

function isPendingAgentSession(session: AgentSessionRecord | null): boolean {
  return session?.status === "queued" || session?.status === "running";
}

export function IssueDetailPage({ user }: IssueDetailPageProps) {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const number = Number.parseInt(params.number ?? "", 10);

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [issue, setIssue] = useState<IssueRecord | null>(null);
  const [comments, setComments] = useState<IssueCommentRecord[]>([]);
  const [availableLabels, setAvailableLabels] = useState<RepositoryLabelRecord[]>([]);
  const [availableMilestones, setAvailableMilestones] = useState<RepositoryMilestoneRecord[]>([]);
  const [participants, setParticipants] = useState<RepositoryUserSummary[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [latestActionRun, setLatestActionRun] = useState<ActionRunRecord | null>(null);
  const [latestAgentSession, setLatestAgentSession] = useState<AgentSessionRecord | null>(null);
  const [selectedAgentType, setSelectedAgentType] = useState<ActionAgentType>("codex");
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentSubmitAction, setAgentSubmitAction] = useState<"assign" | "resume" | null>(null);
  const [latestRunByCommentId, setLatestRunByCommentId] = useState<Record<string, ActionRunRecord>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
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
          nextIssue,
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
        const latestCommentRunItems =
          nextComments.length > 0
            ? await listLatestActionRunsByCommentIds(
                owner,
                repo,
                nextComments.map((comment) => comment.id)
              )
            : [];
        if (canceled) {
          return;
        }
        const nextRunByCommentId: Record<string, ActionRunRecord> = {};
        for (const item of latestCommentRunItems) {
          if (item.run) {
            nextRunByCommentId[item.commentId] = item.run;
          }
        }
        setDetail(nextDetail);
        setIssue(nextIssue);
        setComments(nextComments);
        setAvailableLabels(nextLabels);
        setAvailableMilestones(nextMilestones);
        setParticipants(nextParticipants);
        setLatestActionRun(latestRunItems[0]?.run ?? null);
        setLatestAgentSession(latestSessionItems[0]?.session ?? null);
        setLatestRunByCommentId(nextRunByCommentId);
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
  }, [issue]);

  const hasPendingRun =
    latestActionRun !== null &&
    (latestActionRun.status === "queued" || latestActionRun.status === "running");
  const hasPendingAgentSession = isPendingAgentSession(latestAgentSession);
  const hasPendingCommentRun = comments.some((comment) => {
    const run = latestRunByCommentId[comment.id];
    return run ? run.status === "queued" || run.status === "running" : false;
  });

  useEffect(() => {
    if (
      (!hasPendingRun && !hasPendingAgentSession && !hasPendingCommentRun) ||
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
          refreshCommentRunStatuses()
        ]);
      } catch {
        // Ignore transient polling errors.
      }
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [comments, hasPendingAgentSession, hasPendingCommentRun, hasPendingRun, number, owner, repo]);

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
