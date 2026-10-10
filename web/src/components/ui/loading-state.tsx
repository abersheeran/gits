import { cn } from "@/lib/utils";

type LoadingStateProps = { className?: string; lines?: number };
export function InlineLoadingState({ className, lines = 3 }: LoadingStateProps) {
  return <div role="status" aria-label="正在加载" aria-busy="true" className={cn("space-y-3 p-4", className)}>
    <span className="sr-only">正在加载</span>
    {Array.from({ length: lines }, (_, index) => <div key={index} aria-hidden="true"
      className={cn("h-4 animate-pulse rounded-md bg-fill-primary", index % 2 ? "w-3/5" : "w-full")} />)}
  </div>;
}
export function PageLoadingState(props: LoadingStateProps) {
  return <InlineLoadingState {...props} />;
}
