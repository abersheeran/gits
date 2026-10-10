import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { useRepository } from "@/hooks/use-repository";
import { RepositoryLayout } from "@/components/common/repository-layout";
import { Panel } from "@/components/common/panel";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorAlert } from "@/components/common/error-alert";
import { IconButton } from "@/components/common/icon-button";
import { Pagination } from "@/components/common/pagination";
import { ShaCopyButton } from "@/components/common/sha-copy-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  createRepositoryBranch,
  deleteRepositoryBranch,
  formatApiError,
  updateRepositoryDefaultBranch,
  type AuthUser
} from "@/lib/api";
import { buildCodePath } from "@/lib/repository-navigation";
export function RepositoryBranchesPage({ user }: { user: AuthUser | null }) {
  const { owner, repo, detail, setDetail, error, setError } = useRepository();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [sha, setSha] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const isOwner = detail?.repository.owner_username === user?.username;
  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending || !detail) return;
    const sourceOid =
      source === "__sha__"
        ? sha.trim()
        : detail.branches.find((branch) => branch.name === source)?.oid;
    if (!sourceOid || !/^[a-f0-9]{40}$/i.test(sourceOid)) {
      setFormError("请选择来源分支或输入完整的 40 位提交 SHA。");
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const result = await createRepositoryBranch(owner, repo, {
        branchName: name.trim(),
        sourceOid
      });
      setDetail({ ...detail, ...result });
      setOpen(false);
      setName("");
      setSha("");
    } catch (cause) {
      setFormError(formatApiError(cause));
    } finally {
      setPending(false);
    }
  }
  if (!detail) return error ? <ErrorAlert error={error} /> : <PageLoadingState />;
  const branches = detail.branches.map((branch) => ({
    ...branch,
    shortName: branch.name.replace(/^refs\/heads\//, "")
  }));
  return (
    <RepositoryLayout detail={detail} user={user}>
      <Panel
        header={
          <>
            <span>分支</span>
            {isOwner && (
              <Button
                onClick={() => {
                  setSource(
                    branches.find((branch) => branch.shortName === detail.defaultBranch)?.name ??
                      branches[0]?.name ??
                      "__sha__"
                  );
                  setFormError(null);
                  setOpen(true);
                }}
              >
                新建分支
              </Button>
            )}
          </>
        }
      >
        <ErrorAlert error={error} />
        {branches.length === 0 ? (
          <EmptyState title="暂无分支" description="推送首次提交后即可浏览和管理分支。" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>分支名</TableHead>
                  <TableHead className="hidden md:table-cell">提交</TableHead>
                  {isOwner && <TableHead className="w-40 text-right">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.slice((page - 1) * 20, page * 20).map((branch) => (
                  <TableRow key={branch.name}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          className="gh-link break-all font-mono text-[13px]"
                          to={buildCodePath({ owner, repo, kind: "tree", ref: branch.shortName })}
                        >
                          {branch.shortName}
                        </Link>
                        {branch.shortName === detail.defaultBranch && (
                          <Badge variant="secondary">默认</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <ShaCopyButton oid={branch.oid} />
                    </TableCell>
                    {isOwner && (
                      <TableCell className="text-right">
                        {branch.shortName !== detail.defaultBranch && (
                          <div className="flex items-center justify-end">
                            <Button
                              variant="ghost"
                              disabled={pending}
                              onClick={async () => {
                                setPending(true);
                                setError(null);
                                try {
                                  setDetail({
                                    ...detail,
                                    ...(await updateRepositoryDefaultBranch(owner, repo, {
                                      branchName: branch.shortName
                                    }))
                                  });
                                } catch (cause) {
                                  setError(formatApiError(cause));
                                } finally {
                                  setPending(false);
                                }
                              }}
                            >
                              设为默认
                            </Button>
                            <IconButton
                              label={`删除分支 ${branch.shortName}`}
                              disabled={pending}
                              onClick={() => setTarget(branch.shortName)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {branches.length > 20 && (
              <Pagination page={page} hasNext={page * 20 < branches.length} onChange={setPage} />
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
            <DialogTitle>新建分支</DialogTitle>
            <DialogDescription>从已有分支或提交创建分支。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={create}>
            <ErrorAlert error={formError} />
            <div className="space-y-2">
              <Label htmlFor="branch-name">分支名</Label>
              <Input
                id="branch-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-source">来源</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger id="branch-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.name} value={branch.name}>
                      {branch.shortName}
                    </SelectItem>
                  ))}
                  <SelectItem value="__sha__">输入提交 SHA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {source === "__sha__" && (
              <div className="space-y-2">
                <Label htmlFor="branch-sha">提交 SHA</Label>
                <Input
                  id="branch-sha"
                  className="font-mono"
                  value={sha}
                  onChange={(event) => setSha(event.target.value)}
                  pattern="[a-fA-F0-9]{40}"
                  minLength={40}
                  maxLength={40}
                  required
                />
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <PendingButton type="submit" pending={pending} pendingText="创建中…">
                新建分支
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
        title="删除分支"
        description={`删除分支「${target ?? ""}」？此操作无法撤销。`}
        onConfirm={async () => {
          if (target) {
            setDetail({ ...detail, ...(await deleteRepositoryBranch(owner, repo, target)) });
            setPage(1);
          }
        }}
      />
    </RepositoryLayout>
  );
}
