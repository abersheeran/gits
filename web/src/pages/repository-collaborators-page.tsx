import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import { UserMinus } from "lucide-react";
import { useRepository } from "@/hooks/use-repository";
import { RepositoryLayout } from "@/components/common/repository-layout";
import { Panel, PanelTitle } from "@/components/common/panel";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorAlert } from "@/components/common/error-alert";
import { IconButton } from "@/components/common/icon-button";
import { RelativeTime } from "@/components/common/relative-time";
import { Pagination } from "@/components/common/pagination";
import { PermissionSelect } from "@/components/common/permission-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoadingState, InlineLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  formatApiError,
  listCollaborators,
  removeCollaborator,
  upsertCollaborator,
  type AuthUser,
  type CollaboratorPermission,
  type CollaboratorRecord
} from "@/lib/api";
export function RepositoryCollaboratorsPage({ user }: { user: AuthUser | null }) {
  const { owner, repo, detail, error: pageError } = useRepository();
  const [items, setItems] = useState<CollaboratorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [permission, setPermission] = useState<CollaboratorPermission>("read");
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<CollaboratorRecord | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let canceled = false;
    listCollaborators(owner, repo)
      .then((data) => {
        if (!canceled) setItems(data);
      })
      .catch((cause) => {
        if (!canceled) setError(formatApiError(cause));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [owner, repo]);
  async function save(targetUsername: string, next: CollaboratorPermission) {
    await upsertCollaborator(owner, repo, { username: targetUsername, permission: next });
    setItems(await listCollaborators(owner, repo));
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFormError(null);
    try {
      await save(username, permission);
      setOpen(false);
      setUsername("");
      setPermission("read");
    } catch (cause) {
      setFormError(formatApiError(cause));
    } finally {
      setPending(false);
    }
  }
  if (!user) return <Navigate to="/login" replace />;
  if (pageError) return <ErrorAlert error={pageError} />;
  if (!detail) return <PageLoadingState />;
  return (
    <RepositoryLayout detail={detail}>
      <Panel
        header={
          <>
            <PanelTitle>协作者</PanelTitle>
            <Button
              size="sm"
              onClick={() => {
                setFormError(null);
                setOpen(true);
              }}
            >
              添加协作者
            </Button>
          </>
        }
      >
        <ErrorAlert inset error={error} />
        {loading ? (
          <InlineLoadingState />
        ) : !error && items.length === 0 ? (
          <EmptyState title="暂无协作者" description="添加已有用户一起管理仓库。" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户名</TableHead>
                  <TableHead className="w-32">权限</TableHead>
                  <TableHead className="hidden md:table-cell">添加时间</TableHead>
                  <TableHead className="w-16">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice((page - 1) * 20, page * 20).map((item) => (
                  <TableRow key={item.user_id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <AuthorAvatar name={item.username} className="h-6 w-6 shrink-0" />
                        <span className="truncate">{item.username}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <PermissionSelect
                        className="h-8 w-24 md:h-8"
                        value={item.permission}
                        disabled={pending}
                        label={`${item.username} 的权限`}
                        onChange={async (next) => {
                          setPending(true);
                          setError(null);
                          try {
                            await save(item.username, next);
                          } catch (cause) {
                            setError(formatApiError(cause));
                          } finally {
                            setPending(false);
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell className="hidden text-text-tertiary md:table-cell">
                      <RelativeTime timestamp={item.created_at} />
                    </TableCell>
                    <TableCell>
                      <IconButton
                        label={`移除 ${item.username}`}
                        disabled={pending}
                        onClick={() => setTarget(item)}
                      >
                        <UserMinus className="h-4 w-4" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {items.length > 20 && (
              <Pagination page={page} hasNext={page * 20 < items.length} onChange={setPage} />
            )}
          </>
        )}
      </Panel>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加协作者</DialogTitle>
            <DialogDescription>选择已有用户及其仓库权限。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={add}>
            <ErrorAlert error={formError} />
            <div className="space-y-2">
              <Label htmlFor="collaborator-name">用户名</Label>
              <Input
                id="collaborator-name"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="collaborator-permission">权限</Label>
              <PermissionSelect
                id="collaborator-permission"
                value={permission}
                onChange={setPermission}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <PendingButton type="submit" pending={pending} pendingText="添加中…">
                添加协作者
              </PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(value) => {
          if (!value) setTarget(null);
        }}
        title="移除协作者"
        description={`移除「${target?.username ?? ""}」的仓库权限？`}
        onConfirm={async () => {
          if (target) {
            await removeCollaborator(owner, repo, target.username);
            setItems(items.filter((item) => item.user_id !== target.user_id));
            setPage(1);
          }
        }}
      />
    </RepositoryLayout>
  );
}
