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
import {
  addReaction,
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
  updateIssue,
  type ActionRunRecord,
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
  const hasPendingCommentRun = comments.some((comment) => {
    const run = latestRunByCommentId[comment.id];
    return run ? run.status === "queued" || run.status === "running" : false;
  });

  useEffect(() => {
    if (
      (!hasPendingRun && !hasPendingCommentRun) ||
      !owner ||
      !repo ||
      !Number.isInteger(number) ||
      number <= 0
    ) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        await Promise.all([refreshLatestRunStatus(), refreshCommentRunStatuses()]);
      } catch {
        // Ignore transient polling errors.
      }
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [comments, hasPendingCommentRun, hasPendingRun, number, owner, repo]);

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
    return <p className="text-sm text-muted-foreground">正在加载 issue...</p>;
  }

  const canUpdate = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canComment = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canReact = Boolean(user);

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
            <Button
              variant={issue.state === "open" ? "secondary" : "default"}
              disabled={updating}
              onClick={() => {
                void changeState(issue.state === "open" ? "closed" : "open");
              }}
            >
              {issue.state === "open" ? "Close issue" : "Reopen issue"}
            </Button>
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
                <Button
                  onClick={() => {
                    void submitComment();
                  }}
                  disabled={commentSubmitting}
                >
                  {commentSubmitting ? "Submitting..." : "Comment"}
                </Button>
              </div>
            </section>
          ) : (
            <section className="rounded-md border p-4 text-sm text-muted-foreground">
              仅仓库所有者或协作者可以发表评论。
            </section>
          )}
        </div>

        <aside className="space-y-4">
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
