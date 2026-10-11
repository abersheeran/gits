import { githubErrorMessage } from "@/lib/github-errors";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Plus, RefreshCw, Settings, Trash2 } from "lucide-react";
import { Panel, PanelTitle } from "./panel";
import { ErrorAlert } from "./error-alert";
import { EmptyState } from "./empty-state";
import { IconButton } from "./icon-button";
import { RelativeTime } from "./relative-time";
import { Pagination } from "./pagination";
import { GithubAvatar } from "./github-avatar";
import { GithubStatusBadge } from "./github-status-badge";
import { GithubTableSkeleton } from "./github-sync-skeleton";
import { GithubSourceSettingsSheet } from "./github-source-settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import {
  defaultGithubSourceSettings,
  getGithubSource,
  listGithubOwners,
  syncGithubSource,
  type GithubConnection,
  type GithubOwner,
  type GithubSourceSettings
} from "@/lib/github-api";

type SettingsTarget = {
  ownerLogin: string;
  sourceId?: string;
  initial: GithubSourceSettings;
};
export function GithubConnectionPanel({
  connection,
  onReplace,
  onRemove,
  onRefresh,
  announce = false
}: {
  connection: GithubConnection;
  announce?: boolean;
  onReplace: () => void;
  onRemove: () => void;
  onRefresh: () => Promise<void>;
}) {
  const organizationInput = useRef<HTMLInputElement>(null);
  const [owners, setOwners] = useState<GithubOwner[] | null>(null);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsTarget | null>(null);
  const [organization, setOrganization] = useState(false);
  const [login, setLogin] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    let canceled = false;
    listGithubOwners(connection.id)
      .then(({ owners }) => {
        if (!canceled) {
          setOwners(owners);
          setOwnersError(null);
        }
      })
      .catch((cause) => {
        if (!canceled) {
          setOwners([]);
          setOwnersError(`无法读取所有者，请更换令牌。${formatApiError(cause)}`);
        }
      });
    return () => {
      canceled = true;
    };
  }, [connection.id, connection.updatedAt]);
  const merged = new Map(
    (ownersError ? [] : (owners ?? [])).map((owner) => [owner.login.toLowerCase(), owner])
  );
  for (const source of connection.sources)
    merged.set(source.ownerLogin.toLowerCase(), {
      login: source.ownerLogin,
      type: source.ownerType,
      avatarUrl: source.avatarUrl,
      githubId: 0,
      sourceId: source.id
    });
  const rows = [...merged.values()];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)));
  async function act(id: string, action: () => Promise<void>) {
    setPending(id);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setPending(null);
    }
  }
  function addOrganization(event: FormEvent) {
    event.preventDefault();
    setOrganization(false);
    setSettings({
      ownerLogin: login.trim(),
      initial: defaultGithubSourceSettings(login.trim(), "organization")
    });
  }
  return (
    <>
      <Panel
        header={
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <GithubAvatar login={connection.githubLogin} url={connection.avatarUrl} />
              <PanelTitle className="min-w-0 truncate">{connection.githubLogin}</PanelTitle>
              <span className="text-body-micro text-text-tertiary">
                {connection.tokenKind === "classic" ? "经典令牌" : "细粒度令牌"}
              </span>
              {connection.status === "invalid" && <Badge variant="destructive">令牌失效</Badge>}
            </div>
            <div className="flex shrink-0">
              <IconButton label="更换令牌" onClick={onReplace}>
                <KeyRound className="size-4" />
              </IconButton>
              <IconButton label="移除账号" onClick={onRemove}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          </>
        }
      >
        <ErrorAlert inset error={ownersError ?? githubErrorMessage(connection.lastError)} />
        <ErrorAlert inset error={error} />
        {owners === null ? (
          <GithubTableSkeleton owners announce={announce} />
        ) : rows.length === 0 ? (
          <EmptyState title="暂无所有者" description="添加组织以启用同步。" />
        ) : (
          <>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>所有者</TableHead>
                  <TableHead className="hidden w-28 md:table-cell">仓库</TableHead>
                  <TableHead className="hidden w-40 md:table-cell">状态</TableHead>
                  <TableHead className="hidden w-28 lg:table-cell">上次同步</TableHead>
                  <TableHead className="w-28 text-right md:w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice((currentPage - 1) * 20, currentPage * 20).map((owner) => {
                  const source = connection.sources.find(
                    (item) => item.ownerLogin.toLowerCase() === owner.login.toLowerCase()
                  );
                  const status = source ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <GithubStatusBadge status={source.status} error={source.lastError} />
                      {source.attentionCount > 0 && (
                        <span className="text-body-micro text-text-tertiary">
                          {source.attentionCount} 个需处理
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-body-micro text-text-tertiary">未启用</span>
                  );
                  return (
                    <TableRow key={owner.login}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <GithubAvatar login={owner.login} url={owner.avatarUrl} />
                          <div className="min-w-0">
                            {source ? (
                              <Link
                                className="gh-link -my-2 block truncate py-2"
                                to={`/sync/sources/${source.id}`}
                              >
                                {owner.login}
                              </Link>
                            ) : (
                              <span className="block truncate">{owner.login}</span>
                            )}
                            {owner.type === "organization" && (
                              <span className="text-body-micro text-text-tertiary">组织</span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 space-y-1 md:hidden">
                          {status}
                          <div className="text-body-micro text-text-tertiary">
                            仓库{" "}
                            {source ? `${source.syncedCount} / ${source.repositoryCount}` : "—"} ·{" "}
                            <RelativeTime timestamp={source?.lastDiscoveredAt ?? null} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {source ? `${source.syncedCount} / ${source.repositoryCount}` : "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{status}</TableCell>
                      <TableCell className="hidden text-body-micro text-text-tertiary lg:table-cell">
                        <RelativeTime timestamp={source?.lastDiscoveredAt ?? null} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {source ? (
                            <>
                              <IconButton
                                label={`立即同步 ${owner.login}`}
                                disabled={pending !== null}
                                onClick={() =>
                                  void act(source.id, async () => {
                                    await syncGithubSource(source.id);
                                    await onRefresh();
                                  })
                                }
                              >
                                <RefreshCw
                                  className={`size-4 ${pending === source.id ? "motion-safe:animate-spin" : ""}`}
                                />
                              </IconButton>
                              <IconButton
                                label={`设置 ${owner.login}`}
                                disabled={pending !== null}
                                onClick={() =>
                                  void act(source.id, async () => {
                                    const { source: full } = await getGithubSource(source.id);
                                    setSettings({
                                      ownerLogin: owner.login,
                                      sourceId: source.id,
                                      initial: full
                                    });
                                  })
                                }
                              >
                                <Settings className="size-4" />
                              </IconButton>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() =>
                                setSettings({
                                  ownerLogin: owner.login,
                                  initial: defaultGithubSourceSettings(owner.login, owner.type)
                                })
                              }
                            >
                              同步
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              page={currentPage}
              hasNext={currentPage * 20 < rows.length}
              onChange={setPage}
            />
          </>
        )}
        <div className="border-t border-border-subtle px-4 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLogin("");
              setOrganization(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            添加组织
          </Button>
        </div>
      </Panel>
      {settings && (
        <GithubSourceSettingsSheet
          {...settings}
          connectionId={connection.id}
          onClose={() => setSettings(null)}
          onSaved={onRefresh}
        />
      )}
      <Dialog open={organization} onOpenChange={setOrganization}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            organizationInput.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>添加组织</DialogTitle>
            <DialogDescription className="text-body-xs">
              输入需要同步的 GitHub 组织登录名。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={addOrganization}>
            <div className="space-y-2">
              <Label htmlFor="github-organization">组织登录名</Label>
              <Input
                ref={organizationInput}
                id="github-organization"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                pattern="[A-Za-z0-9-]+"
                maxLength={39}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOrganization(false)}>
                取消
              </Button>
              <Button type="submit">继续</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
