import { FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center text-body-xs">
      <FolderOpen className="h-6 w-6 text-text-tertiary" aria-hidden="true" />
      <p>{title}</p>
      {description && <p className="text-text-secondary">{description}</p>}
      {action}
    </div>
  );
}
