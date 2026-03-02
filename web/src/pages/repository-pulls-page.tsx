import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Code2, GitPullRequest, MessageSquareText } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatApiError,
  getRepositoryDetail,
  listPullRequests,
  type AuthUser,
  type PullRequestListState,
  type PullRequestRecord,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type RepositoryPullsPageProps = {
  user: AuthUser | null;
};

function stripHeadsRef(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

export function RepositoryPullsPage({ user }: RepositoryPullsPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);
  const [state, setState] = useState<PullRequestListState>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function load() {
      if (!owner || !repo) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [nextDetail, nextPullRequests] = await Promise.all([
          getRepositoryDetail(owner, repo),
          listPullRequests(owner, repo, { state, limit: 100 })
        ]);
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setPullRequests(nextPullRequests);
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
  }, [owner, repo, state]);

  if (!owner || !repo) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>仓库路径不完整。</AlertDescription>
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

  if (loading || !detail) {
    return <p className="text-sm text-muted-foreground">正在加载 Pull requests...</p>;
  }

  const canCreate = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);

  return (
    <div className="space-y-4">
      <header className="space-y-3 rounded-md border bg-card p-4 shadow-sm">
        <h1 className="text-xl font-semibold">
          <Link className="gh-link" to={`/repo/${owner}/${repo}`}>
            {owner}/{repo}
          </Link>{" "}
          <span className="text-muted-foreground">/ Pull requests</span>
        </h1>
        <nav className="flex flex-wrap items-end gap-1 border-b border-border px-1" aria-label="Repository sections">
          <Link
            to={`/repo/${owner}/${repo}`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          >
            <Code2 className="h-4 w-4" />
            Code
          </Link>
          <Link
            to={`/repo/${owner}/${repo}/issues`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          >
            <MessageSquareText className="h-4 w-4" />
            Issues
            <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">
              {detail.openIssueCount}
            </span>
          </Link>
          <Link
            to={`/repo/${owner}/${repo}/pulls`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-[#fd8c73] px-3 py-2 text-sm font-medium text-foreground"
          >
            <GitPullRequest className="h-4 w-4" />
            Pull requests
            <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">
              {detail.openPullRequestCount}
            </span>
          </Link>
        </nav>
      </header>

      <section className="overflow-hidden rounded-md border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/60 px-3 py-2">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={state === "open" ? "secondary" : "ghost"}
              onClick={() => setState("open")}
            >
              Open
            </Button>
            <Button
              size="sm"
              variant={state === "closed" ? "secondary" : "ghost"}
              onClick={() => setState("closed")}
            >
              Closed
            </Button>
            <Button
              size="sm"
              variant={state === "merged" ? "secondary" : "ghost"}
              onClick={() => setState("merged")}
            >
              Merged
            </Button>
            <Button
              size="sm"
              variant={state === "all" ? "secondary" : "ghost"}
              onClick={() => setState("all")}
            >
              All
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">Filter: {state}</div>
          {canCreate ? (
            <Button size="sm" asChild>
              <Link to={`/repo/${owner}/${repo}/pulls/new`}>New pull request</Link>
            </Button>
          ) : null}
        </div>

        {pullRequests.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">当前筛选下没有 pull request。</div>
        ) : (
          <ul className="divide-y">
            {pullRequests.map((pullRequest) => (
              <li key={pullRequest.id} className="space-y-2 p-4 transition-colors hover:bg-muted/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <Link
                      className="inline-flex items-center gap-2 text-sm font-medium gh-link"
                      to={`/repo/${owner}/${repo}/pulls/${pullRequest.number}`}
                    >
                      <GitPullRequest className="h-4 w-4" />
                      #{pullRequest.number} {pullRequest.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {pullRequest.author_username} opened {formatRelativeTime(pullRequest.created_at)}
                    </p>
                  </div>
                  <Badge
                    variant={pullRequest.state === "open" ? "default" : "secondary"}
                    className="uppercase"
                  >
                    {pullRequest.state}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {stripHeadsRef(pullRequest.head_ref)} → {stripHeadsRef(pullRequest.base_ref)}
                </p>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {pullRequest.body.trim() ? pullRequest.body : "(no description)"}
                </p>
                <p className="text-xs text-muted-foreground">
                  updated at {formatDateTime(pullRequest.updated_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
