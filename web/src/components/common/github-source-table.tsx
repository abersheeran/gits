import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink, RefreshCw, Settings, Unplug } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { GithubAvatar } from "./github-avatar";
import { GithubStatusBadge } from "./github-status-badge";
import { IconButton } from "./icon-button";
import { RelativeTime } from "./relative-time";
import { Pagination } from "./pagination";
import type { GithubSourceSummary } from "@/lib/github-api";

export function GithubSourceTable({
  sources,
  pendingId,
  onSync,
  onSettings,
  onUnlink
}: {
  sources: GithubSourceSummary[];
  pendingId: string | null;
  onSync: (source: GithubSourceSummary) => void;
  onSettings: (source: GithubSourceSummary) => void;
  onUnlink: (source: GithubSourceSummary) => void;
}) {
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(sources.length / 50)));
  function status(source: GithubSourceSummary) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {(source.status !== "ok" || source.attentionCount === 0) && (
          <GithubStatusBadge status={source.status} error={source.lastError} />
        )}
        {source.attentionCount > 0 && (
          <Link
            to={`/sync/sources/${encodeURIComponent(source.id)}?status=attention&page=1`}
            aria-label={`查看 ${source.accountLogin} 的 ${source.attentionCount} 个需处理仓库`}
            className="inline-flex min-h-10 items-center gap-1 text-body-micro text-danger-text underline underline-offset-4 hover:no-underline md:min-h-0"
          >
            {source.attentionCount} 个仓库需处理
            <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
          </Link>
        )}
      </div>
    );
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>账号</TableHead>
            <TableHead className="hidden w-24 md:table-cell">仓库</TableHead>
            <TableHead className="hidden w-40 md:table-cell">状态</TableHead>
            <TableHead className="hidden w-28 lg:table-cell">上次同步</TableHead>
            <TableHead className="w-28 text-right md:w-40">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.slice((currentPage - 1) * 50, currentPage * 50).map((source) => (
            <TableRow key={source.id}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <GithubAvatar login={source.accountLogin} url={source.avatarUrl} />
                  <div className="min-w-0">
                    <Link
                      className="gh-link -my-2 block truncate py-2"
                      to={`/sync/sources/${encodeURIComponent(source.id)}`}
                    >
                      {source.accountLogin}
                    </Link>
                    <span className="block text-body-micro text-text-tertiary">
                      {source.accountType === "user" ? "个人" : "组织"} ·{" "}
                      {source.repositorySelection === "all" ? "全部仓库" : "指定仓库"}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 md:hidden">
                  {status(source)}
                  <span className="text-body-micro text-text-tertiary">
                    仓库 {source.syncedCount} / {source.repositoryCount} ·{" "}
                    <RelativeTime timestamp={source.lastDiscoveredAt} />
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {source.syncedCount} / {source.repositoryCount}
              </TableCell>
              <TableCell className="hidden md:table-cell">{status(source)}</TableCell>
              <TableCell className="hidden text-body-micro text-text-tertiary lg:table-cell">
                <RelativeTime timestamp={source.lastDiscoveredAt} />
              </TableCell>
              <TableCell>
                <div className="grid grid-cols-2 justify-items-end md:flex md:justify-end">
                  <IconButton
                    label={`立即同步 ${source.accountLogin}`}
                    disabled={pendingId !== null}
                    onClick={() => onSync(source)}
                  >
                    <RefreshCw
                      className={`size-4 ${pendingId === source.id ? "motion-safe:animate-spin" : ""}`}
                    />
                  </IconButton>
                  <IconButton
                    label={`设置 ${source.accountLogin}`}
                    disabled={pendingId !== null}
                    onClick={() => onSettings(source)}
                  >
                    <Settings className="size-4" />
                  </IconButton>
                  <IconButton asChild label={`在 GitHub 上管理 ${source.accountLogin}`}>
                    <a href={source.manageUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  </IconButton>
                  <IconButton
                    label={`解除绑定 ${source.accountLogin}`}
                    disabled={pendingId !== null}
                    onClick={() => onUnlink(source)}
                  >
                    <Unplug className="size-4" />
                  </IconButton>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        page={currentPage}
        hasNext={currentPage * 50 < sources.length}
        onChange={setPage}
        disabled={pendingId !== null}
      />
    </>
  );
}
