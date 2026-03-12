import { Link } from "react-router-dom";
import { Code2, GitPullRequest, History, MessageSquareText, Workflow } from "lucide-react";
import type { RepositoryDetailResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export type RepositorySection = "code" | "commits" | "issues" | "pulls" | "actions";

type RepositoryTabsProps = {
  owner: string;
  repo: string;
  detail: RepositoryDetailResponse;
  active: RepositorySection;
};

const tabs = [
  { key: "code", label: "Code", icon: Code2, href: (owner: string, repo: string) => `/repo/${owner}/${repo}` },
  {
    key: "commits",
    label: "Commits",
    icon: History,
    href: (owner: string, repo: string) => `/repo/${owner}/${repo}/commits`
  },
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
    <nav className="segmented-control w-fit max-w-full flex-wrap" aria-label="Repository sections">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        const count = tabCount(detail, tab.key);
        return (
          <Link
            key={tab.key}
            to={tab.href(owner, repo)}
            className={cn(
              "segmented-control__item",
              isActive && "bg-surface-base text-text-primary shadow-sm hover:bg-surface-base"
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
            {count !== null ? (
              <span
                className={cn(
                  "rounded-full border border-border-subtle px-1.5 py-0.5 font-sans text-label-xs",
                  isActive
                    ? "bg-surface-focus text-text-primary"
                    : "bg-surface-base text-text-supporting"
                )}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
