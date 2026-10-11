import { Code2, History, GitBranch, Settings, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { RepositoryDetailResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
export function RepositoryLayout({
  detail,
  children
}: {
  detail: RepositoryDetailResponse;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const repository = detail.repository;
  const base = `/repo/${repository.owner_username}/${repository.name}`;
  const settingsItems: Array<[string, string]> =
    detail.viewerPermission === "owner"
      ? [["settings", "常规"], ["collaborators", "协作者"]]
      : detail.viewerPermission === "admin"
        ? [["collaborators", "协作者"]]
        : [];
  const settings = pathname === `${base}/settings` || pathname === `${base}/collaborators`;
  const tab = settings
    ? "settings"
    : pathname === `${base}/branches`
      ? "branches"
      : pathname === `${base}/commits`
        ? "commits"
        : "";
  const ref = detail.selectedRef?.replace(/^refs\/heads\//, "");
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
