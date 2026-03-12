import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MessageSquareText } from "lucide-react";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import { IssueTaskStatusBadge } from "@/components/repository/issue-task-status-badge";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { RepositoryStateBadge } from "@/components/repository/repository-state-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import {
  listLatestActionRunsBySource,
  formatApiError,
  getRepositoryDetail,
  listIssues,
  type ActionRunRecord,
  type AuthUser,
  type IssueListState,
  type IssueRecord,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type RepositoryIssuesPageProps = {
  user: AuthUser | null;
};

export function RepositoryIssuesPage({ user }: RepositoryIssuesPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [totalIssues, setTotalIssues] = useState(0);
  const [latestRunByIssueNumber, setLatestRunByIssueNumber] = useState<Record<number, ActionRunRecord>>(
    {}
  );
  const [state, setState] = useState<IssueListState>("open");
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
        const [nextDetail, nextIssues] = await Promise.all([
          getRepositoryDetail(owner, repo),
          listIssues(owner, repo, { state, limit: 100 })
        ]);
        const issueNumbers = nextIssues.issues.map((issue) => issue.number);
        const latestRunItems =
          issueNumbers.length > 0
            ? await listLatestActionRunsBySource(owner, repo, {
                sourceType: "issue",
                numbers: issueNumbers
              })
            : [];
        const nextRunByIssueNumber: Record<number, ActionRunRecord> = {};
        for (const item of latestRunItems) {
          if (item.run) {
            nextRunByIssueNumber[item.sourceNumber] = item.run;
          }
        }
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setIssues(nextIssues.issues);
        setTotalIssues(nextIssues.pagination.total);
        setLatestRunByIssueNumber(nextRunByIssueNumber);
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

  const hasPendingRun = issues.some((issue) => {
    const run = latestRunByIssueNumber[issue.number];
    return run ? run.status === "queued" || run.status === "running" : false;
  });

  useEffect(() => {
    if (!hasPendingRun || !owner || !repo || issues.length === 0) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const nextIssues = await listIssues(owner, repo, { state, limit: 100 });
        const issueNumbers = nextIssues.issues.map((issue) => issue.number);
        const latestRunItems =
          issueNumbers.length > 0
            ? await listLatestActionRunsBySource(owner, repo, {
                sourceType: "issue",
                numbers: issueNumbers
              })
            : [];
        const nextRunByIssueNumber: Record<number, ActionRunRecord> = {};
        for (const item of latestRunItems) {
          if (item.run) {
            nextRunByIssueNumber[item.sourceNumber] = item.run;
          }
        }
        setIssues(nextIssues.issues);
        setTotalIssues(nextIssues.pagination.total);
        setLatestRunByIssueNumber(nextRunByIssueNumber);
      } catch {
        // Ignore transient polling errors.
      }
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingRun, issues, owner, repo, state]);

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

  if (!detail) {
    return (
      <PageLoadingState
        title="Loading issues"
        description={`Fetching issue activity for ${owner}/${repo}.`}
      />
    );
  }

  const canCreate = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);

  return (
    <div className="space-y-4">
      <RepositoryHeader owner={owner} repo={repo} detail={detail} user={user} active="issues" />

      {loading ? (
        <InlineLoadingState
          title="Refreshing issues"
          description={`Applying the ${state} filter and updating checks.`}
        />
      ) : null}

      <section className="page-panel overflow-hidden">
        <div className="panel-toolbar">
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
              variant={state === "all" ? "secondary" : "ghost"}
              onClick={() => setState("all")}
            >
              All
            </Button>
          </div>
          <div className="text-body-xs text-text-secondary">
            {totalIssues} issues · filter: {state}
          </div>
          {canCreate ? (
            <Button size="sm" asChild>
              <Link to={`/repo/${owner}/${repo}/issues/new`}>New issue</Link>
            </Button>
          ) : null}
        </div>

        {issues.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">当前筛选下没有 issue。</div>
        ) : (
          <ul className="divide-y">
            {issues.map((issue) => {
              const actionRun = latestRunByIssueNumber[issue.number];
              return (
                <li key={issue.id} className="space-y-2 p-4 transition-colors hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <AuthorAvatar name={issue.author_username} className="h-9 w-9 text-sm" />
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className="inline-flex items-center gap-2 text-sm font-medium gh-link"
                            to={`/repo/${owner}/${repo}/issues/${issue.number}`}
                          >
                            <MessageSquareText className="h-4 w-4" />
                            #{issue.number} {issue.title}
                          </Link>
                          {issue.comment_count > 0 ? (
                            <Badge variant="outline" className="text-[11px]">
                              {issue.comment_count} comments
                            </Badge>
                          ) : null}
                          {actionRun ? (
                            <Link
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                              to={`/repo/${owner}/${repo}/actions?sessionId=${actionRun.id}`}
                            >
                              <ActionStatusBadge
                                status={actionRun.status}
                                withDot
                                className="border-0 bg-transparent p-0 text-[11px] font-normal text-inherit shadow-none"
                              />
                            </Link>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {issue.author_username} opened {formatRelativeTime(issue.created_at)}
                        </p>
                        {issue.assignees.length > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Assignees: {issue.assignees.map((assignee) => assignee.username).join(", ")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <IssueTaskStatusBadge status={issue.task_status} />
                      <RepositoryStateBadge state={issue.state} kind="issue" />
                    </div>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {issue.body.trim() ? issue.body : "(no description)"}
                  </p>
                  <p className="text-xs text-muted-foreground">updated at {formatDateTime(issue.updated_at)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
