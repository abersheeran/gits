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
            {!publicOnly && <TableHead className="w-20">可见性</TableHead>}
            <TableHead className="hidden w-36 md:table-cell">创建时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {repositories.slice((page - 1) * 20, page * 20).map((repo) => (
            <TableRow key={repo.id}>
              <TableCell>
                <Link
                  className="gh-link block truncate font-medium"
                  to={`/repo/${repo.owner_username}/${repo.name}`}
                >
                  {repo.owner_username}/{repo.name}
                </Link>
                {repo.description && (
                  <p className="mt-1 truncate text-body-xs text-text-secondary">
                    {repo.description}
                  </p>
                )}
                <div className="mt-1 text-body-micro text-text-tertiary md:hidden">
                  <RelativeTime timestamp={repo.created_at} />
                </div>
              </TableCell>
              {!publicOnly && (
                <TableCell>
                  <Badge variant="outline">{repo.is_private ? "私有" : "公开"}</Badge>
                </TableCell>
              )}
              <TableCell className="hidden text-body-micro text-text-tertiary md:table-cell">
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
