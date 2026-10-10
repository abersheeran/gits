import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
export function Panel({
  header,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { header?: ReactNode }) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border bg-surface-base",
        className
      )}
      {...props}
    >
      {header && (
        <header className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
          {typeof header === "string" ? <PanelTitle>{header}</PanelTitle> : header}
        </header>
      )}
      {children}
    </section>
  );
}

export function PanelTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("font-display text-heading-3-16-semibold", className)} {...props}>
      {children}
    </h2>
  );
}
