import { Code2 } from "lucide-react";
import type { ReactNode } from "react";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import { ShaCopyButton } from "./sha-copy-button";
import { IconButton } from "./icon-button";
import { RelativeTime } from "./relative-time";
import type { CommitSummary } from "@/lib/api";
import { commitTitle } from "@/lib/repository-navigation";
import { cn } from "@/lib/utils";

export function CommitRow({
  commit,
  onOpen,
  onBrowse,
  compact = false,
  actions
}: {
  commit: CommitSummary;
  onOpen: (oid: string) => void;
  onBrowse?: (oid: string) => void;
  compact?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        compact ? "w-full" : "px-4 py-2.5 hover:bg-surface-hover"
      )}
    >
      <AuthorAvatar
        name={commit.author.name}
        className={cn("shrink-0", compact ? "h-6 w-6" : "h-8 w-8")}
      />
      <div className={cn("min-w-0 flex-1", compact && "flex items-center gap-2 text-body-xs")}>
        {compact && <span className="max-w-32 truncate font-medium">{commit.author.name}</span>}
        <button
          className={cn(
            "gh-link -my-2 block min-w-0 max-w-full py-2 text-left text-body-xs",
            compact ? "flex-1 truncate text-text-secondary" : "font-medium"
          )}
          onClick={() => onOpen(commit.oid)}
          title={commitTitle(commit.message)}
        >
          <span className="block truncate">{commitTitle(commit.message)}</span>
        </button>
        {!compact && (
          <div className="mt-1 flex flex-wrap gap-x-2 text-body-micro text-text-tertiary">
            <span className="max-w-40 truncate">{commit.author.name}</span>
            <span>·</span>
            <RelativeTime timestamp={commit.author.timestamp * 1000} />
          </div>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-3 md:flex">
        <ShaCopyButton oid={commit.oid} />
        {compact && (
          <span className="text-body-micro text-text-tertiary">
            <RelativeTime timestamp={commit.author.timestamp * 1000} />
          </span>
        )}
      </div>
      {onBrowse && (
        <IconButton label="浏览此时的文件" onClick={() => onBrowse(commit.oid)}>
          <Code2 className="h-4 w-4" />
        </IconButton>
      )}
      {actions}
    </div>
  );
}
