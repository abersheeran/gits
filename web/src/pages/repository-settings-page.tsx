import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
    return <p className="text-sm text-muted-foreground">正在加载设置...</p>;
  }

  if (detail.repository.owner_username !== user.username) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无权限</AlertTitle>
        <AlertDescription>只有仓库 owner 可修改设置。</AlertDescription>
      </Alert>
    );
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
        const reloaded = await getRepositoryDetail(owner, repo);
        setDetail(reloaded);
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
    <div className="space-y-6">
      {notice ? (
        <Alert>
          <AlertTitle>保存成功</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            仓库设置: {owner}/{repo}
          </CardTitle>
          <CardDescription>更新仓库名、描述和可见性。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>当前 clone URL</Label>
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
              <code className="text-xs sm:text-sm">{cloneUrl}</code>
              <CopyButton value={cloneUrl} />
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSave}>
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

            <div className="flex items-center gap-2">
              <Checkbox
                id="repo-private"
                checked={isPrivate}
                onCheckedChange={(checked) => setIsPrivate(checked === true)}
              />
              <Label htmlFor="repo-private">私有仓库</Label>
            </div>

            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={savePending}>
                {savePending ? "保存中..." : "保存设置"}
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/repo/${owner}/${repo}/collaborators`}>管理协作者</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to={`/repo/${owner}/${repo}`}>查看仓库</Link>
              </Button>
            </div>
          </form>
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
            <Button type="submit" variant="destructive" disabled={deletePending}>
              {deletePending ? "删除中..." : "删除仓库"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
