import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format";
import { Code2, History, GitBranch, Settings, type LucideIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { repositoryLayoutCache } from "@/lib/repository-layout-cache";
import { Badge } from "@/components/ui/badge";
import type { RepositoryDetailResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
export function RepositoryLayout({
  owner,
  repo,
  detail,
  children
}: {
  owner: string;
  repo: string;
  detail: RepositoryDetailResponse | null;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const key = `${owner}/${repo}`;
  const snapshot = repositoryLayoutCache.get(key);
  const mirror = detail ? detail.mirror : snapshot?.mirror;
  const repository = detail?.repository ?? snapshot;
  const base = `/repo/${owner}/${repo}`;
  const settings = pathname === `${base}/settings` || pathname === `${base}/collaborators`;
  const permission = detail ? detail.viewerPermission : snapshot?.viewerPermission;
  useEffect(() => {
    if (detail) {
      repositoryLayoutCache.set(key, {
        is_private: detail.repository.is_private,
        description: detail.repository.description,
        viewerPermission: detail.viewerPermission,
        mirror: detail.mirror
      });
    }
  }, [detail, key]);
  const settingsItems: Array<[string, string]> =
    permission === "owner" || (!detail && !snapshot && settings)
      ? [
          ["settings", "常规"],
          ["collaborators", "协作者"]
        ]
      : permission === "admin"
        ? [["collaborators", "协作者"]]
        : [];
  const tab = settings
    ? "settings"
    : pathname === `${base}/branches`
      ? "branches"
      : pathname === `${base}/commits`
        ? "commits"
        : "";
  const ref = detail?.selectedRef?.replace(/^refs\/heads\//, "");
  const tabs: Array<[string, string, string, LucideIcon]> = [
    ["", "代码", base, Code2],
    [
      "commits",
      "提交",
      ref ? `${base}/commits?ref=${encodeURIComponent(ref)}` : `${base}/commits`,
      History
    ],
    ["branches", "分支", `${base}/branches`, GitBranch]
  ];
  if (settingsItems.length > 0) {
    tabs.push(["settings", "设置", `${base}/${settingsItems[0][0]}`, Settings]);
  }
  return (
    <div className="min-w-0 space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-all font-display text-[22px] leading-8">
            <span className="text-text-secondary">{owner} / </span>
            <Link className="font-semibold hover:underline" to={base}>
              {repo}
            </Link>
          </h1>
          {mirror && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a href={mirror.htmlUrl} target="_blank" rel="noreferrer">
                  <Badge variant="outline">镜像</Badge>
                </a>
              </TooltipTrigger>
              <TooltipContent>
                同步自 GitHub · 上次同步{" "}
                {mirror.lastSyncedAt === null
                  ? "尚未同步"
                  : formatRelativeTime(mirror.lastSyncedAt)}
              </TooltipContent>
            </Tooltip>
          )}
          {repository ? (
            <Badge variant="outline">{repository.is_private ? "私有" : "公开"}</Badge>
          ) : (
            <SkeletonRegion>
              <Skeleton className="h-5 w-10 rounded-full" />
            </SkeletonRegion>
          )}
        </div>
        {repository?.description && (
          <p className="break-words text-body-xs text-text-secondary">{repository.description}</p>
        )}
      </header>
      <nav aria-label="仓库导航" className="flex min-w-0 overflow-x-auto border-b border-border">
        {tabs.map(([key, label, to, Icon]) => (
          <Link
            key={key}
            aria-current={tab === key ? "page" : undefined}
            to={to}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-body-xs",
              tab === key
                ? "border-text-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      {settings && settingsItems.length > 1 ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
          <nav aria-label="设置导航" className="flex gap-1 md:flex-col">
            {settingsItems.map(([key, label]) => (
              <Link
                key={key}
                to={`${base}/${key}`}
                aria-current={pathname === `${base}/${key}` ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-3 text-body-xs md:py-2",
                  pathname === `${base}/${key}`
                    ? "bg-surface-focus font-medium"
                    : "text-text-secondary hover:bg-surface-hover"
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="min-w-0 space-y-4">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
