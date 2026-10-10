import { Code2, History, GitBranch, Settings, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { AuthUser, RepositoryDetailResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
export function RepositoryLayout({
  detail,
  user,
  children
}: {
  detail: RepositoryDetailResponse;
  user: AuthUser | null;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const repository = detail.repository;
  const base = `/repo/${repository.owner_username}/${repository.name}`;
  const settings = pathname === `${base}/settings` || pathname === `${base}/collaborators`;
  const tab = settings
    ? "settings"
    : pathname === `${base}/branches`
      ? "branches"
      : pathname === `${base}/commits`
        ? "commits"
        : "";
  const ref = detail.selectedRef?.replace(/^refs\/heads\//, "");
  const tabs: Array<[string, string, LucideIcon]> = [
    ["", "代码", Code2],
    ["commits", "提交", History],
    ["branches", "分支", GitBranch]
  ];
  if (user?.username === repository.owner_username) tabs.push(["settings", "设置", Settings]);
  return (
    <div className="min-w-0 space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-all font-display text-[22px] leading-8">
            <span className="text-text-secondary">{repository.owner_username} / </span>
            <Link className="font-semibold hover:underline" to={base}>
              {repository.name}
            </Link>
          </h1>
          <Badge variant="outline">{repository.is_private ? "私有" : "公开"}</Badge>
        </div>
        {repository.description && (
          <p className="break-words text-body-xs text-text-secondary">{repository.description}</p>
        )}
      </header>
      <nav aria-label="仓库导航" className="flex min-w-0 overflow-x-auto border-b border-border">
        {tabs.map(([key, label, Icon]) => (
          <Link
            key={key}
            aria-current={tab === key ? "page" : undefined}
            to={
              key === "commits" && ref
                ? `${base}/commits?ref=${encodeURIComponent(ref)}`
                : key
                  ? `${base}/${key}`
                  : base
            }
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
      {settings ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
          <nav aria-label="设置导航" className="flex gap-1 md:flex-col">
            {[
              ["settings", "常规"],
              ["collaborators", "协作者"]
            ].map(([key, label]) => (
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
