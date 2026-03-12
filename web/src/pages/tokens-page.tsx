import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createAccessToken,
  formatApiError,
  listAccessTokens,
  revokeAccessToken,
  type AccessTokenMetadata,
  type AuthUser
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type TokensPageProps = {
  user: AuthUser | null;
};

function tokenStatus(token: AccessTokenMetadata): "active" | "expired" | "revoked" {
  if (token.revoked_at !== null) {
    return "revoked";
  }
  if (token.expires_at !== null && token.expires_at <= Date.now()) {
    return "expired";
  }
  return "active";
}

export function TokensPage({ user }: TokensPageProps) {
  const [tokens, setTokens] = useState<AccessTokenMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  async function loadTokens() {
    setLoading(true);
    setError(null);
    try {
      setTokens(await listAccessTokens());
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTokens();
  }, []);

  async function handleCreateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) {
      return;
    }

    setCreating(true);
    setError(null);
    setCreatedToken(null);

    try {
      const parsedExpires = expiresAt.trim() ? Number.parseInt(expiresAt, 10) : undefined;
      if (parsedExpires !== undefined && !Number.isFinite(parsedExpires)) {
        setError("过期时间必须是毫秒时间戳。");
        return;
      }

      const created = await createAccessToken({
        name,
        ...(parsedExpires !== undefined ? { expiresAt: parsedExpires } : {})
      });
      setCreatedToken(created.token);
      setName("");
      setExpiresAt("");
      await loadTokens();
    } catch (createError) {
      setError(formatApiError(createError));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeToken(tokenId: string) {
    setError(null);
    try {
      await revokeAccessToken(tokenId);
      await loadTokens();
    } catch (revokeError) {
      setError(formatApiError(revokeError));
    }
  }

  const hasActiveToken = useMemo(() => tokens.some((token) => tokenStatus(token) === "active"), [tokens]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-page">
      {createdToken ? (
        <Alert>
          <AlertTitle>新 Token（仅本次可见）</AlertTitle>
          <AlertDescription>
            <div className="panel-inset-compact mt-2 flex flex-wrap items-center gap-2">
              <code className="text-xs sm:text-sm">{createdToken}</code>
              <CopyButton value={createdToken} />
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>创建 Access Token</CardTitle>
            <HelpTip content="Token 只会在创建成功后显示一次。建议立即复制并保存到你的 Git 或本地 agent 配置里。" />
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreateToken}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="token-name">名称</Label>
                <Input
                  id="token-name"
                  placeholder="laptop"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-expires-at">过期时间（可选，毫秒时间戳）</Label>
                <Input
                  id="token-expires-at"
                  type="number"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <PendingButton type="submit" pending={creating} pendingText="Creating token...">
                创建 Token
              </PendingButton>
              <Button variant="ghost" asChild>
                <Link to="/dashboard">返回 Dashboard</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>Token 列表</CardTitle>
            <HelpTip content="active token 可用于 HTTP Git 认证或平台 MCP 接入；已撤销或过期的 token 会继续保留在历史列表中。" />
          </div>
          <p className="text-body-sm text-text-secondary">
            {hasActiveToken ? "当前存在可用 token。" : "当前没有 active token。"}
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <InlineLoadingState
              title="Loading tokens"
              description="Fetching active and historical access tokens."
            />
          ) : tokens.length === 0 ? (
            <p className="text-body-sm text-text-secondary">暂无 token。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => {
                  const status = tokenStatus(token);
                  return (
                    <TableRow key={token.id}>
                      <TableCell>{token.name}</TableCell>
                      <TableCell className="font-mono text-xs">{token.token_prefix}</TableCell>
                      <TableCell>{formatDateTime(token.created_at)}</TableCell>
                      <TableCell>{formatDateTime(token.expires_at)}</TableCell>
                      <TableCell>{formatDateTime(token.last_used_at)}</TableCell>
                      <TableCell>
                        <Badge variant={status === "active" ? "secondary" : "outline"}>{status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {status === "revoked" ? (
                          <span className="text-body-xs text-text-secondary">-</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              void handleRevokeToken(token.id);
                            }}
                          >
                            吊销
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
