import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { HelpTip } from "@/components/common/help-tip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
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
  createRepositoryBranch,
  deleteRepositoryBranch,
  formatApiError,
  getRepositoryDetail,
  updateRepositoryDefaultBranch,
  type AuthUser,
  type RepositoryDetailResponse
} from "@/lib/api";

type RepositoryBranchesPageProps = {
  user: AuthUser | null;
};

function normalizeBranchName(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

export function RepositoryBranchesPage({ user }: RepositoryBranchesPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [defaultBranchDraft, setDefaultBranchDraft] = useState("");
  const [branchNameDraft, setBranchNameDraft] = useState("");
  const [branchSourceOidDraft, setBranchSourceOidDraft] = useState("");
  const [branchSubmitting, setBranchSubmitting] = useState(false);
  const [defaultBranchPending, setDefaultBranchPending] = useState(false);
  const [branchDeletingName, setBranchDeletingName] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function load() {
      if (!owner || !repo) {
        return;
      }

      setLoading(true);
      setPageError(null);
      try {
        const data = await getRepositoryDetail(owner, repo);
        if (canceled) {
          return;
        }
        setDetail(data);
        setDefaultBranchDraft(data.defaultBranch ?? "");
        setBranchSourceOidDraft(data.headOid ?? "");
      } catch (loadError) {
        if (!canceled) {
          setPageError(formatApiError(loadError));
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

  const branchItems = useMemo(
    () => detail?.branches.map((branch) => ({ ...branch, shortName: normalizeBranchName(branch.name) })) ?? [],
    [detail]
  );

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

  if (pageError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{pageError}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !detail) {
    return (
      <PageLoadingState
        title="Loading branches"
        description={`Fetching branch controls for ${owner}/${repo}.`}
      />
    );
  }

  if (detail.repository.owner_username !== user.username) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无权限</AlertTitle>
        <AlertDescription>只有仓库 owner 可管理分支。</AlertDescription>
      </Alert>
    );
  }

  const currentDefaultBranch = detail.defaultBranch;

  async function refreshRepositoryDetail() {
    const reloaded = await getRepositoryDetail(owner, repo);
    setDetail(reloaded);
    setDefaultBranchDraft(reloaded.defaultBranch ?? "");
    setBranchSourceOidDraft(reloaded.headOid ?? "");
  }

  async function handleCreateBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (branchSubmitting) {
      return;
    }

    const createdBranchName = branchNameDraft.trim();
    const sourceOid = branchSourceOidDraft.trim();
    if (!createdBranchName) {
      setFormError("请输入新分支名。");
      return;
    }
    if (!sourceOid) {
      setFormError("请输入起点 commit OID。");
      return;
    }

    setBranchSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      await createRepositoryBranch(owner, repo, {
        branchName: createdBranchName,
        sourceOid
      });
      await refreshRepositoryDetail();
      setBranchNameDraft("");
      setNotice(`分支 ${createdBranchName} 已创建`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setBranchSubmitting(false);
    }
  }

  async function handleUpdateDefaultBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (defaultBranchPending || !defaultBranchDraft || defaultBranchDraft === currentDefaultBranch) {
      return;
    }

    setDefaultBranchPending(true);
    setFormError(null);
    setNotice(null);
    try {
      await updateRepositoryDefaultBranch(owner, repo, {
        branchName: defaultBranchDraft
      });
      await refreshRepositoryDetail();
      setNotice(`默认分支已切换到 ${defaultBranchDraft}`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setDefaultBranchPending(false);
    }
  }

  async function handleDeleteBranch(branchName: string) {
    if (branchDeletingName) {
      return;
    }

    setBranchDeletingName(branchName);
    setFormError(null);
    setNotice(null);
    try {
      await deleteRepositoryBranch(owner, repo, branchName);
      await refreshRepositoryDetail();
      setNotice(`分支 ${branchName} 已删除`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setBranchDeletingName(null);
    }
  }

  return (
    <div className="app-page">
      <section className="page-panel-muted p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-body-sm text-text-secondary">
              <Link to={`/repo/${owner}/${repo}`} className="gh-link">
                {owner}
              </Link>
              <span>/</span>
              <span>{repo}</span>
              <Badge variant="secondary">Branches</Badge>
            </div>
            <div className="flex items-start gap-2">
              <h1 className="font-display text-card-title text-text-primary">分支管理</h1>
              <HelpTip content="这里负责创建分支、切换默认分支，以及删除非默认分支。" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to={`/repo/${owner}/${repo}`}>代码页</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/repo/${owner}/${repo}/settings`}>仓库设置</Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="space-y-6">
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>操作失败</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <AlertTitle>已更新</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle>默认分支</CardTitle>
              <HelpTip content="更新仓库 HEAD 指向后，代码页会自动跟随新的默认分支。" />
            </div>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end" onSubmit={handleUpdateDefaultBranch}>
              <div className="space-y-2">
                <Label htmlFor="default-branch">默认分支</Label>
                <Select value={defaultBranchDraft} onValueChange={setDefaultBranchDraft}>
                  <SelectTrigger id="default-branch">
                    <SelectValue placeholder="选择默认分支" />
                  </SelectTrigger>
                  <SelectContent>
                    {branchItems.map((branch) => (
                      <SelectItem key={branch.name} value={branch.shortName}>
                        {branch.shortName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>当前默认分支</Label>
                <div className="flex h-9 items-center rounded-full border border-border-subtle bg-surface-focus px-3 text-body-sm text-text-primary">
                  {currentDefaultBranch ?? "none"}
                </div>
              </div>
              <PendingButton
                type="submit"
                pending={defaultBranchPending}
                pendingText="切换中..."
                disabled={!defaultBranchDraft || defaultBranchDraft === currentDefaultBranch}
              >
                切换默认分支
              </PendingButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle>创建分支</CardTitle>
              <HelpTip content="默认预填仓库当前 HEAD commit，也可以手动填写任意已存在的 commit SHA 作为起点。" />
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateBranch}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-branch-name">新分支名</Label>
                  <Input
                    id="new-branch-name"
                    value={branchNameDraft}
                    onChange={(event) => setBranchNameDraft(event.target.value)}
                    placeholder="feature/new-ui"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-branch-source-oid">起点 commit OID</Label>
                  <Input
                    id="new-branch-source-oid"
                    value={branchSourceOidDraft}
                    onChange={(event) => setBranchSourceOidDraft(event.target.value)}
                    placeholder="40 位 commit SHA"
                    required
                  />
                </div>
              </div>
              <PendingButton type="submit" pending={branchSubmitting} pendingText="创建中...">
                创建分支
              </PendingButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle>分支列表</CardTitle>
              <HelpTip content="默认分支不可删除，仓库至少会保留一个分支。" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {branchItems.map((branch) => {
              const isDefault = branch.shortName === currentDefaultBranch;
              return (
                <div
                  key={branch.name}
                  className="flex flex-col gap-3 rounded-[20px] border border-border-subtle bg-surface-base p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{branch.shortName}</span>
                      {isDefault ? <Badge>default</Badge> : null}
                    </div>
                    <div className="break-all text-body-xs text-text-secondary">{branch.oid}</div>
                  </div>
                  <PendingButton
                    type="button"
                    variant="outline"
                    pending={branchDeletingName === branch.shortName}
                    pendingText="删除中..."
                    disabled={isDefault || branchDeletingName !== null}
                    onClick={() => {
                      void handleDeleteBranch(branch.shortName);
                    }}
                  >
                    删除分支
                  </PendingButton>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
