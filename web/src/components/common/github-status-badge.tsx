import { githubErrorMessage } from "@/lib/github-errors";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GithubRepositoryState, GithubSourceStatus } from "@/lib/github-api";

const labels = {
  excluded: "未同步",
  queued: "排队中",
  syncing: "同步中",
  synced: "已同步",
  failed: "失败",
  too_large: "超出大小限制",
  name_conflict: "名称冲突",
  missing: "GitHub 上不可访问",
  ok: "正常",
  sso_required: "需要 SSO 授权",
  paused: "已暂停"
};
export function GithubStatusBadge({
  status,
  error
}: {
  status: GithubRepositoryState | GithubSourceStatus;
  error?: string | null;
}) {
  const badge = (
    <Badge
      variant={
        status === "ok" || status === "synced"
          ? "success"
          : ["failed", "too_large", "name_conflict", "missing", "sso_required"].includes(status)
            ? "destructive"
            : "outline"
      }
    >
      {labels[status]}
    </Badge>
  );
  return error ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent className="break-words">{githubErrorMessage(error)}</TooltipContent>
    </Tooltip>
  ) : (
    badge
  );
}
