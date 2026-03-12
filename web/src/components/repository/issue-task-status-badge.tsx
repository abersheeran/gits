import { Bot, CheckCircle2, CircleDot, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { IssueTaskStatus } from "@/lib/api";

type IssueTaskStatusBadgeProps = {
  status: IssueTaskStatus;
};

const TASK_STATUS_LABELS: Record<IssueTaskStatus, string> = {
  open: "open",
  "agent-working": "agent working",
  "waiting-human": "waiting human",
  done: "done"
};

export function IssueTaskStatusBadge({ status }: IssueTaskStatusBadgeProps) {
  if (status === "agent-working") {
    return (
      <Badge
        variant="secondary"
        className="inline-flex items-center gap-1 border-transparent bg-fill-primary text-text-primary"
      >
        <Bot className="h-3.5 w-3.5" />
        {TASK_STATUS_LABELS[status]}
      </Badge>
    );
  }

  if (status === "waiting-human") {
    return (
      <Badge
        variant="outline"
        className="inline-flex items-center gap-1 border-border-strong bg-surface-base text-text-supporting-strong"
      >
        <UserRound className="h-3.5 w-3.5" />
        {TASK_STATUS_LABELS[status]}
      </Badge>
    );
  }

  if (status === "done") {
    return (
      <Badge variant="default" className="inline-flex items-center gap-1 shadow-none">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {TASK_STATUS_LABELS[status]}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="inline-flex items-center gap-1 border-border-subtle bg-surface-base text-text-supporting-strong"
    >
      <CircleDot className="h-3.5 w-3.5" />
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}
