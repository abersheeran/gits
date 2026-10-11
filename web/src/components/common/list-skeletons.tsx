import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type TableVariant = "repositories" | "sessions" | "tokens" | "collaborators" | "branches";
const widths = ["w-2/5", "w-1/3", "w-1/2", "w-1/4", "w-3/5"];

export function TableSkeleton({
  variant = "repositories",
  rows = variant === "repositories" ? 5 : 3,
  announce = true
}: {
  variant?: TableVariant;
  rows?: number;
  announce?: boolean;
}) {
  const hasPermission = variant === "collaborators";
  const hasStatus = variant === "tokens" || variant === "sessions";
  const columns = cn(
    "grid items-center",
    variant === "repositories" && "grid-cols-1 md:grid-cols-[minmax(0,1fr)_8rem]",
    variant === "branches" && "grid-cols-1 md:grid-cols-2",
    hasPermission &&
      "grid-cols-[minmax(0,1fr)_8rem_4rem] md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_4rem]",
    hasStatus &&
      "grid-cols-[minmax(0,1fr)_5rem_5rem] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_5rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_5rem]"
  );
  function secondaryCells(header = false) {
    return (
      <>
        {hasPermission && (
          <div className="px-4">
            <Skeleton className="h-3 w-12" />
          </div>
        )}
        <div className="hidden px-4 md:block">
          <Skeleton
            className={cn("h-3 w-16 max-w-full", variant === "repositories" && "ml-auto")}
          />
        </div>
        {hasStatus && (
          <>
            <div className="hidden px-4 lg:block">
              <Skeleton className="h-3 w-16 max-w-full" />
            </div>
            <div className="px-4">
              <Skeleton className={header ? "h-3 w-8" : "h-5 w-12 rounded-full"} />
            </div>
          </>
        )}
        {(hasPermission || hasStatus) && <div />}
      </>
    );
  }
  return (
    <SkeletonRegion announce={announce}>
      <div className={cn(columns, "h-10 border-b border-border-subtle bg-surface-canvas")}>
        <div className="px-4">
          <Skeleton className="h-3 w-12" />
        </div>
        {secondaryCells(true)}
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(columns, "h-12 border-b border-border-subtle last:border-b-0 md:h-11")}
        >
          <div className="flex min-w-0 items-center gap-2 px-4">
            {hasPermission && <Skeleton className="size-6 shrink-0 rounded-full" />}
            <div className="min-w-0 flex-1">
              <div className="flex h-5 items-center">
                <Skeleton className={cn("h-3.5", widths[index % widths.length])} />
              </div>
              {hasStatus && (
                <div className="hidden h-4 items-center md:flex">
                  <Skeleton className="h-3 w-3/5" />
                </div>
              )}
            </div>
          </div>
          {secondaryCells()}
        </div>
      ))}
    </SkeletonRegion>
  );
}

export function CommitListSkeleton({
  rows = 6,
  browseAction = false,
  announce = true
}: {
  rows?: number;
  browseAction?: boolean;
  announce?: boolean;
}) {
  return (
    <SkeletonRegion announce={announce} className="divide-y divide-border-subtle">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex h-5 items-center">
              <Skeleton className={cn("h-3.5", widths[index % widths.length])} />
            </div>
            <div className="mt-1 flex h-4 items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="hidden h-6 w-16 shrink-0 md:block" />
          {browseAction && <Skeleton className="size-10 shrink-0 md:size-8" />}
        </div>
      ))}
    </SkeletonRegion>
  );
}
