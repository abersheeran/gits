import { Link } from "react-router-dom";
import { Ban, Pencil, Plus, RefreshCw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { GithubStatusBadge } from "./github-status-badge";
import { RelativeTime } from "./relative-time";
import { IconButton } from "./icon-button";
import type { GithubRemoteRepository } from "@/lib/github-api";
export function GithubRepositoryTable({
  items,
  pendingId,
  onSync,
  onInclude,
  onExclude,
  onRename
}: {
  items: GithubRemoteRepository[];
  pendingId: number | null;
  onSync: (item: GithubRemoteRepository) => void;
  onInclude: (item: GithubRemoteRepository) => void;
  onExclude: (item: GithubRemoteRepository) => void;
  onRename: (item: GithubRemoteRepository) => void;
}) {
  function local(item: GithubRemoteRepository) {
    return item.repository ? (
      <Link
        className="gh-link block truncate"
        to={`/repo/${encodeURIComponent(item.repository.owner)}/${encodeURIComponent(item.repository.name)}`}
      >
        {item.repository.owner}/{item.repository.name}
      </Link>
    ) : (
      "—"
    );
  }
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead>GitHub 仓库</TableHead>
          <TableHead className="hidden md:table-cell">本地仓库</TableHead>
          <TableHead className="hidden w-44 md:table-cell">状态</TableHead>
          <TableHead className="hidden w-28 lg:table-cell">上次同步</TableHead>
          <TableHead className="w-28 text-right md:w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.githubRepoId}>
            <TableCell>
              <a
                className="gh-link -my-2 block truncate py-2"
                href={item.htmlUrl}
                target="_blank"
                rel="noreferrer"
              >
                {item.fullName}
              </a>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.isPrivate && <Badge variant="outline">私有</Badge>}
                {item.isFork && <Badge variant="outline">Fork</Badge>}
                {item.isArchived && <Badge variant="outline">归档</Badge>}
              </div>
              <div className="mt-2 space-y-1 md:hidden">
                <div className="text-body-micro text-text-tertiary">本地：{local(item)}</div>
                <GithubStatusBadge status={item.state} error={item.lastError} />
                <div className="text-body-micro text-text-tertiary">
                  <RelativeTime timestamp={item.lastSyncedAt} />
                </div>
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">{local(item)}</TableCell>
            <TableCell className="hidden md:table-cell">
              <GithubStatusBadge status={item.state} error={item.lastError} />
            </TableCell>
            <TableCell className="hidden text-body-micro text-text-tertiary lg:table-cell">
              <RelativeTime timestamp={item.lastSyncedAt} />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap justify-end">
                {item.repository ? (
                  <>
                    <IconButton
                      label={`立即同步 ${item.fullName}`}
                      disabled={pendingId !== null}
                      onClick={() => onSync(item)}
                    >
                      <RefreshCw
                        className={`size-4 ${pendingId === item.githubRepoId ? "motion-safe:animate-spin" : ""}`}
                      />
                    </IconButton>
                    <IconButton
                      label={`停止同步 ${item.fullName}`}
                      disabled={pendingId !== null}
                      onClick={() => onExclude(item)}
                    >
                      <Ban className="size-4" />
                    </IconButton>
                  </>
                ) : (
                  <>
                    {item.state === "excluded" ? (
                      <IconButton
                        label={`纳入同步 ${item.fullName}`}
                        disabled={pendingId !== null}
                        onClick={() => onInclude(item)}
                      >
                        <Plus className="size-4" />
                      </IconButton>
                    ) : (
                      <IconButton
                        label={`排除 ${item.fullName}`}
                        disabled={pendingId !== null}
                        onClick={() => onExclude(item)}
                      >
                        <Ban className="size-4" />
                      </IconButton>
                    )}
                    {item.state === "name_conflict" && (
                      <IconButton
                        label={`指定本地名称 ${item.fullName}`}
                        disabled={pendingId !== null}
                        onClick={() => onRename(item)}
                      >
                        <Pencil className="size-4" />
                      </IconButton>
                    )}
                  </>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
