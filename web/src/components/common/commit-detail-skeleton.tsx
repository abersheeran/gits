import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { CodeLinesSkeleton } from "@/components/ui/code-viewer-skeleton";

export function CommitDetailHeaderSkeleton() {
  return (
    <SkeletonRegion className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex h-6 items-center">
              <Skeleton className="h-5 w-2/3" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
        <Skeleton className="h-10 w-full sm:w-36 md:h-8" />
      </div>
      <div className="flex h-10 items-center gap-3 md:h-8">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
      </div>
    </SkeletonRegion>
  );
}

export function CommitDetailSkeleton() {
  return (
    <SkeletonRegion
      announce
      className="grid gap-4 xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <div className="flex h-11 items-center border-b border-border-subtle px-4">
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="py-2">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex h-10 items-center gap-2 px-4 md:h-8">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        {[0, 1].map((index) => (
          <section
            key={index}
            className="overflow-hidden rounded-lg border border-border bg-surface-base"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-canvas px-4 py-3">
              <div className="flex h-5 min-w-0 flex-1 items-center">
                <Skeleton className="h-3.5 w-2/3" />
              </div>
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-8" />
            </div>
            <CodeLinesSkeleton rows={7} />
          </section>
        ))}
      </div>
    </SkeletonRegion>
  );
}
