import type { ReactNode } from "react";
export function PageHeader({
  title,
  leading,
  description,
  action
}: {
  title: ReactNode;
  leading?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {leading && <div className="flex h-8 shrink-0 items-center">{leading}</div>}
        <div className="min-w-0">
          <h1 className="break-words font-display text-[22px] font-semibold leading-8">{title}</h1>
          {description && <div className="mt-1 text-body-xs text-text-secondary">{description}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
