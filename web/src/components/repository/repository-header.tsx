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
    <header className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
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
        {commitCount !== null ? (
          <Badge variant="outline" className="inline-flex items-center gap-1 rounded-md px-2 py-0 text-[11px]">
            <History className="h-3.5 w-3.5" />
            {commitCount} commits
          </Badge>
        ) : null}
        {selectedBranchLabel ? (
          <Badge variant="outline" className="rounded-md px-2 py-0 text-[11px]">
            {selectedBranchLabel.startsWith("commit:")
              ? `commit: ${shortOid(selectedBranchLabel.slice("commit:".length).trim())}`
              : selectedBranchLabel}
          </Badge>
        ) : null}
        {extra}
        {user?.username === detail.repository.owner_username ? (
          <Button variant="outline" size="sm" className="ml-auto bg-background" asChild>
            <Link to={`/repo/${owner}/${repo}/settings`}>Settings</Link>
          </Button>
        ) : null}
      </div>

      <RepositoryTabs owner={owner} repo={repo} detail={detail} active={active} />
    </header>
  );
}
