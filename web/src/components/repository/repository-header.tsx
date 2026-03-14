import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { GitBranch, Globe, History, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AuthUser, RepositoryDetailResponse } from "@/lib/api";
import { shortOid } from "@/lib/format";
import { RepositoryTabs, type RepositorySection } from "@/components/repository/repository-tabs";

type RepositoryHeaderProps = {
  owner: string;
  repo: string;
  detail: RepositoryDetailResponse;
  user: AuthUser | null;
  active: RepositorySection;
  commitCount?: number | null;
  selectedBranchLabel?: string | null;
  extra?: ReactNode;
};

export function RepositoryHeader({
  owner,
  repo,
  detail,
  user,
  active,
  commitCount = null,
  selectedBranchLabel = null,
  extra = null
}: RepositoryHeaderProps) {
  const isPrivate = detail.repository.is_private === 1;

  return (
    <header className="page-hero space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-text-secondary">
            <Link
              className="gh-link font-display text-heading-3-16-semibold"
              to={`/repo/${owner}/${repo}`}
            >
              {detail.repository.owner_username}
            </Link>
            <span>/</span>
            <span className="truncate font-display text-heading-3-16-semibold text-text-primary">
              {detail.repository.name}
            </span>
          </div>
          <p className="max-w-3xl text-body-sm text-text-secondary md:text-body-md">
            {detail.repository.description?.trim() || "No description provided."}
          </p>
        </div>
        <Badge variant="outline" className="inline-flex items-center gap-1 bg-surface-base">
          {isPrivate ? <Lock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
          {isPrivate ? "Private" : "Public"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="inline-flex items-center gap-1">
          <GitBranch className="h-3.5 w-3.5" />
          {detail.branches.length} branches
        </Badge>
        {commitCount !== null ? (
          <Badge variant="outline" className="inline-flex items-center gap-1">
            <History className="h-3.5 w-3.5" />
            {commitCount} commits
          </Badge>
        ) : null}
        {selectedBranchLabel ? (
          <Badge variant="secondary">
            {selectedBranchLabel.startsWith("commit:")
              ? `commit: ${shortOid(selectedBranchLabel.slice("commit:".length).trim())}`
              : selectedBranchLabel}
          </Badge>
        ) : null}
        {extra}
        {user?.username === detail.repository.owner_username ? (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="bg-surface-base" asChild>
              <Link to={`/repo/${owner}/${repo}/branches`}>Branches</Link>
            </Button>
            <Button variant="outline" size="sm" className="bg-surface-base" asChild>
              <Link to={`/repo/${owner}/${repo}/settings`}>Settings</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <RepositoryTabs owner={owner} repo={repo} detail={detail} active={active} />
    </header>
  );
}
