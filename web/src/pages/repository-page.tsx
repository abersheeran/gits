import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BookOpenText,
  ChevronRight,
  FileCode2,
  FolderOpen,
  History,
  Link2
} from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import { RepositoryDiffView } from "@/components/repository/repository-diff-view";
import { RepositoryHeader } from "@/components/repository/repository-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineLoadingState, PageLoadingState } from "@/components/ui/loading-state";
import { MonacoTextViewer } from "@/components/ui/monaco-text-viewer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  formatApiError,
  getRepositoryCommitDetail,
  getRepositoryCommits,
  getRepositoryContents,
  getRepositoryDetail,
  getRepositoryPathHistory,
  type AuthUser,
  type CommitHistoryResponse,
  type RepositoryCommitDetailResponse,
  type RepositoryContentsResponse,
  type RepositoryDetailResponse,
  type RepositoryPathHistoryResponse
} from "@/lib/api";
import { formatDateTime, formatRelativeTime, shortOid } from "@/lib/format";

type RepositoryPageProps = {
  user: AuthUser | null;
};

type CodeViewKind = "tree" | "blob";

const LazyReadmeMarkdown = lazy(async () => {
  const module = await import("@/components/readme-markdown");
  return { default: module.ReadmeMarkdown };
});

function selectedBranchName(selectedRef: string | null): string | null {
  if (!selectedRef) {
    return null;
  }
  if (selectedRef.startsWith("refs/heads/")) {
    return selectedRef.slice("refs/heads/".length);
  }
  return selectedRef;
}

function decodeUriSegment(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function parseCodeSplatPath(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const trimmed = input.replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeUriSegment(segment))
    .join("/");
}

function buildCodePath(input: {
  owner: string;
  repo: string;
  kind: CodeViewKind;
  ref?: string;
  path?: string;
  defaultBranch?: string | null;
}): string {
  const base = `/repo/${input.owner}/${input.repo}`;
  const normalizedPath = input.path?.split("/").filter((segment) => segment.length > 0).join("/");
  const useBasePath =
    input.kind === "tree" &&
    !normalizedPath &&
    (!input.ref || (input.defaultBranch ? input.ref === input.defaultBranch : false));
  if (useBasePath) {
    return base;
  }
  if (!input.ref) {
    return base;
  }

  const segments = [base, input.kind, encodeURIComponent(input.ref)];
  if (normalizedPath) {
    segments.push(...normalizedPath.split("/").map((segment) => encodeURIComponent(segment)));
  }
  return segments.join("/");
}

function isCommitOid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value));
}

function commitTitle(message: string): string {
  return (message.split("\n")[0] ?? "").trim() || "(no message)";
}

