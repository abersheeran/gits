import { useCallback, useEffect, useState } from "react";
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
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatApiError,
  getRepositoryDetail,
  listCollaborators,
  removeCollaborator,
  upsertCollaborator,
  type AuthUser,
  type CollaboratorPermission,
  type CollaboratorRecord,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type RepositoryCollaboratorsPageProps = {
  user: AuthUser | null;
};

export function RepositoryCollaboratorsPage({ user }: RepositoryCollaboratorsPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [permission, setPermission] = useState<CollaboratorPermission>("read");
  const [saving, setSaving] = useState(false);

  const loadPage = useCallback(async () => {
    if (!owner || !repo) {
      return;
    }

    setLoading(true);
    setPageError(null);
    try {
      const [nextDetail, nextCollaborators] = await Promise.all([
        getRepositoryDetail(owner, repo),
        listCollaborators(owner, repo)
      ]);
      setDetail(nextDetail);
      setCollaborators(nextCollaborators);
    } catch (loadError) {
      setPageError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

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

  if (!detail) {
    return (
      <PageLoadingState
        title="Loading collaborators"
        description={`Fetching collaborator access for ${owner}/${repo}.`}
      />
    );
  }

  async function handleUpsertCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      await upsertCollaborator(owner, repo, { username, permission });
      setUsername("");
      setPermission("read");
      await loadPage();
    } catch (submitError) {
      setActionError(formatApiError(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveCollaborator(targetUsername: string) {
    setActionError(null);
    try {
      await removeCollaborator(owner, repo, targetUsername);
      await loadPage();
    } catch (removeError) {
      setActionError(formatApiError(removeError));
    }
  }

  return (
    <div className="app-page">
      {loading ? (
        <InlineLoadingState
          title="Refreshing collaborators"
          description="Updating repository access and collaborator roles."
        />
      ) : null}

      <section className="page-panel-muted p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-body-sm text-text-secondary">
              <Link to={`/repo/${owner}/${repo}`} className="gh-link">
                {owner}
              </Link>
              <span>/</span>
              <span>{repo}</span>
              <Badge variant="secondary">Collaborators</Badge>
            </div>
            <div className="flex items-start gap-2">
              <h1 className="font-display text-card-title text-text-primary">协作者</h1>
              <HelpTip content="权限分为 read、write 和 admin。owner 始终保留完整权限。" />
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link to={`/repo/${owner}/${repo}/settings`}>返回设置</Link>
          </Button>
        </div>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>添加或更新协作者</CardTitle>
            <HelpTip content="按用户名直接新增协作者，重复提交会更新现有协作者的权限级别。" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionError ? (
            <Alert variant="destructive">
              <AlertTitle>操作失败</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          <form className="space-y-4" onSubmit={handleUpsertCollaborator}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="collaborator-username">用户名</Label>
                <Input
                  id="collaborator-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="collaborator-permission">权限</Label>
                <Select value={permission} onValueChange={(value) => setPermission(value as CollaboratorPermission)}>
                  <SelectTrigger id="collaborator-permission">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">read</SelectItem>
                    <SelectItem value="write">write</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <PendingButton type="submit" pending={saving} pendingText="Applying access...">
                添加或更新
              </PendingButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>协作者列表</CardTitle>
            <HelpTip content="列表中可以直接移除指定用户的仓库协作权限。" />
          </div>
        </CardHeader>
        <CardContent>
          {collaborators.length === 0 ? (
            <p className="text-body-sm text-text-secondary">暂无协作者。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Permission</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collaborators.map((item) => (
                  <TableRow key={item.user_id}>
                    <TableCell>{item.username}</TableCell>
                    <TableCell>
                      <Badge>{item.permission}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(item.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void handleRemoveCollaborator(item.username);
                        }}
                      >
                        移除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
