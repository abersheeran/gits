import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorAlert } from "@/components/common/error-alert";
import { RelativeTime } from "@/components/common/relative-time";
import { Pagination } from "@/components/common/pagination";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineLoadingState } from "@/components/ui/loading-state";
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
  createAccessToken,
  formatApiError,
  listAccessTokens,
  revokeAccessToken,
  type AccessTokenMetadata,
  type AuthUser
} from "@/lib/api";

function tokenStatus(token: AccessTokenMetadata) {
  if (token.revoked_at !== null) return "已撤销";
  if (token.expires_at !== null && token.expires_at <= Date.now()) return "已过期";
  return "有效";
}
export function TokensPage({ user }: { user: AuthUser | null }) {
  const [tokens, setTokens] = useState<AccessTokenMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("0");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [target, setTarget] = useState<AccessTokenMetadata | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let canceled = false;
    listAccessTokens()
      .then((data) => {
        if (!canceled) setTokens(data);
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
  }, []);
  async function refresh() {
    try {
      setTokens(await listAccessTokens());
      setError(null);
    } catch (cause) {
      setError(formatApiError(cause));
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setFormError(null);
    try {
      const days = Number(expiry);
      const result = await createAccessToken({
        name: name.trim(),
        ...(days ? { expiresAt: Date.now() + days * 86400000 } : {})
      });
      setOpen(false);
      setCreatedToken(result.token);
      setName("");
      setExpiry("0");
      await refresh();
    } catch (cause) {
      setFormError(formatApiError(cause));
    } finally {
      setCreating(false);
    }
  }
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      <PageHeader
        title="访问令牌"
        action={
          <Button
            onClick={() => {
              setFormError(null);
              setOpen(true);
            }}
          >
            创建令牌
          </Button>
        }
      />
      <Panel>
        <ErrorAlert error={error} />
        {loading ? (
          <InlineLoadingState />
        ) : tokens.length === 0 ? (
          <EmptyState title="还没有访问令牌" description="创建令牌以通过 Git 客户端访问仓库。" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead className="hidden md:table-cell">前缀</TableHead>
                  <TableHead className="hidden lg:table-cell">创建时间</TableHead>
                  <TableHead className="hidden md:table-cell">过期时间</TableHead>
                  <TableHead className="hidden lg:table-cell">最近使用</TableHead>
                  <TableHead className="w-20">状态</TableHead>
                  <TableHead className="w-20">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.slice((page - 1) * 20, page * 20).map((token) => (
                  <TableRow key={token.id}>
                    <TableCell>
                      <span className="block truncate">{token.name}</span>
                      <span className="mt-1 block text-body-micro text-text-tertiary md:hidden">
                        {token.expires_at === null ? (
                          "不过期"
                        ) : (
                          <>
                            过期：
                            <RelativeTime timestamp={token.expires_at} />
                          </>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden truncate font-mono text-[13px] md:table-cell">
                      {token.token_prefix}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RelativeTime timestamp={token.created_at} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <RelativeTime timestamp={token.expires_at} fallback="不过期" />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RelativeTime timestamp={token.last_used_at} fallback="尚未使用" />
                    </TableCell>
                    <TableCell>
                      <Badge variant={tokenStatus(token) === "有效" ? "success" : "secondary"}>
                        {tokenStatus(token)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {token.revoked_at === null && (
                        <Button variant="ghost" onClick={() => setTarget(token)}>
                          撤销
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} hasNext={page * 20 < tokens.length} onChange={setPage} />
          </>
        )}
      </Panel>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!creating) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建令牌</DialogTitle>
            <DialogDescription>用于 Git 客户端和 API 身份验证。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={create}>
            <ErrorAlert error={formError} />
            <div className="space-y-2">
              <Label htmlFor="token-name">名称</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="token-expiry">有效期</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="token-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ["0", "不过期"],
                    ["7", "7 天"],
                    ["30", "30 天"],
                    ["90", "90 天"],
                    ["365", "1 年"]
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <PendingButton type="submit" pending={creating} pendingText="创建中…">
                创建令牌
              </PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={createdToken !== null}
        onOpenChange={(value) => {
          if (!value) setCreatedToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>令牌已创建</DialogTitle>
            <DialogDescription>请复制并妥善保存，关闭后无法再次查看。</DialogDescription>
          </DialogHeader>
          <code className="block break-all font-mono text-[13px]">{createdToken}</code>
          <DialogFooter>
            <CopyButton value={createdToken ?? ""} />
            <Button onClick={() => setCreatedToken(null)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(value) => {
          if (!value) setTarget(null);
        }}
        title="撤销令牌"
        description={`撤销后，使用「${target?.name ?? ""}」的客户端将无法继续访问。`}
        onConfirm={async () => {
          if (target) {
            await revokeAccessToken(target.id);
            await refresh();
          }
        }}
      />
    </>
  );
}