function parentPath(path: string): string {
  if (!path) {
    return "";
  }
  const index = path.lastIndexOf("/");
  if (index <= 0) {
    return "";
  }
  return path.slice(0, index);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function buildPath(segments: string[], index: number): string {
  return segments.slice(0, index + 1).join("/");
}

function fileLineCount(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split("\n").length;
}

function BreadcrumbPath({
  kind,
  path,
  onNavigate,
  noWrap = false
}: {
  kind: CodeViewKind;
  path: string;
  onNavigate: (next: { kind: CodeViewKind; path: string }) => void;
  noWrap?: boolean;
}) {
  const segments = path ? path.split("/") : [];
  if (segments.length === 0) {
    return null;
  }

  return (
    <div
      className={`${
        noWrap ? "flex items-center gap-1 whitespace-nowrap" : "flex flex-wrap items-center gap-1"
      } text-xs text-muted-foreground`}
    >
      <button
        type="button"
        onClick={() => onNavigate({ kind: "tree", path: "" })}
        className="rounded px-1 py-0.5 text-[#0969da] hover:bg-muted/50 hover:underline"
      >
        /
      </button>
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`} className="inline-flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5" />
          <button
            type="button"
            onClick={() =>
              onNavigate({
                kind: kind === "blob" && index === segments.length - 1 ? "blob" : "tree",
                path: buildPath(segments, index)
              })
            }
            className="rounded px-1 py-0.5 text-[#0969da] hover:bg-muted/50 hover:underline"
          >
            {segment}
          </button>
        </span>
      ))}
    </div>
  );
}

function RepositoryContentsPanel({
  contents,
  onNavigate,
  onOpenHistory
}: {
  contents: RepositoryContentsResponse;
  onNavigate: (next: { kind: CodeViewKind; path: string }) => void;
  onOpenHistory?: () => void;
}) {
  if (contents.kind === "blob" && contents.file) {
    return (
      <section className="min-w-0 border-b xl:border-b-0 xl:border-r">
        <header className="flex items-center gap-3 border-b px-4 py-3 text-sm font-medium">
          <span className="inline-flex shrink-0 items-center gap-2">
            <FileCode2 className="h-4 w-4" />
            File preview
          </span>
          <div className="min-w-0 flex-1 overflow-x-auto pb-0.5">
            <BreadcrumbPath kind="blob" path={contents.path} onNavigate={onNavigate} noWrap />
          </div>
          {onOpenHistory ? (
            <button
              type="button"
              onClick={onOpenHistory}
              className="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              History
            </button>
          ) : null}
        </header>
        <div className="space-y-3 border-b bg-[#f6f8fa] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="rounded-md bg-background font-mono text-[11px]">
              {shortOid(contents.file.oid)}
            </Badge>
            <span>{formatBytes(contents.file.size)}</span>
            {contents.file.content ? <span>{fileLineCount(contents.file.content)} lines</span> : null}
            {contents.file.truncated ? (
              <Badge variant="outline" className="rounded-md bg-amber-100/70 text-amber-700">
                已截断展示
              </Badge>
            ) : null}
            {contents.file.isBinary ? (
              <Badge variant="outline" className="rounded-md bg-muted text-muted-foreground">
                Binary file
              </Badge>
            ) : null}
          </div>
          {contents.file.latestCommit ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <AuthorAvatar
                name={contents.file.latestCommit.author.name}
                className="h-6 w-6 text-[10px]"
              />
              <span className="font-medium text-foreground">
                {commitTitle(contents.file.latestCommit.message)}
              </span>
              <span>{formatRelativeTime(contents.file.latestCommit.author.timestamp * 1000)}</span>
            </div>
          ) : null}
        </div>

        {contents.file.isBinary ? (
          <div className="p-4 text-sm text-muted-foreground">
            当前文件为二进制内容，暂不支持在线文本预览。
          </div>
        ) : (
          <div className="p-4">
            <MonacoTextViewer
              value={contents.file.content ?? ""}
              path={contents.file.path}
              scope="repository-blob"
              minHeight={260}
              maxHeight={860}
            />
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="min-w-0 border-b xl:border-b-0 xl:border-r">
      <header className="flex items-center gap-3 border-b px-4 py-3 text-sm font-medium">
        <span className="inline-flex shrink-0 items-center gap-2">
          <FolderOpen className="h-4 w-4" />
          Files
        </span>
        <div className="min-w-0 flex-1 overflow-x-auto pb-0.5">
          <BreadcrumbPath kind="tree" path={contents.path} onNavigate={onNavigate} noWrap />
        </div>
      </header>

      <ul className="divide-y">
        {contents.path ? (
          <li>
            <button
              type="button"
              onClick={() => onNavigate({ kind: "tree", path: parentPath(contents.path) })}
              className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-muted/40"
            >
              <span className="inline-flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-amber-600" />
                ..
              </span>
              <span className="text-xs text-muted-foreground">up</span>
            </button>
          </li>
        ) : null}

        {contents.entries.map((entry) => {
          const isDir = entry.type === "tree";
          const isBlob = entry.type === "blob";
          const canOpen = isDir || isBlob;
          return (
            <li key={entry.path}>
              {canOpen ? (
                <button
                  type="button"
                  onClick={() => onNavigate({ kind: isDir ? "tree" : "blob", path: entry.path })}
                  className="grid w-full grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_120px] items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/40"
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    {isDir ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-amber-600" />
                    ) : (
                      <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{entry.name}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.latestCommit ? commitTitle(entry.latestCommit.message) : entry.type}
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {entry.latestCommit
                      ? formatRelativeTime(entry.latestCommit.author.timestamp * 1000)
                      : entry.type}
                  </span>
                </button>
              ) : (
                <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <FileCode2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="shrink-0 text-xs">submodule</span>
                </div>
              )}
            </li>
          );
        })}

        {contents.entries.length === 0 && !contents.path ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">仓库为空，当前分支没有可浏览的文件。</li>
        ) : null}
      </ul>

      {contents.readme ? (
        <div className="border-t">
          <header className="inline-flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
            <BookOpenText className="h-4 w-4" />
            README
            <span className="text-xs font-normal text-muted-foreground">{contents.readme.path}</span>
          </header>
          <div className="p-4">
            <Suspense fallback={<div className="text-sm text-muted-foreground">README 渲染中...</div>}>
              <LazyReadmeMarkdown content={contents.readme.content} />
            </Suspense>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function RepositoryPage({ user }: RepositoryPageProps) {
  const params = useParams<{
    owner: string;
    repo: string;
    kind: string;
    ref: string;
    "*": string;
  }>();
  const navigate = useNavigate();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const isCodePath = params.kind === "tree" || params.kind === "blob";
  const viewKind: CodeViewKind = params.kind === "blob" ? "blob" : "tree";
  const ref = isCodePath ? decodeUriSegment(params.ref ?? "") : undefined;
  const path = isCodePath ? parseCodeSplatPath(params["*"]) : undefined;

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [history, setHistory] = useState<CommitHistoryResponse | null>(null);
  const [contents, setContents] = useState<RepositoryContentsResponse | null>(null);
  const [pathHistory, setPathHistory] = useState<RepositoryPathHistoryResponse | null>(null);
  const [selectedCommitDetail, setSelectedCommitDetail] = useState<RepositoryCommitDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.kind && !isCodePath && owner && repo) {
      navigate(`/repo/${owner}/${repo}`, { replace: true });
    }
  }, [isCodePath, navigate, owner, params.kind, repo]);

  useEffect(() => {
    let canceled = false;

    async function load() {
      if (!owner || !repo) {
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [nextDetail, nextHistory, nextContents, nextPathHistory] = await Promise.all([
          getRepositoryDetail(owner, repo, ref),
          getRepositoryCommits(owner, repo, { ref, limit: 20 }),
          getRepositoryContents(owner, repo, { ref, path }),
          path ? getRepositoryPathHistory(owner, repo, { ref, path, limit: 12 }) : Promise.resolve(null)
        ]);

        if (canceled) {
          return;
        }

        setDetail(nextDetail);
        setHistory(nextHistory);
        setContents(nextContents);
        setPathHistory(nextPathHistory);
        setSelectedCommitDetail(null);
      } catch (loadError) {
        if (!canceled) {
          setError(formatApiError(loadError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [owner, path, ref, repo]);

  const selectedBranch = useMemo(() => selectedBranchName(detail?.selectedRef ?? null), [detail]);
  const selectedBranchInOptions =
    selectedBranch?.length && detail?.branches.some((branch) => branch.name === selectedBranch)
      ? selectedBranch
      : undefined;
  const commitShortOid =
    selectedBranch && isCommitOid(selectedBranch) ? shortOid(selectedBranch) : null;
  const commitSelectValue =
    selectedBranch && isCommitOid(selectedBranch) ? `__commit__:${selectedBranch}` : undefined;
  const selectedRefInSelect = commitSelectValue ?? selectedBranchInOptions;
  const cloneUrl = `${window.location.origin}/${owner}/${repo}.git`;

  function openCodeLocation(input: { kind: CodeViewKind; nextPath?: string; nextRef?: string }) {
    const nextRef = input.nextRef ?? selectedBranch ?? detail?.defaultBranch ?? undefined;
    const nextUrl = buildCodePath({
      owner,
      repo,
      kind: input.kind,
      ref: nextRef,
      path: input.nextPath,
      defaultBranch: detail?.defaultBranch ?? null
    });
    navigate(nextUrl);
  }

  function updatePath(next: { kind: CodeViewKind; path: string }) {
    openCodeLocation({
      kind: next.kind,
      nextPath: next.path
    });
  }

  function openCommitFiles(commitOid: string) {
    openCodeLocation({
      kind: "tree",
      nextRef: commitOid,
      nextPath: ""
    });
  }

  async function openCommitDetail(commitOid: string) {
    try {
      const detailResponse = await getRepositoryCommitDetail(owner, repo, commitOid);
      setSelectedCommitDetail(detailResponse);
    } catch (loadError) {
      setError(formatApiError(loadError));
    }
  }

  if (!owner || !repo) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>仓库路径不完整。</AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!detail || !history || !contents) {
    return (
      <PageLoadingState
        title="Loading repository"
        description={`Preparing code, history, and README for ${owner}/${repo}.`}
      />
    );
  }

  const latestCommit = history.commits[0] ?? null;
  const selectedBranchLabel = selectedBranch
    ? isCommitOid(selectedBranch)
      ? `commit: ${selectedBranch}`
      : `branch: ${selectedBranch}`
    : null;

  return (
    <div className="space-y-4">
      <RepositoryHeader
        owner={owner}
        repo={repo}
        detail={detail}
        user={user}
        active="code"
        commitCount={history.commits.length}
        selectedBranchLabel={selectedBranchLabel}
      />

      {loading ? (
        <InlineLoadingState
          title="Refreshing code view"
          description="Updating the selected ref, path history, and file preview."
        />
      ) : null}

      <section className="rounded-md border">
        <div className="flex flex-col gap-3 border-b bg-[#f6f8fa] px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={selectedRefInSelect}
              onValueChange={(value) => {
                if (value.startsWith("__commit__:")) {
                  return;
                }
                openCodeLocation({
                  kind: viewKind,
                  nextRef: value,
                  nextPath: path
                });
              }}
            >
              <SelectTrigger className="h-8 w-[220px] bg-background text-xs">
                <SelectValue placeholder="选择分支" />
              </SelectTrigger>
              <SelectContent>
                {commitSelectValue ? (
                  <SelectItem value={commitSelectValue} disabled>
                    commit: {commitShortOid}
                  </SelectItem>
                ) : null}
                {detail.branches.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">default: {detail.defaultBranch ?? "none"}</span>
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 rounded-md border bg-background px-3 py-2">
              <div className="flex items-center gap-2">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <code className="block truncate text-xs">{cloneUrl}</code>
              </div>
            </div>
            <CopyButton value={cloneUrl} />
          </div>
        </div>

        {latestCommit ? (
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <AuthorAvatar name={latestCommit.author.name} className="h-6 w-6 text-[10px]" />
            <button
              type="button"
              onClick={() => {
                void openCommitDetail(latestCommit.oid);
              }}
              className="font-medium text-[#0969da] hover:underline"
            >
              {commitTitle(latestCommit.message)}
            </button>
            <span>·</span>
            <span>{latestCommit.author.name}</span>
            <span>·</span>
            <span>{formatRelativeTime(latestCommit.author.timestamp * 1000)}</span>
            <button
              type="button"
              onClick={() => openCommitFiles(latestCommit.oid)}
              className="ml-auto font-mono text-[#0969da] hover:underline"
            >
              {shortOid(latestCommit.oid)}
            </button>
          </div>
        ) : null}

        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_340px]">
          <RepositoryContentsPanel contents={contents} onNavigate={updatePath} />

          <aside className="min-w-0">
            {pathHistory && pathHistory.commits.length > 0 ? (
              <section className="border-b">
                <header className="inline-flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
                  <History className="h-4 w-4" />
                  Path history
                </header>
                <ul className="divide-y">
                  {pathHistory.commits.map((commit) => (
                    <li key={`path-${commit.oid}`} className="space-y-1 p-3">
                      <div className="flex items-start gap-2">
                        <AuthorAvatar name={commit.author.name} className="h-7 w-7 text-[11px]" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <button
                            type="button"
                            onClick={() => {
                              void openCommitDetail(commit.oid);
                            }}
                            className="block max-w-full truncate text-left text-sm font-medium leading-5 text-[#0969da] hover:underline"
                          >
                            {commitTitle(commit.message)}
                          </button>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span className="truncate">{commit.author.name}</span>
                            <span>·</span>
                            <span>{formatRelativeTime(commit.author.timestamp * 1000)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openCommitFiles(commit.oid)}
                          className="font-mono text-xs text-[#0969da] hover:underline"
                        >
                          {shortOid(commit.oid)}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {selectedCommitDetail ? (
              <section className="border-b">
                <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Commit detail</p>
                    <p className="text-xs text-muted-foreground">
                      {shortOid(selectedCommitDetail.commit.oid)} ·{" "}
                      {formatDateTime(selectedCommitDetail.commit.author.timestamp * 1000)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openCommitFiles(selectedCommitDetail.commit.oid)}
                  >
                    Browse snapshot
                  </Button>
                </header>
                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <AuthorAvatar
                      name={selectedCommitDetail.commit.author.name}
                      className="h-7 w-7 text-[11px]"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {commitTitle(selectedCommitDetail.commit.message)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedCommitDetail.commit.author.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{selectedCommitDetail.filesChanged} files</Badge>
                    <Badge variant="outline">+{selectedCommitDetail.additions}</Badge>
                    <Badge variant="outline">-{selectedCommitDetail.deletions}</Badge>
                  </div>
                  <RepositoryDiffView changes={selectedCommitDetail.changes} />
                </div>
              </section>
            ) : null}

            <header className="inline-flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
              <History className="h-4 w-4" />
              Recent commits
            </header>
            {history.commits.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">当前引用下没有提交记录。</div>
            ) : (
              <ul className="divide-y">
                {history.commits.map((commit) => (
                  <li key={commit.oid} className="space-y-1 p-3">
                    <div className="flex items-start gap-2">
                      <AuthorAvatar name={commit.author.name} className="h-7 w-7 text-[11px]" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            void openCommitDetail(commit.oid);
                          }}
                          className="block max-w-full truncate text-left text-sm font-medium leading-5 text-[#0969da] hover:underline"
                        >
                          {commitTitle(commit.message)}
                        </button>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="truncate">{commit.author.name}</span>
                          <span>·</span>
                          <span>{formatRelativeTime(commit.author.timestamp * 1000)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openCommitFiles(commit.oid)}
                        className="font-mono text-xs text-[#0969da] hover:underline"
                      >
                        {shortOid(commit.oid)}
                      </button>
                    </div>
                    <div className="pl-9 text-[11px] text-muted-foreground">
                      {formatDateTime(commit.author.timestamp * 1000)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
