import { LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ActionRunRecord } from "@/lib/api";
import { cn } from "@/lib/utils";

function actionStatusDotClass(status: ActionRunRecord["status"]): string {
  if (status === "success") {
    return "bg-emerald-500";
  }
  if (status === "failed" || status === "cancelled") {
    return "bg-red-500";
  }
  if (status === "running") {
    return "bg-sky-500";
  }
  return "bg-slate-400";
}

function actionStatusBadgeVariant(
  status: ActionRunRecord["status"]
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
  status: ActionRunRecord["status"];
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
