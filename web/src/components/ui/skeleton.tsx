import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn("rounded-md bg-fill-primary motion-safe:animate-pulse", className)}
    />
  );
}

export function SkeletonRegion({
  announce = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { announce?: boolean }) {
  return (
    <div
      {...props}
      role={announce ? "status" : undefined}
      aria-busy={announce ? true : undefined}
      aria-hidden={announce ? undefined : true}
      className={cn("min-w-0", className)}
    >
      {announce && <span className="sr-only">正在加载…</span>}
      {children}
    </div>
  );
}
