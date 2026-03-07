import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { MarkdownBody } from "@/components/repository/markdown-body";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { ReactionStrip } from "@/components/repository/reaction-strip";
import { RepositoryDiffView } from "@/components/repository/repository-diff-view";
import { RepositoryMetadataFields } from "@/components/repository/repository-metadata-fields";
import { RepositoryStateBadge } from "@/components/repository/repository-state-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  addReaction,
  compareRepositoryRefs,
  listLatestActionRunsBySource,
  createPullRequestReview,
  formatApiError,
  getPullRequest,
  getRepositoryDetail,
  listRepositoryLabels,
  listRepositoryMilestones,
  listRepositoryParticipants,
  listPullRequestReviews,
  removeReaction,
  updatePullRequest,
  type ActionRunRecord,
  type AuthUser,
  type PullRequestReviewDecision,
  type PullRequestReviewRecord,
  type PullRequestReviewSummary,
  type PullRequestRecord,
  type ReactionContent,
  type RepositoryCompareResponse,
  type RepositoryDetailResponse,
  type RepositoryLabelRecord,
  type RepositoryMilestoneRecord,
  type RepositoryUserSummary
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type PullRequestDetailPageProps = {
  user: AuthUser | null;
};

function stripHeadsRef(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

function applyComparisonToPullRequest(
  pullRequest: PullRequestRecord,
  comparison: RepositoryCompareResponse | null
): PullRequestRecord {
  return {
    ...pullRequest,
    mergeable: comparison?.mergeable,
    ahead_by: comparison?.aheadBy,
    behind_by: comparison?.behindBy,
    changed_files: comparison?.filesChanged,
    additions: comparison?.additions,
    deletions: comparison?.deletions
  };
}

function mergeabilityBadgeVariant(
  mergeable: RepositoryCompareResponse["mergeable"]
): "default" | "destructive" | "secondary" {
  if (mergeable === "mergeable") {
    return "default";
  }
  if (mergeable === "conflicting") {
    return "destructive";
  }
  return "secondary";
}

function mergeabilityLabel(mergeable: RepositoryCompareResponse["mergeable"]): string {
  if (mergeable === "mergeable") {
    return "Mergeable";
  }
  if (mergeable === "conflicting") {
    return "Conflicting";
  }
  return "Mergeability unknown";
}

export function PullRequestDetailPage({ user }: PullRequestDetailPageProps) {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const number = Number.parseInt(params.number ?? "", 10);

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestRecord | null>(null);
  const [reviews, setReviews] = useState<PullRequestReviewRecord[]>([]);
  const [availableLabels, setAvailableLabels] = useState<RepositoryLabelRecord[]>([]);
  const [availableMilestones, setAvailableMilestones] = useState<RepositoryMilestoneRecord[]>([]);
  const [participants, setParticipants] = useState<RepositoryUserSummary[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([]);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [latestActionRun, setLatestActionRun] = useState<ActionRunRecord | null>(null);
  const [closingIssueNumbers, setClosingIssueNumbers] = useState<number[]>([]);
  const [comparison, setComparison] = useState<RepositoryCompareResponse | null>(null);
  const [reviewSummary, setReviewSummary] = useState<PullRequestReviewSummary>({
    approvals: 0,
    changeRequests: 0,
    comments: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [reactionPendingKey, setReactionPendingKey] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<PullRequestReviewDecision>("comment");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [
          nextDetail,
          nextPullRequestDetail,
          nextReviews,
          nextLabels,
          nextMilestones,
          nextParticipants
        ] = await Promise.all([
          getRepositoryDetail(owner, repo),
          getPullRequest(owner, repo, number),
          listPullRequestReviews(owner, repo, number),
          listRepositoryLabels(owner, repo),
          listRepositoryMilestones(owner, repo),
          user ? listRepositoryParticipants(owner, repo) : Promise.resolve([])
        ]);
        const nextComparison = await compareRepositoryRefs(owner, repo, {
          baseRef: nextPullRequestDetail.pullRequest.base_ref,
          headRef: nextPullRequestDetail.pullRequest.head_ref
        }).catch(() => null);
        const latestRunItems = await listLatestActionRunsBySource(owner, repo, {
          sourceType: "pull_request",
          numbers: [number]
        });
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setPullRequest(applyComparisonToPullRequest(nextPullRequestDetail.pullRequest, nextComparison));
        setClosingIssueNumbers(nextPullRequestDetail.closingIssueNumbers);
        setReviews(nextReviews.reviews);
        setReviewSummary(nextReviews.reviewSummary);
        setAvailableLabels(nextLabels);
        setAvailableMilestones(nextMilestones);
        setParticipants(nextParticipants);
        setComparison(nextComparison);
        setLatestActionRun(latestRunItems[0]?.run ?? null);
      } catch (loadError) {
        if (!canceled) {
          setError(formatApiError(loadError));
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
    if (!pullRequest) {
      return;
    }
    setSelectedLabelIds(pullRequest.labels.map((label) => label.id));
    setSelectedAssigneeIds(pullRequest.assignees.map((assignee) => assignee.id));
    setSelectedReviewerIds(pullRequest.requested_reviewers.map((reviewer) => reviewer.id));
    setSelectedMilestoneId(pullRequest.milestone?.id ?? null);
    setDraft(pullRequest.draft);
  }, [pullRequest]);

  const hasPendingRun =
    latestActionRun !== null &&
    (latestActionRun.status === "queued" || latestActionRun.status === "running");

  useEffect(() => {
    if (!hasPendingRun || !owner || !repo || !Number.isInteger(number) || number <= 0) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const latestRunItems = await listLatestActionRunsBySource(owner, repo, {
          sourceType: "pull_request",
          numbers: [number]
        });
        setLatestActionRun(latestRunItems[0]?.run ?? null);
      } catch {
        // Ignore transient polling errors.
      }
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingRun, number, owner, repo]);

  if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>PR 编号无效。</AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !detail || !pullRequest) {
    return <p className="text-sm text-muted-foreground">正在加载 pull request...</p>;
  }

  const canUpdate = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canReview = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canReact = Boolean(user);

  async function saveMetadata() {
    if (metadataSaving) {
      return;
    }
    setMetadataSaving(true);
    setError(null);
    try {
      const updated = await updatePullRequest(owner, repo, number, {
        draft,
        labelIds: selectedLabelIds,
        assigneeUserIds: selectedAssigneeIds,
        requestedReviewerIds: selectedReviewerIds,
        milestoneId: selectedMilestoneId
      });
      const nextComparison = await compareRepositoryRefs(owner, repo, {
        baseRef: updated.base_ref,
        headRef: updated.head_ref
      }).catch(() => null);
      setPullRequest(applyComparisonToPullRequest(updated, nextComparison));
      setComparison(nextComparison);
    } catch (error) {
      setError(formatApiError(error));
    } finally {
      setMetadataSaving(false);
    }
  }

  async function changeState(nextState: "open" | "closed" | "merged") {
    if (updating) {
      return;
    }
    setUpdating(true);
    setError(null);
    try {
      const updated = await updatePullRequest(owner, repo, number, {
        state: nextState
      });
      const nextComparison = await compareRepositoryRefs(owner, repo, {
        baseRef: updated.base_ref,
        headRef: updated.head_ref
      }).catch(() => null);
      setPullRequest(applyComparisonToPullRequest(updated, nextComparison));
      setComparison(nextComparison);
      if (nextState === "merged") {
        const next = await getPullRequest(owner, repo, number);
        setClosingIssueNumbers(next.closingIssueNumbers);
      }
    } catch (updateError) {
      setError(formatApiError(updateError));
    } finally {
      setUpdating(false);
    }
  }

  async function submitReview() {
    if (reviewSubmitting) {
      return;
    }
    setReviewSubmitting(true);
    setError(null);
    try {
      const created = await createPullRequestReview(owner, repo, number, {
        decision: reviewDecision,
        body: reviewBody
      });
      setReviews((previous) => [...previous, created.review]);
      setReviewSummary(created.reviewSummary);
      setReviewBody("");
      setReviewDecision("comment");
    } catch (submitError) {
      setError(formatApiError(submitError));
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function togglePullRequestReaction(content: ReactionContent, viewerReacted: boolean) {
    if (!pullRequest || !canReact) {
      return;
    }
    const reactionKey = `pull:${pullRequest.id}`;
    setReactionPendingKey(reactionKey);
    setError(null);
    try {
      const reactions = viewerReacted
        ? await removeReaction(owner, repo, {
            subjectType: "pull_request",
            subjectId: pullRequest.id,
            content
          })
        : await addReaction(owner, repo, {
            subjectType: "pull_request",
            subjectId: pullRequest.id,
            content
          });
      setPullRequest((previous) => (previous ? { ...previous, reactions } : previous));
    } catch (error) {
      setError(formatApiError(error));
    } finally {
      setReactionPendingKey(null);
    }
  }

  async function toggleReviewReaction(
    reviewId: string,
    content: ReactionContent,
    viewerReacted: boolean
  ) {
    if (!canReact) {
      return;
    }
    const reactionKey = `review:${reviewId}`;
    setReactionPendingKey(reactionKey);
    setError(null);
    try {
      const reactions = viewerReacted
        ? await removeReaction(owner, repo, {
            subjectType: "pull_request_review",
            subjectId: reviewId,
            content
          })
        : await addReaction(owner, repo, {
            subjectType: "pull_request_review",
            subjectId: reviewId,
            content
          });
      setReviews((previous) =>
        previous.map((review) => (review.id === reviewId ? { ...review, reactions } : review))
      );
    } catch (error) {
      setError(formatApiError(error));
    } finally {
      setReactionPendingKey(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <header className="space-y-2 rounded-md border bg-[#f6f8fa] p-4">
        <h1 className="text-xl font-semibold">
          {pullRequest.title} <span className="text-muted-foreground">#{pullRequest.number}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <RepositoryStateBadge state={pullRequest.state} kind="pull_request" />
          <span>{pullRequest.author_username}</span>
          <span>opened {formatRelativeTime(pullRequest.created_at)}</span>
          <span>updated {formatDateTime(pullRequest.updated_at)}</span>
          {latestActionRun ? (
            <Link
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              to={`/repo/${owner}/${repo}/actions?runId=${latestActionRun.id}`}
            >
              <ActionStatusBadge status={latestActionRun.status} withDot className="border-0 bg-transparent p-0 text-[11px] font-normal text-inherit shadow-none" />
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {stripHeadsRef(pullRequest.head_ref)} → {stripHeadsRef(pullRequest.base_ref)}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Approvals: {reviewSummary.approvals}</Badge>
          <Badge variant="outline">Changes requested: {reviewSummary.changeRequests}</Badge>
          <Badge variant="outline">Comments: {reviewSummary.comments}</Badge>
          {comparison ? (
            <>
              <Badge variant={mergeabilityBadgeVariant(comparison.mergeable)}>
                {mergeabilityLabel(comparison.mergeable)}
              </Badge>
              <Badge variant="outline">Ahead: {comparison.aheadBy}</Badge>
              <Badge variant="outline">Behind: {comparison.behindBy}</Badge>
              <Badge variant="outline">Files changed: {comparison.filesChanged}</Badge>
              <Badge variant="outline">+{comparison.additions}</Badge>
              <Badge variant="outline">-{comparison.deletions}</Badge>
            </>
          ) : null}
        </div>
        {closingIssueNumbers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Will close on merge:</span>
            {closingIssueNumbers.map((issueNumber) => (
              <Link
                key={issueNumber}
                className="text-[#0969da] hover:underline"
                to={`/repo/${owner}/${repo}/issues/${issueNumber}`}
              >
                #{issueNumber}
              </Link>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to={`/repo/${owner}/${repo}/pulls`}>返回 Pull requests</Link>
          </Button>
          {canUpdate ? (
            <Button
              variant={pullRequest.state === "open" ? "secondary" : "default"}
              disabled={updating}
              onClick={() => {
                void changeState(pullRequest.state === "open" ? "closed" : "open");
              }}
            >
              {pullRequest.state === "open" ? "Close pull request" : "Reopen pull request"}
            </Button>
          ) : null}
          {canUpdate && pullRequest.state === "open" ? (
            <Button
              disabled={updating}
              onClick={() => {
                void changeState("merged");
              }}
            >
              Squash and merge
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-md border p-4">
            <MarkdownBody content={pullRequest.body} emptyText="(no description)" />
            <ReactionStrip
              reactions={pullRequest.reactions}
              disabled={reactionPendingKey === `pull:${pullRequest.id}`}
              onToggle={
                canReact
                  ? (content, viewerReacted) => {
                      void togglePullRequestReaction(content, viewerReacted);
                    }
                  : undefined
              }
            />
          </section>

          {comparison ? (
            <section className="space-y-3 rounded-md border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Files changed</h2>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{comparison.filesChanged} files</Badge>
                  <Badge variant="outline">+{comparison.additions}</Badge>
                  <Badge variant="outline">-{comparison.deletions}</Badge>
                </div>
              </div>
              <RepositoryDiffView changes={comparison.changes} />
            </section>
          ) : null}

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-base font-semibold">Reviews</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无 review。</p>
            ) : (
              <ul className="space-y-3">
                {reviews.map((review) => (
                  <li key={review.id} className="rounded-md border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant={
                          review.decision === "approve"
                            ? "default"
                            : review.decision === "request_changes"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {review.decision}
                      </Badge>
                      <span>{review.reviewer_username}</span>
                      <span>reviewed {formatRelativeTime(review.created_at)}</span>
                      <span>{formatDateTime(review.created_at)}</span>
                    </div>
                    <div className="mt-2">
                      <MarkdownBody content={review.body} emptyText="(no comment)" />
                    </div>
                    <div className="mt-3">
                      <ReactionStrip
                        reactions={review.reactions}
                        disabled={reactionPendingKey === `review:${review.id}`}
                        onToggle={
                          canReact
                            ? (content, viewerReacted) => {
                                void toggleReviewReaction(review.id, content, viewerReacted);
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

          {canReview ? (
            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-base font-semibold">Submit review</h2>
              <div className="space-y-2">
                <Label htmlFor="review-decision">Decision</Label>
                <select
                  id="review-decision"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={reviewDecision}
                  onChange={(event) => setReviewDecision(event.target.value as PullRequestReviewDecision)}
                >
                  <option value="comment">Comment</option>
                  <option value="approve">Approve</option>
                  <option value="request_changes">Request changes</option>
                </select>
              </div>
              <MarkdownEditor
                label="Body"
                value={reviewBody}
                onChange={setReviewBody}
                rows={6}
                placeholder="Leave your review comments"
                previewEmptyText="Nothing to preview."
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    void submitReview();
                  }}
                  disabled={reviewSubmitting}
                >
                  {reviewSubmitting ? "Submitting..." : "Submit review"}
                </Button>
              </div>
            </section>
          ) : null}
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
              reviewerIds={selectedReviewerIds}
              onReviewerIdsChange={setSelectedReviewerIds}
              milestones={availableMilestones}
              milestoneId={selectedMilestoneId}
              onMilestoneIdChange={setSelectedMilestoneId}
              draft={draft}
              onDraftChange={setDraft}
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
