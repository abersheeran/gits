import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { HelpTip } from "@/components/common/help-tip";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import {
  deleteRepository,
  formatApiError,
  getRepositoryDetail,
  updateRepository,
  type AuthUser,
  type RepositoryDetailResponse
} from "@/lib/api";

type RepositorySettingsPageProps = {
  user: AuthUser | null;
};

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
        description={`Fetching repository settings for ${owner}/${repo}.`}
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
    <div className="app-page">
      <section className="page-hero">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-body-sm text-text-secondary">
              <Link to={`/repo/${owner}/${repo}`} className="gh-link">
                {owner}
              </Link>
              <span>/</span>
              <span>{repo}</span>
              <Badge variant="secondary">Settings</Badge>
            </div>
            <div className="flex items-start gap-2">
              <h1 className="font-display text-card-title text-text-primary">仓库设置</h1>
              <HelpTip content="管理仓库信息与删除操作。" />
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link to={`/repo/${owner}/${repo}/branches`}>管理分支</Link>
          </Button>
        </div>
      </section>

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
            <CardTitle>General</CardTitle>
            <HelpTip content="修改仓库名称、描述和可见性。" />
          </div>
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

      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>Danger Zone</CardTitle>
            <HelpTip content="删除仓库后不可恢复，底层对象与元数据都会一起清理。" />
          </div>
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
