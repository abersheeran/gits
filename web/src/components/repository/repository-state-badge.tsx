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
      <Badge variant="secondary" className="inline-flex items-center gap-1 rounded-full bg-violet-100 text-violet-800">
        <GitMerge className="h-3.5 w-3.5" />
        merged
      </Badge>
    );
  }

  if (state === "closed") {
    return (
      <Badge variant="secondary" className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        closed
      </Badge>
    );
  }

  const Icon = kind === "pull_request" ? GitPullRequest : MessageSquareText;
  return (
    <Badge
      variant="secondary"
      className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800"
    >
      {draft ? <AlertCircle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
      {draft ? "draft" : "open"}
    </Badge>
  );
}
