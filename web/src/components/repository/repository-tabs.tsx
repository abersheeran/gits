import { Link } from "react-router-dom";
import { Code2, History } from "lucide-react";
import { cn } from "@/lib/utils";

export type RepositorySection = "code" | "commits";

type RepositoryTabsProps = {
  owner: string;
  repo: string;
  active: RepositorySection;
};

const tabs = [
  { key: "code", label: "Code", icon: Code2, href: (owner: string, repo: string) => `/repo/${owner}/${repo}` },
  {
    key: "commits",
    label: "Commits",
    icon: History,
    href: (owner: string, repo: string) => `/repo/${owner}/${repo}/commits`
  }
] as const;

export function RepositoryTabs({ owner, repo, active }: RepositoryTabsProps) {
  return (
    <nav className="segmented-control w-full sm:w-fit" aria-label="Repository sections">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            to={tab.href(owner, repo)}
            className={cn(
              "segmented-control__item",
              isActive && "bg-surface-base text-text-primary shadow-sm hover:bg-surface-base"
            )}
            data-active={isActive}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
