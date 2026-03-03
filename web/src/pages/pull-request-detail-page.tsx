import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  listLatestActionRunsBySource,
  createPullRequestReview,
  formatApiError,
  getPullRequest,
  getRepositoryDetail,
  listPullRequestReviews,
  updatePullRequest,
  type ActionRunRecord,
  type AuthUser,
  type PullRequestReviewDecision,
  type PullRequestReviewRecord,
  type PullRequestReviewSummary,
  type PullRequestRecord,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type PullRequestDetailPageProps = {
  user: AuthUser | null;
};

function stripHeadsRef(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

function actionStatusDotClass(status: ActionRunRecord["status"]): string {
  if (status === "success") {
    return "bg-emerald-500";
  }
  if (status === "failed" || status === "cancelled") {
    return "bg-red-500";
  }
  if (status === "running") {
    return "bg-sky-500";
  }
  return "bg-slate-400";
}

export function PullRequestDetailPage({ user }: PullRequestDetailPageProps) {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const number = Number.parseInt(params.number ?? "", 10);

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestRecord | null>(null);
  const [reviews, setReviews] = useState<PullRequestReviewRecord[]>([]);
  const [latestActionRun, setLatestActionRun] = useState<ActionRunRecord | null>(null);
  const [closingIssueNumbers, setClosingIssueNumbers] = useState<number[]>([]);
  const [reviewSummary, setReviewSummary] = useState<PullRequestReviewSummary>({
    approvals: 0,
    changeRequests: 0,
    comments: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
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
        const [nextDetail, nextPullRequestDetail, nextReviews] = await Promise.all([
          getRepositoryDetail(owner, repo),
          getPullRequest(owner, repo, number),
          listPullRequestReviews(owner, repo, number)
        ]);
        const latestRunItems = await listLatestActionRunsBySource(owner, repo, {
          sourceType: "pull_request",
          numbers: [number]
        });
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setPullRequest(nextPullRequestDetail.pullRequest);
        setClosingIssueNumbers(nextPullRequestDetail.closingIssueNumbers);
        setReviews(nextReviews.reviews);
        setReviewSummary(nextReviews.reviewSummary);
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
  }, [owner, repo, number]);

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
      setPullRequest(updated);
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
          <Badge variant={pullRequest.state === "open" ? "default" : "secondary"}>
            {pullRequest.state}
          </Badge>
          <span>{pullRequest.author_username}</span>
          <span>opened {formatRelativeTime(pullRequest.created_at)}</span>
          <span>updated {formatDateTime(pullRequest.updated_at)}</span>
          {latestActionRun ? (
            <Link
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              to={`/repo/${owner}/${repo}/actions?runId=${latestActionRun.id}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${actionStatusDotClass(latestActionRun.status)} ${
                  latestActionRun.status === "running" ? "animate-pulse" : ""
                }`}
              />
              action {latestActionRun.status}
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
              Merge pull request
            </Button>
          ) : null}
        </div>
      </header>

      <section className="rounded-md border p-4">
        <pre className="whitespace-pre-wrap break-words text-sm leading-6">
          {pullRequest.body.trim() ? pullRequest.body : "(no description)"}
        </pre>
      </section>

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
                <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                  {review.body.trim() ? review.body : "(no comment)"}
                </pre>
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
          <div className="space-y-2">
            <Label htmlFor="review-body">Body</Label>
            <Textarea
              id="review-body"
              rows={6}
              value={reviewBody}
              onChange={(event) => setReviewBody(event.target.value)}
              placeholder="Leave your review comments"
            />
          </div>
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
  );
}
