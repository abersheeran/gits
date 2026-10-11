import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { CodeLinesSkeleton } from "@/components/ui/code-viewer-skeleton";
import { Panel } from "@/components/common/panel";
import { cn } from "@/lib/utils";

const widths = ["w-2/5", "w-1/3", "w-1/2", "w-1/4", "w-3/5"];

export function RepositoryContentsSkeleton({ kind }: { kind: "tree" | "blob" }) {
  return (
    <Panel
      header={
        <SkeletonRegion className="flex w-full items-center gap-3">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Skeleton className="h-3.5 w-12 shrink-0 md:w-20" />
            <Skeleton className="h-3.5 max-w-md flex-1" />
          </div>
          <Skeleton className="hidden h-6 w-16 md:block" />
          <Skeleton className="h-10 w-10 shrink-0 sm:w-20 md:h-8" />
        </SkeletonRegion>
      }
    >
      <SkeletonRegion announce>
        {kind === "blob" ? (
          <>
            <div className="flex h-10 items-center border-b border-border-subtle bg-surface-canvas px-4">
              <Skeleton className="h-3 w-28" />
            </div>
            <CodeLinesSkeleton />
          </>
        ) : (
          Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="grid h-12 grid-cols-1 items-center border-b border-border-subtle last:border-b-0 md:h-11 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]"
            >
              <div className="flex min-w-0 items-center gap-2 px-4">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className={cn("h-3.5", widths[index % widths.length])} />
              </div>
              <div className="hidden px-4 md:block">
                <Skeleton className="h-3.5 w-3/5" />
              </div>
              <div className="hidden px-4 md:block">
                <Skeleton className="ml-auto h-3 w-16" />
              </div>
            </div>
          ))
        )}
      </SkeletonRegion>
    </Panel>
  );
}

export function ReadmeSkeleton() {
  return (
    <SkeletonRegion announce className="space-y-2">
      {["w-full", "w-full", "w-5/6", "w-full", "w-2/5"].map((width, index) => (
        <div key={index} className="flex h-5 items-center">
          <Skeleton className={cn("h-3.5", width)} />
        </div>
      ))}
    </SkeletonRegion>
  );
}
