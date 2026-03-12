import { AlertCircle, CheckCircle2, GitMerge, GitPullRequest, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type RepositoryStateBadgeProps = {
  state: "open" | "closed" | "merged";
  kind?: "issue" | "pull_request";
  draft?: boolean;
};

export function RepositoryStateBadge({
  state,
  kind = "issue",
  draft = false
}: RepositoryStateBadgeProps) {
  if (state === "merged") {
    return (
      <Badge
        variant="secondary"
        className="inline-flex items-center gap-1 border-transparent bg-fill-secondary text-text-primary"
      >
        <GitMerge className="h-3.5 w-3.5" />
        merged
      </Badge>
    );
  }

  if (state === "closed") {
    return (
      <Badge
        variant="outline"
        className="inline-flex items-center gap-1 border-border-subtle bg-surface-base text-text-supporting-strong"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        closed
      </Badge>
    );
  }

  const Icon = kind === "pull_request" ? GitPullRequest : MessageSquareText;
  return (
    <Badge
      variant="secondary"
      className="inline-flex items-center gap-1 border-transparent bg-fill-primary text-text-primary"
    >
      {draft ? <AlertCircle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
      {draft ? "draft" : "open"}
    </Badge>
  );
}
