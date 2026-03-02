import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatApiError,
  getIssue,
  getRepositoryDetail,
  updateIssue,
  type AuthUser,
  type IssueRecord,
  type RepositoryDetailResponse
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [nextDetail, nextIssue] = await Promise.all([
          getRepositoryDetail(owner, repo),
          getIssue(owner, repo, number)
        ]);
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setIssue(nextIssue);
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
        <AlertDescription>Issue 编号无效。</AlertDescription>
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

  if (loading || !detail || !issue) {
    return <p className="text-sm text-muted-foreground">正在加载 issue...</p>;
  }

  const canUpdate = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);

  async function changeState(nextState: "open" | "closed") {
    if (updating) {
      return;
    }
    setUpdating(true);
    setError(null);
    try {
      const updated = await updateIssue(owner, repo, number, {
        state: nextState
      });
      setIssue(updated);
    } catch (updateError) {
      setError(formatApiError(updateError));
    } finally {
      setUpdating(false);
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
          {issue.title} <span className="text-muted-foreground">#{issue.number}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={issue.state === "open" ? "default" : "secondary"}>{issue.state}</Badge>
          <span>{issue.author_username}</span>
          <span>opened {formatRelativeTime(issue.created_at)}</span>
          <span>updated {formatDateTime(issue.updated_at)}</span>
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

      <section className="rounded-md border p-4">
        <pre className="whitespace-pre-wrap break-words text-sm leading-6">
          {issue.body.trim() ? issue.body : "(no description)"}
        </pre>
      </section>
    </div>
  );
}
