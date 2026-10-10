import { FolderOpen } from "lucide-react";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import { ShaCopyButton } from "./sha-copy-button";
import { IconButton } from "./icon-button";
import { RelativeTime } from "./relative-time";
import type { CommitSummary } from "@/lib/api";
import { commitTitle } from "@/lib/repository-navigation";
export function CommitRow({
  commit,
  onOpen,
  onBrowse
}: {
  commit: CommitSummary;
  onOpen: (oid: string) => void;
  onBrowse?: (oid: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-surface-hover">
      <AuthorAvatar name={commit.author.name} className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <button
          className="gh-link block min-h-10 min-w-0 max-w-full md:min-h-0 text-left text-body-xs font-medium"
          onClick={() => onOpen(commit.oid)}
        >
          <span className="block truncate">{commitTitle(commit.message)}</span>
        </button>
        <div className="mt-1 flex flex-wrap gap-x-2 text-body-micro text-text-tertiary">
          <span className="max-w-40 truncate">{commit.author.name}</span>
          <RelativeTime timestamp={commit.author.timestamp * 1000} />
        </div>
      </div>
      <div className="hidden items-center gap-1 md:flex">
        <ShaCopyButton oid={commit.oid} />
      </div>
      {onBrowse && (
        <IconButton label="浏览此时的文件" onClick={() => onBrowse(commit.oid)}>
          <FolderOpen className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
}
