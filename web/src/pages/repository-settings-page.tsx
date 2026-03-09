import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  deleteRepository,
  formatApiError,
  getRepositoryDetail,
  updateRepositoryDefaultBranch,
  updateRepository,
  type AuthUser,
  type RepositoryDetailResponse
} from "@/lib/api";

type RepositorySettingsPageProps = {
  user: AuthUser | null;
};

function normalizeBranchName(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

export function RepositorySettingsPage({ user }: RepositorySettingsPageProps) {
  const navigate = useNavigate();
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [savePending, setSavePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [confirmRepoName, setConfirmRepoName] = useState("");
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
        setName(data.repository.name);
        setDescription(data.repository.description ?? "");
        setIsPrivate(data.repository.is_private === 1);
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

  const cloneUrl = useMemo(() => `${window.location.origin}/${owner}/${repo}.git`, [owner, repo]);
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
        title="Loading repository settings"
        description={`Fetching repository settings and branch controls for ${owner}/${repo}.`}
      />
    );
  }

  if (detail.repository.owner_username !== user.username) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无权限</AlertTitle>
        <AlertDescription>只有仓库 owner 可修改设置。</AlertDescription>
      </Alert>
    );
  }

  async function refreshRepositoryDetail(nextOwner = owner, nextRepo = repo) {
    const reloaded = await getRepositoryDetail(nextOwner, nextRepo);
    setDetail(reloaded);
    setDefaultBranchDraft(reloaded.defaultBranch ?? "");
    setBranchSourceOidDraft(reloaded.headOid ?? "");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending) {
      return;
    }

    setSavePending(true);
    setFormError(null);
    setNotice(null);
    try {
      await updateRepository(owner, repo, {
        name,
        description: description.trim() ? description : null,
        isPrivate
      });
      setNotice("仓库设置已更新");
      if (name !== repo) {
        navigate(`/repo/${owner}/${name}/settings`, { replace: true });
      } else {
        await refreshRepositoryDetail();
      }
    } catch (submitError) {
      setFormError(formatApiError(submitError));
    } finally {
      setSavePending(false);
    }
  }

  async function handleCreateBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (branchSubmitting) {
      return;
    }

    setBranchSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      const createdBranchName = branchNameDraft.trim();
      await createRepositoryBranch(owner, repo, {
        branchName: createdBranchName,
        sourceOid: branchSourceOidDraft.trim()
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
    if (defaultBranchPending || !defaultBranchDraft) {
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

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deletePending) {
      return;
    }
    if (confirmRepoName !== repo) {
      setFormError("确认名不匹配，未删除。");
      return;
    }

    setDeletePending(true);
    setFormError(null);
    try {
      await deleteRepository(owner, repo);
      navigate("/dashboard", { replace: true });
    } catch (deleteError) {
      setFormError(formatApiError(deleteError));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to={`/repo/${owner}/${repo}`}>{owner}</Link>
          <span>/</span>
          <span>{repo}</span>
          <Badge variant="secondary">Settings</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">仓库设置</h1>
        <p className="text-sm text-muted-foreground">管理仓库基本信息、分支与删除操作。</p>
      </div>

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
          <CardTitle>General</CardTitle>
          <CardDescription>修改仓库名称、描述和可见性。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Clone URL</Label>
            <div className="flex items-center gap-2">
              <Input value={cloneUrl} readOnly />
              <CopyButton value={cloneUrl} idleLabel="复制地址" copiedLabel="已复制" />
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSave}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="repo-name">仓库名</Label>
                <Input id="repo-name" value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="repo-description">描述</Label>
                <Input
                  id="repo-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="repo-private"
                checked={isPrivate}
                onCheckedChange={(checked) => setIsPrivate(checked === true)}
              />
              <Label htmlFor="repo-private">私有仓库</Label>
            </div>
            <PendingButton type="submit" pending={savePending} pendingText="保存中...">
              保存设置
            </PendingButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <CardDescription>创建分支、删除分支，并修改仓库默认分支。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
              <div className="flex h-9 items-center rounded-md border px-3 text-sm">{detail.defaultBranch ?? "none"}</div>
            </div>
            <PendingButton type="submit" pending={defaultBranchPending} pendingText="切换中...">
              切换默认分支
            </PendingButton>
          </form>

          <form className="space-y-4 rounded-md border border-dashed p-4" onSubmit={handleCreateBranch}>
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
            <p className="text-xs text-muted-foreground">默认会预填当前页面选中的 HEAD commit，可按需替换成任意已存在的 commit SHA。</p>
            <PendingButton type="submit" pending={branchSubmitting} pendingText="创建中...">
              创建分支
            </PendingButton>
          </form>

          <div className="space-y-3">
            {branchItems.map((branch) => {
              const isDefault = branch.shortName === detail.defaultBranch;
              return (
                <div
                  key={branch.name}
                  className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{branch.shortName}</span>
                      {isDefault ? <Badge>default</Badge> : null}
                    </div>
                    <div className="break-all text-xs text-muted-foreground">{branch.oid}</div>
                  </div>
                  <PendingButton
                    type="button"
                    variant="outline"
                    pending={branchDeletingName === branch.shortName}
                    pendingText="删除中..."
                    disabled={isDefault}
                    onClick={() => {
                      void handleDeleteBranch(branch.shortName);
                    }}
                  >
                    删除分支
                  </PendingButton>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>删除后不可恢复，仓库对象也会从存储中移除。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleDelete}>
            <div className="space-y-2">
              <Label htmlFor="confirmRepoName">输入仓库名确认删除</Label>
              <Input
                id="confirmRepoName"
                value={confirmRepoName}
                onChange={(event) => setConfirmRepoName(event.target.value)}
                placeholder={repo}
                required
              />
            </div>
            <PendingButton
              type="submit"
              variant="destructive"
              pending={deletePending}
              pendingText="删除中..."
            >
              删除仓库
            </PendingButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
