import { Link } from "react-router-dom";
import { Code2, GitPullRequest, MessageSquareText, Workflow } from "lucide-react";
import type { RepositoryDetailResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export type RepositorySection = "code" | "issues" | "pulls" | "actions";

type RepositoryTabsProps = {
  owner: string;
  repo: string;
  detail: RepositoryDetailResponse;
  active: RepositorySection;
};

const tabs = [
  { key: "code", label: "Code", icon: Code2, href: (owner: string, repo: string) => `/repo/${owner}/${repo}` },
  {
    key: "issues",
    label: "Issues",
    icon: MessageSquareText,
    href: (owner: string, repo: string) => `/repo/${owner}/${repo}/issues`
  },
  {
    key: "pulls",
    label: "Pull requests",
    icon: GitPullRequest,
    href: (owner: string, repo: string) => `/repo/${owner}/${repo}/pulls`
  },
  {
    key: "actions",
    label: "Actions",
    icon: Workflow,
    href: (owner: string, repo: string) => `/repo/${owner}/${repo}/actions`
  }
] as const;

function tabCount(
  detail: RepositoryDetailResponse,
  key: RepositorySection
): number | null {
  if (key === "issues") {
    return detail.openIssueCount;
  }
  if (key === "pulls") {
    return detail.openPullRequestCount;
  }
  return null;
}

export function RepositoryTabs({ owner, repo, detail, active }: RepositoryTabsProps) {
  return (
    <nav className="flex flex-wrap items-end gap-1 border-b border-border px-1" aria-label="Repository sections">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        const count = tabCount(detail, tab.key);
        return (
          <Link
            key={tab.key}
            to={tab.href(owner, repo)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors",
              isActive
                ? "border-[#fd8c73] font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
            {count !== null ? (
              <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
