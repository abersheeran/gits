import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { HelpTip } from "@/components/common/help-tip";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import {
  createIssue,
  formatApiError,
  getRepositoryDetail,
  type AuthUser,
  type RepositoryDetailResponse
} from "@/lib/api";

type NewIssuePageProps = {
  user: AuthUser | null;
};

export function NewIssuePage({ user }: NewIssuePageProps) {
  const navigate = useNavigate();
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let canceled = false;

    async function load() {
      if (!owner || !repo) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const nextDetail = await getRepositoryDetail(owner, repo);
        if (!canceled) {
          setDetail(nextDetail);
        }
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
  }, [owner, repo]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

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
    return (
      <PageLoadingState
        title="Loading repository"
        description={`Preparing issue form for ${owner}/${repo}.`}
      />
    );
  }

  if (!detail.permissions.canCreateIssueOrPullRequest) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无权限</AlertTitle>
        <AlertDescription>只有仓库 owner 或 collaborator 可创建 issue。</AlertDescription>
      </Alert>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const issue = await createIssue(owner, repo, {
        title,
        body,
        acceptanceCriteria
      });
      navigate(`/repo/${owner}/${repo}/issues/${issue.number}`, { replace: true });
    } catch (submitError) {
      setError(formatApiError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle>New issue · {owner}/{repo}</CardTitle>
              <HelpTip content="新 issue 会直接进入仓库问题列表，适合记录需求、缺陷和待办。" />
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>提交失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="issue-title">标题</Label>
              <Input
                id="issue-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>
            <MarkdownEditor
              label="描述"
              value={body}
              onChange={setBody}
              rows={10}
              previewEmptyText="Nothing to preview."
            />
            <MarkdownEditor
              label="验收标准"
              value={acceptanceCriteria}
              onChange={setAcceptanceCriteria}
              rows={6}
              previewEmptyText="暂无验收标准。"
            />
            <div className="flex flex-wrap gap-2">
              <PendingButton type="submit" pending={submitting} pendingText="Creating issue...">
                Create issue
              </PendingButton>
              <Button variant="outline" asChild>
                <Link to={`/repo/${owner}/${repo}/issues`}>返回列表</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
