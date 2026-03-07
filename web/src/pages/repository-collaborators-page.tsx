import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
    <div className="space-y-6">
      {loading ? (
        <InlineLoadingState
          title="Refreshing collaborators"
          description="Updating repository access and collaborator roles."
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            协作者: {owner}/{repo}
          </CardTitle>
          <CardDescription>权限分为 read / write / admin，owner 始终拥有全部权限。</CardDescription>
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
              <Button variant="ghost" asChild>
                <Link to={`/repo/${owner}/${repo}/settings`}>返回设置</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>协作者列表</CardTitle>
          <CardDescription>你可以按用户名移除协作者。</CardDescription>
        </CardHeader>
        <CardContent>
          {collaborators.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无协作者。</p>
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
