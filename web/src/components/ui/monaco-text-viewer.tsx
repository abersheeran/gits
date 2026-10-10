import { lazy, Suspense } from "react";
import { estimateMonacoHeight } from "@/lib/monaco";
import { cn } from "@/lib/utils";

export type MonacoTextViewerProps = {
  value: string;
  path?: string;
  language?: string;
  scope?: string;
  className?: string;
  height?: number | string;
  minHeight?: number;
  maxHeight?: number;
  wrap?: "on" | "off";
  lineNumbers?: "on" | "off";
};

const LazyMonacoTextViewerImpl = lazy(async () => {
  const module = await import("@/components/ui/monaco-text-viewer-impl");
  return { default: module.MonacoTextViewerImpl };
});

function MonacoTextViewerFallback(props: {
  height: number | string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 overflow-hidden bg-surface-base", props.className)}>
      <div
        className="flex items-center justify-center px-3 py-2 text-xs text-text-secondary"
        style={{ height: props.height }}
      >
        正在加载…
      </div>
    </div>
  );
}

export function MonacoTextViewer(props: MonacoTextViewerProps) {
  const resolvedHeight =
    props.height ??
    estimateMonacoHeight(props.value, {
      minHeight: props.minHeight,
      maxHeight: props.maxHeight
    });

  return (
    <Suspense
      fallback={<MonacoTextViewerFallback className={props.className} height={resolvedHeight} />}
    >
      <LazyMonacoTextViewerImpl {...props} height={resolvedHeight} />
    </Suspense>
  );
}
