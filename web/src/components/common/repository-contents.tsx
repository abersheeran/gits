import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { FileCode2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { InlineLoadingState } from "@/components/ui/loading-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { RepositoryContentsResponse } from "@/lib/api";
import { commitTitle, type CodeViewKind } from "@/lib/repository-navigation";
import { Panel } from "./panel";
import { EmptyState } from "./empty-state";
import { Pagination } from "./pagination";
import { RelativeTime } from "./relative-time";
const ReadmeMarkdown = lazy(async () => ({
  default: (await import("@/components/readme-markdown")).ReadmeMarkdown
}));
type LocationLink = (kind: CodeViewKind, path: string) => string;
function Breadcrumbs({
  path,
  kind,
  link
}: {
  path: string;
  kind: CodeViewKind;
  link: LocationLink;
}) {
  const parts = path.split("/").filter(Boolean);
  return (
    <nav
      aria-label="文件路径"
      className="flex min-w-0 flex-1 flex-wrap items-center gap-1 break-all font-mono text-[13px] font-normal"
    >
      <Link className="gh-link inline-flex min-h-10 items-center" to={link("tree", "")}>
        /
      </Link>
      {parts.map((part, index) => (
        <span key={index} className="inline-flex min-w-0 items-center gap-1">
          {index > 0 && <span className="text-text-tertiary">/</span>}
          <Link
            className="gh-link inline-flex min-h-10 items-center"
            to={link(
              index === parts.length - 1 ? kind : "tree",
              parts.slice(0, index + 1).join("/")
            )}
          >
            {part}
          </Link>
        </span>
      ))}
    </nav>
  );
}
function formatBytes(value: number) {
  return value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(1)} MB`;
}
export function RepositoryContents({
  contents,
  link,
  onHistory,
  onCommit
}: {
  contents: RepositoryContentsResponse;
  link: LocationLink;
  onHistory: () => void;
  onCommit: (oid: string) => void;
}) {
  const [page, setPage] = useState(1);
  const file = contents.file;
  return (
    <>
      <Panel
        header={
          <>
            <Breadcrumbs path={contents.path} kind={contents.kind} link={link} />
            {file && (
              <span className="text-body-micro font-normal text-text-tertiary">
                {formatBytes(file.size)}
                {file.content !== null &&
                  ` · ${file.content ? file.content.split("\n").length : 0} 行`}
              </span>
            )}
            <Button variant="ghost" onClick={onHistory}>
              历史
            </Button>
          </>
        }
      >
        {contents.kind === "blob" && file ? (
          <>
            {file.truncated && (
              <p className="px-4 py-2 text-body-micro text-text-tertiary">
                文件过大，仅显示部分内容。
              </p>
            )}
            {file.isBinary ? (
              <EmptyState title="二进制文件无法在线预览" />
            ) : (
              <MonacoTextViewer
                value={file.content ?? ""}
                path={file.path}
                scope="repository-blob"
                minHeight={64}
                maxHeight={860}
              />
            )}
          </>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead className="hidden md:table-cell">最近提交</TableHead>
                  <TableHead className="hidden w-32 md:table-cell">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contents.path && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Link
                        to={link("tree", contents.path.split("/").slice(0, -1).join("/"))}
                        className="gh-link flex min-h-10 items-center gap-2"
                      >
                        <FolderOpen className="h-4 w-4" />
                        ..
                      </Link>
                    </TableCell>
                  </TableRow>
                )}
                {contents.entries.slice((page - 1) * 50, page * 50).map((entry) => (
                  <TableRow key={entry.path}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        {entry.type === "tree" ? (
                          <FolderOpen className="h-4 w-4 shrink-0 text-text-secondary" />
                        ) : (
                          <FileCode2 className="h-4 w-4 shrink-0 text-text-tertiary" />
                        )}
                        {entry.type === "commit" ? (
                          <span className="truncate font-mono text-[13px]">
                            {entry.name}（子模块）
                          </span>
                        ) : (
                          <Link
                            className="gh-link flex min-h-10 min-w-0 items-center font-mono md:min-h-0 text-[13px]"
                            to={link(entry.type, entry.path)}
                          >
                            <span className="block truncate">{entry.name}</span>
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {entry.latestCommit && (
                        <button
                          className="gh-link block max-w-full truncate text-left"
                          onClick={() => onCommit(entry.latestCommit!.oid)}
                        >
                          {commitTitle(entry.latestCommit.message)}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-body-micro text-text-tertiary md:table-cell">
                      {entry.latestCommit && (
                        <RelativeTime timestamp={entry.latestCommit.author.timestamp * 1000} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {contents.entries.length === 0 && (
              <EmptyState title="暂无文件" description="推送代码后即可浏览文件。" />
            )}
            {contents.entries.length > 50 && (
              <Pagination
                page={page}
                hasNext={page * 50 < contents.entries.length}
                onChange={setPage}
              />
            )}
          </>
        )}
      </Panel>
      {contents.kind === "tree" && contents.readme && (
        <Panel header={<span className="font-mono text-[13px]">{contents.readme.path}</span>}>
          <div className="min-w-0 overflow-hidden p-4">
            <Suspense fallback={<InlineLoadingState />}>
              <ReadmeMarkdown content={contents.readme.content} />
            </Suspense>
          </div>
        </Panel>
      )}
    </>
  );
}
