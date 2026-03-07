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
            "h-2.5 animate-pulse rounded-full bg-muted",
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
        "rounded-xl border bg-card/95 p-6 shadow-sm",
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full border bg-muted/40 p-2 text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{title}</p>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-dashed bg-muted/20 p-4">
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
        "rounded-lg border border-dashed bg-muted/20 p-4",
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-2.5">
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-medium">{title}</p>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
          <LoadingLines lines={lines} />
        </div>
      </div>
    </div>
  )
}
