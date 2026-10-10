import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-body-xs">
      <Icon className="h-6 w-6 text-text-tertiary" aria-hidden="true" />
      <p className="font-medium text-text-primary">{title}</p>
      {description && <p className="text-text-secondary">{description}</p>}
      {action}
    </div>
  );
}
