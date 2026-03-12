import { LoaderCircle } from "lucide-react"

import { cn } from "@/lib/utils"

type LoadingStateProps = {
  title: string
  description?: string
  className?: string
  lines?: number
}

function LoadingLines({ lines = 3 }: { lines?: number }) {
  const widths = ["w-full", "w-4/5", "w-3/5", "w-2/3"]

  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "h-2.5 animate-pulse rounded-full bg-fill-primary",
            widths[index % widths.length]
          )}
        />
      ))}
    </div>
  )
}

export function PageLoadingState({
  title,
  description,
  className,
  lines = 4,
}: LoadingStateProps) {
  return (
    <section
      className={cn(
        "rounded-[28px] border border-border-subtle bg-surface-base p-6 shadow-container",
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full border border-border-subtle bg-surface-focus p-2 text-text-supporting">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="font-display text-heading-3-15 text-text-primary">{title}</p>
          {description ? (
            <p className="text-body-sm text-text-secondary">{description}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 panel-inset">
        <LoadingLines lines={lines} />
      </div>
    </section>
  )
}

export function InlineLoadingState({
  title,
  description,
  className,
  lines = 2,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        "panel-inset",
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-2.5">
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-text-supporting" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-display text-heading-3-15 text-text-primary">{title}</p>
          {description ? (
            <p className="text-body-sm text-text-secondary">{description}</p>
          ) : null}
          <LoadingLines lines={lines} />
        </div>
      </div>
    </div>
  )
}
