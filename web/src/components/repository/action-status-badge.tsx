import { LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentSessionRecord } from "@/lib/api";
import { cn } from "@/lib/utils";

function actionStatusDotClass(status: AgentSessionRecord["status"]): string {
  if (status === "success") {
    return "bg-action-primaryBg";
  }
  if (status === "failed" || status === "cancelled") {
    return "bg-danger-text";
  }
  if (status === "running") {
    return "bg-fill-secondary";
  }
  return "bg-fill-tertiary";
}

function actionStatusBadgeVariant(
  status: AgentSessionRecord["status"]
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") {
    return "default";
  }
  if (status === "failed" || status === "cancelled") {
    return "destructive";
  }
  if (status === "running") {
    return "secondary";
  }
  return "outline";
}

type ActionStatusBadgeProps = {
  status: AgentSessionRecord["status"];
  withDot?: boolean;
  className?: string;
};

export function ActionStatusBadge({
  status,
  withDot = false,
  className
}: ActionStatusBadgeProps) {
  return (
    <Badge
      variant={actionStatusBadgeVariant(status)}
      className={cn("inline-flex items-center gap-1", className)}
    >
      {withDot ? (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            actionStatusDotClass(status),
            status === "running" ? "animate-pulse" : ""
          )}
        />
      ) : null}
      {status === "running" && !withDot ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
      {status}
    </Badge>
  );
}
