import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { HelpTip } from "@/components/common/help-tip";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { RepositoryMetadataFields } from "@/components/repository/repository-metadata-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  createPullRequest,
  formatApiError,
  getRepositoryDetail,
  listRepositoryParticipants,
  type AuthUser,
  type RepositoryDetailResponse,
  type RepositoryUserSummary
} from "@/lib/api";

type NewPullRequestPageProps = {
  user: AuthUser | null;
};

export function NewPullRequestPage({ user }: NewPullRequestPageProps) {
  const navigate = useNavigate();
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [headRef, setHeadRef] = useState("");
  const [closeIssuesInput, setCloseIssuesInput] = useState("");
  const [participants, setParticipants] = useState<RepositoryUserSummary[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([]);
  const [draft, setDraft] = useState(false);
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
        const [nextDetail, nextParticipants] = await Promise.all([
          getRepositoryDetail(owner, repo),
          listRepositoryParticipants(owner, repo)
        ]);
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setParticipants(nextParticipants);
        const defaultBase =
          nextDetail.defaultBranch && nextDetail.branches.some((item) => item.name === nextDetail.defaultBranch)
            ? nextDetail.defaultBranch
            : nextDetail.branches[0]?.name ?? "";
        const defaultHead =
          nextDetail.branches.find((item) => item.name !== defaultBase)?.name ??
          nextDetail.branches[0]?.name ??
          "";
        setBaseRef(defaultBase);
        setHeadRef(defaultHead);
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

  const branchNames = useMemo(() => detail?.branches.map((item) => item.name) ?? [], [detail]);

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
        description={`Preparing pull request form for ${owner}/${repo}.`}
      />
    );
  }

  if (!detail.permissions.canCreateIssueOrPullRequest) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无权限</AlertTitle>
        <AlertDescription>只有仓库 owner 或 collaborator 可创建 pull request。</AlertDescription>
      </Alert>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    if (!baseRef || !headRef) {
      setError("请选择 base 与 head 分支。");
      return;
    }
    if (baseRef === headRef) {
      setError("base 与 head 必须不同。");
      return;
    }

    const closeIssueNumbers = closeIssuesInput
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => item.replace(/^#/, ""))
      .map((item) => Number.parseInt(item, 10))
      .filter((item) => Number.isInteger(item) && item > 0);
    if (closeIssueNumbers.length === 0 && closeIssuesInput.trim().length > 0) {
      setError("自动关闭 issue 格式无效，请使用 #1,#2 或 1,2");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const pullRequest = await createPullRequest(owner, repo, {
        title,
        body,
        baseRef,
        headRef,
        ...(closeIssueNumbers.length > 0 ? { closeIssueNumbers } : {}),
        draft,
        assigneeUserIds: selectedAssigneeIds,
        requestedReviewerIds: selectedReviewerIds
      });
      navigate(`/repo/${owner}/${repo}/pulls/${pullRequest.number}`, { replace: true });
    } catch (submitError) {
      setError(formatApiError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>New pull request · {owner}/{repo}</CardTitle>
            <HelpTip content="在这里选择 base 和 head 分支，提交后会创建新的 Pull Request。" />
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
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pr-base-ref">Base branch</Label>
                <Select value={baseRef} onValueChange={setBaseRef}>
                  <SelectTrigger id="pr-base-ref">
                    <SelectValue placeholder="选择 base 分支" />
                  </SelectTrigger>
                  <SelectContent>
                    {branchNames.map((branchName) => (
                      <SelectItem key={`base-${branchName}`} value={branchName}>
                        {branchName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pr-head-ref">Head branch</Label>
                <Select value={headRef} onValueChange={setHeadRef}>
                  <SelectTrigger id="pr-head-ref">
                    <SelectValue placeholder="选择 head 分支" />
                  </SelectTrigger>
                  <SelectContent>
                    {branchNames.map((branchName) => (
                      <SelectItem key={`head-${branchName}`} value={branchName}>
                        {branchName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-title">标题</Label>
              <Input id="pr-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
            </div>
            <MarkdownEditor
              label="描述"
              value={body}
              onChange={setBody}
              rows={10}
              previewEmptyText="Nothing to preview."
            />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="pr-close-issues">合并后自动关闭的 issues</Label>
                <HelpTip content="支持 #12,#34 或 12,34。PR merged 时会自动关闭这些 issue。" />
              </div>
              <Input
                id="pr-close-issues"
                value={closeIssuesInput}
                onChange={(event) => setCloseIssuesInput(event.target.value)}
                placeholder="#1, #2"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <PendingButton
                type="submit"
                pending={submitting}
                pendingText="Creating pull request..."
              >
                Create pull request
              </PendingButton>
              <Button variant="outline" asChild>
                <Link to={`/repo/${owner}/${repo}/pulls`}>返回列表</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>Metadata</CardTitle>
            <HelpTip content="创建时就可以指定 draft、reviewers 和 assignees，避免开 PR 后再补充。" />
          </div>
        </CardHeader>
        <CardContent>
          <RepositoryMetadataFields
            canEdit
            participants={participants}
            assigneeIds={selectedAssigneeIds}
            onAssigneeIdsChange={setSelectedAssigneeIds}
            reviewerIds={selectedReviewerIds}
            onReviewerIdsChange={setSelectedReviewerIds}
            draft={draft}
            onDraftChange={setDraft}
          />
        </CardContent>
      </Card>
    </div>
  );
}
