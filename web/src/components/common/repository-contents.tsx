import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, FileCode2, FileX2, FolderOpen, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import { InlineLoadingState } from "@/components/ui/loading-state";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { CommitSummary, RepositoryContentsResponse } from "@/lib/api";
import { commitTitle } from "@/lib/repository-navigation";
import { Panel, PanelTitle } from "./panel";
import { CommitRow } from "./commit-row";
import { EmptyState } from "./empty-state";
import { Pagination } from "./pagination";
import { RelativeTime } from "./relative-time";
import type { LocationLink } from "./path-breadcrumbs";
const ReadmeMarkdown = lazy(async () => ({
  default: (await import("@/components/readme-markdown")).ReadmeMarkdown
}));
function formatBytes(value: number) {
  return value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(1)} MB`;
}
export function RepositoryContents({
  contents,
  latest,
  link,
  onHistory,
  onCommit
}: {
  contents: RepositoryContentsResponse;
  latest: CommitSummary | null;
  link: LocationLink;
  onHistory: () => void;
  onCommit: (oid: string) => void;
}) {
  const [page, setPage] = useState(1);
  const file = contents.file;
  const history = (
    <Button variant="ghost" size="sm" aria-label="历史" onClick={onHistory}>
      <History className="h-4 w-4" />
      <span className="hidden sm:inline">历史</span>
    </Button>
  );
  return (
    <>
      <Panel
        header={
          latest ? (
            <CommitRow compact commit={latest} onOpen={onCommit} actions={history} />
          ) : (
            <div className="ml-auto">{history}</div>
          )
        }
      >
        {contents.kind === "blob" && file ? (
          <>
            <div className="flex h-10 items-center gap-3 border-b border-border-subtle bg-surface-canvas px-4 text-body-micro text-text-tertiary">
              <span>
                {formatBytes(file.size)}
                {file.content !== null &&
                  ` · ${file.content ? file.content.split("\n").length : 0} 行`}
              </span>
              {file.truncated && <span>仅显示部分内容</span>}
            </div>
            {file.isBinary ? (
              <EmptyState icon={FileX2} title="二进制文件无法在线预览" />
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
            <Table aria-label="仓库文件">
              <colgroup className="hidden md:table-column-group">
                <col />
                <col />
                <col className="w-28" />
              </colgroup>
              <TableBody>
                {contents.path && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Link
                        to={link("tree", contents.path.split("/").slice(0, -1).join("/"))}
                        className="gh-link -my-2 flex items-center gap-2 py-2"
                      >
                        <FolderOpen className="h-4 w-4 text-text-secondary" />
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
                            className="gh-link -my-2 block min-w-0 flex-1 truncate py-2 font-mono text-[13px]"
                            to={link(entry.type, entry.path)}
                            title={entry.name}
                          >
                            {entry.name}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {entry.latestCommit && (
                        <button
                          className="gh-link -my-2 block max-w-full truncate py-2 text-left"
                          onClick={() => onCommit(entry.latestCommit!.oid)}
                        >
                          {commitTitle(entry.latestCommit.message)}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="hidden w-28 text-right text-body-micro text-text-tertiary md:table-cell">
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
            <Pagination
              page={page}
              hasNext={page * 50 < contents.entries.length}
              onChange={setPage}
            />
          </>
        )}
      </Panel>
      {contents.kind === "tree" && contents.readme && (
        <Panel
          header={
            <PanelTitle className="flex min-w-0 items-center gap-2">
              <BookOpen className="h-4 w-4 shrink-0" />
              <span className="truncate font-mono text-[13px] font-normal">
                {contents.readme.path}
              </span>
            </PanelTitle>
          }
        >
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
