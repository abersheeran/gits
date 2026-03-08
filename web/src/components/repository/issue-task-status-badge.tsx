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
        className="inline-flex items-center gap-1 rounded-full bg-sky-100 text-sky-800"
      >
        <Bot className="h-3.5 w-3.5" />
        {TASK_STATUS_LABELS[status]}
      </Badge>
    );
  }

  if (status === "waiting-human") {
    return (
      <Badge
        variant="secondary"
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800"
      >
        <UserRound className="h-3.5 w-3.5" />
        {TASK_STATUS_LABELS[status]}
      </Badge>
    );
  }

  if (status === "done") {
    return (
      <Badge
        variant="secondary"
        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {TASK_STATUS_LABELS[status]}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700"
    >
      <CircleDot className="h-3.5 w-3.5" />
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}
