import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const widths = ["w-2/5", "w-1/3", "w-1/2", "w-1/4", "w-3/5"];

export function CodeLinesSkeleton({ rows = 14 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="min-w-0 bg-surface-canvas px-4 py-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-5 items-center">
          <Skeleton className={cn("h-3", widths[index % widths.length])} />
        </div>
      ))}
    </div>
  );
}

export function CodeViewerSkeleton({
  height,
  announce = false
}: {
  height?: number | string;
  announce?: boolean;
}) {
  return (
    <SkeletonRegion
      announce={announce}
      className="w-full overflow-hidden bg-surface-canvas"
      style={{ height }}
    >
      <CodeLinesSkeleton
        rows={typeof height === "number" ? Math.min(40, Math.max(0, Math.ceil(height / 20))) : 14}
      />
    </SkeletonRegion>
  );
}
