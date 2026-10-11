import type { ReactNode } from "react";
export function PageHeader({
  title,
  description,
  action
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h1 className="break-words font-display text-[22px] font-semibold leading-8">{title}</h1>
        {description && <div className="mt-1 text-body-xs text-text-secondary">{description}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
