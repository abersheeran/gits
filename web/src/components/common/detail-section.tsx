import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type DetailSectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  variant?: "default" | "muted";
};

export function DetailSection({
  title,
  description,
  headerActions,
  children,
  className,
  contentClassName,
  headerClassName,
  variant = "default"
}: DetailSectionProps) {
  const panelClassName = variant === "muted" ? "page-panel-muted" : "page-panel";
  const hasHeader = title || description || headerActions;

  return (
    <section className={cn(panelClassName, className)}>
      <div className={cn("space-y-4 p-4 md:p-5", contentClassName)}>
        {hasHeader ? (
          <div
            className={cn(
              "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
              headerClassName
            )}
          >
            <div className="space-y-1">
              {title ? (
                <h2 className="font-display text-heading-3-16-semibold text-text-primary">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p className="max-w-3xl text-body-sm text-text-secondary">{description}</p>
              ) : null}
            </div>
            {headerActions ? <div className="flex flex-wrap gap-2">{headerActions}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
