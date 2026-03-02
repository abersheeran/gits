import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createPullRequestReview,
  formatApiError,
  getPullRequest,
  getRepositoryDetail,
  listPullRequestReviews,
  updatePullRequest,
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

export function PullRequestDetailPage({ user }: PullRequestDetailPageProps) {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const number = Number.parseInt(params.number ?? "", 10);

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestRecord | null>(null);
  const [reviews, setReviews] = useState<PullRequestReviewRecord[]>([]);
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
        const [nextDetail, nextPullRequest, nextReviews] = await Promise.all([
          getRepositoryDetail(owner, repo),
          getPullRequest(owner, repo, number),
          listPullRequestReviews(owner, repo, number)
        ]);
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setPullRequest(nextPullRequest);
        setReviews(nextReviews.reviews);
        setReviewSummary(nextReviews.reviewSummary);
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

  async function changeState(nextState: "open" | "closed") {
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
        </div>
        <p className="text-sm text-muted-foreground">
          {stripHeadsRef(pullRequest.head_ref)} → {stripHeadsRef(pullRequest.base_ref)}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Approvals: {reviewSummary.approvals}</Badge>
          <Badge variant="outline">Changes requested: {reviewSummary.changeRequests}</Badge>
          <Badge variant="outline">Comments: {reviewSummary.comments}</Badge>
        </div>
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
