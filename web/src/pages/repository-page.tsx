import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  BookOpenText,
  Code2,
  GitBranch,
  GitPullRequest,
  Globe,
  History,
  Lock,
  MessageSquareText
} from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  formatApiError,
  getRepositoryCommits,
  getRepositoryDetail,
  type AuthUser,
  type CommitHistoryResponse,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime, formatRelativeTime, shortOid } from "@/lib/format";

type RepositoryPageProps = {
  user: AuthUser | null;
};

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

function commitTitle(message: string): string {
  return (message.split("\n")[0] ?? "").trim() || "(no message)";
}

function authorInitial(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    return "?";
  }
  return normalized.slice(0, 1).toUpperCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function authorAvatarStyle(name: string): { backgroundColor: string; color: string } {
  const hue = hashString(name) % 360;
  return {
    backgroundColor: `hsl(${hue} 70% 92%)`,
    color: `hsl(${hue} 46% 30%)`
  };
}

export function RepositoryPage({ user }: RepositoryPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = searchParams.get("ref") ?? undefined;

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [history, setHistory] = useState<CommitHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function load() {
      if (!owner || !repo) {
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [nextDetail, nextHistory] = await Promise.all([
          getRepositoryDetail(owner, repo, ref),
          getRepositoryCommits(owner, repo, { ref, limit: 20 })
        ]);

        if (canceled) {
          return;
        }

        setDetail(nextDetail);
        setHistory(nextHistory);
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
  }, [owner, repo, ref]);

  const selectedBranch = useMemo(() => selectedBranchName(detail?.selectedRef ?? null), [detail]);
  const cloneUrl = `${window.location.origin}/${owner}/${repo}.git`;

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

  if (loading || !detail || !history) {
    return <p className="text-sm text-muted-foreground">正在加载仓库...</p>;
  }

  const isPrivate = detail.repository.is_private === 1;
  const latestCommit = history.commits[0] ?? null;

  return (
    <div className="space-y-4">
      <header className="space-y-3 rounded-md border bg-[#f6f8fa] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1 text-xl font-semibold tracking-tight">
              <Link className="text-[#0969da] hover:underline" to={`/repo/${owner}/${repo}`}>
                {detail.repository.owner_username}
              </Link>
              <span className="text-muted-foreground">/</span>
              <span className="truncate text-[#0969da]">{detail.repository.name}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {detail.repository.description?.trim() || "No description provided."}
            </p>
          </div>
          <Badge variant="outline" className="inline-flex items-center gap-1 rounded-full bg-background font-medium">
            {isPrivate ? <Lock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
            {isPrivate ? "Private" : "Public"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="inline-flex items-center gap-1 rounded-md px-2 py-0 text-[11px]">
            <GitBranch className="h-3.5 w-3.5" />
            {detail.branches.length} branches
          </Badge>
          <Badge variant="outline" className="inline-flex items-center gap-1 rounded-md px-2 py-0 text-[11px]">
            <History className="h-3.5 w-3.5" />
            {history.commits.length} commits
          </Badge>
          {selectedBranch ? (
            <Badge variant="outline" className="rounded-md px-2 py-0 text-[11px]">
              branch: {selectedBranch}
            </Badge>
          ) : null}
          {user?.username === detail.repository.owner_username ? (
            <Button variant="outline" size="sm" className="ml-auto bg-background" asChild>
              <Link to={`/repo/${owner}/${repo}/settings`}>Settings</Link>
            </Button>
          ) : null}
        </div>
      </header>

      <nav
        className="flex flex-wrap items-end gap-1 border-b border-border"
        aria-label="Repository sections"
      >
        <Link
          to={`/repo/${owner}/${repo}`}
          className="inline-flex items-center gap-1.5 border-b-2 border-[#fd8c73] px-3 py-2 text-sm font-medium text-foreground"
        >
          <Code2 className="h-4 w-4" />
          Code
        </Link>
        <span className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground">
          <MessageSquareText className="h-4 w-4" />
          Issues
          <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">0</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground">
          <GitPullRequest className="h-4 w-4" />
          Pull requests
          <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">0</span>
        </span>
      </nav>

      <section className="rounded-md border">
        <div className="flex flex-col gap-3 border-b bg-[#f6f8fa] px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={selectedBranch ?? detail.branches[0]?.name}
              onValueChange={(value) => {
                const next = new URLSearchParams(searchParams);
                next.set("ref", value);
                setSearchParams(next);
              }}
            >
              <SelectTrigger className="h-8 w-[220px] bg-background text-xs">
                <SelectValue placeholder="选择分支" />
              </SelectTrigger>
              <SelectContent>
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
              <code className="block truncate text-xs">{cloneUrl}</code>
            </div>
            <CopyButton value={cloneUrl} />
          </div>
        </div>

        {latestCommit ? (
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <div
              className="grid h-6 w-6 place-content-center rounded-full text-[10px] font-semibold"
              style={authorAvatarStyle(latestCommit.author.name)}
              aria-hidden
            >
              {authorInitial(latestCommit.author.name)}
            </div>
            <span className="font-medium text-foreground">{commitTitle(latestCommit.message)}</span>
            <span>·</span>
            <span>{latestCommit.author.name}</span>
            <span>·</span>
            <span>{formatRelativeTime(latestCommit.author.timestamp * 1000)}</span>
            <span className="ml-auto font-mono">{shortOid(latestCommit.oid)}</span>
          </div>
        ) : null}

        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 border-b xl:border-b-0 xl:border-r">
            <header className="inline-flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
              <BookOpenText className="h-4 w-4" />
              README
              <span className="text-xs font-normal text-muted-foreground">
                {detail.readme ? detail.readme.path : "README not found"}
              </span>
            </header>
            <div className="p-4">
              {detail.readme ? (
                <Suspense fallback={<div className="text-sm text-muted-foreground">README 渲染中...</div>}>
                  <LazyReadmeMarkdown content={detail.readme.content} />
                </Suspense>
              ) : (
                <div className="text-sm text-muted-foreground">当前分支没有可识别的 README 文件。</div>
              )}
            </div>
          </section>

          <aside className="min-w-0">
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
                      <div
                        className="grid h-7 w-7 shrink-0 place-content-center rounded-full text-[11px] font-semibold"
                        style={authorAvatarStyle(commit.author.name)}
                        aria-hidden
                      >
                        {authorInitial(commit.author.name)}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="truncate text-sm font-medium leading-5">{commitTitle(commit.message)}</div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="truncate">{commit.author.name}</span>
                          <span>·</span>
                          <span>{formatRelativeTime(commit.author.timestamp * 1000)}</span>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">{shortOid(commit.oid)}</span>
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
