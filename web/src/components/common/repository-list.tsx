import { FolderGit2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { RepositoryRecord } from "@/lib/api";
import { EmptyState } from "./empty-state";
import { Pagination } from "./pagination";
import { RelativeTime } from "./relative-time";
export function RepositoryList({
  repositories,
  publicOnly = false
}: {
  repositories: RepositoryRecord[];
  publicOnly?: boolean;
}) {
  const [page, setPage] = useState(1);
  if (!repositories.length)
    return (
      <EmptyState
        icon={FolderGit2}
        title={publicOnly ? "暂无公开仓库" : "还没有仓库"}
        description={publicOnly ? undefined : "新建一个仓库开始使用。"}
      />
    );
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>仓库</TableHead>
            <TableHead className="hidden w-32 text-right md:table-cell">创建于</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {repositories.slice((page - 1) * 20, page * 20).map((repo) => (
            <TableRow key={repo.id}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    className="gh-link -my-2 block min-w-0 truncate py-2"
                    to={`/repo/${repo.owner_username}/${repo.name}`}
                  >
                    <span className="text-text-secondary">{repo.owner_username} / </span>
                    <span className="font-medium">{repo.name}</span>
                  </Link>
                  {repo.is_mirror === 1 && <Badge variant="outline">镜像</Badge>}
                  {!publicOnly && (
                    <Badge variant="outline">{repo.is_private ? "私有" : "公开"}</Badge>
                  )}
                </div>
                {repo.description && (
                  <p className="mt-1 truncate text-body-xs text-text-secondary">
                    {repo.description}
                  </p>
                )}
                <div className="mt-1 text-body-micro text-text-tertiary md:hidden">
                  <RelativeTime timestamp={repo.created_at} />
                </div>
              </TableCell>
              <TableCell className="hidden text-right text-body-micro text-text-tertiary md:table-cell">
                <RelativeTime timestamp={repo.created_at} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {repositories.length > 20 && (
        <Pagination page={page} hasNext={page * 20 < repositories.length} onChange={setPage} />
      )}
    </>
  );
}
