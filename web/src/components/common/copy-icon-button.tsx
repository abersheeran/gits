import { Check, Copy } from "lucide-react";
import { useCopy } from "@/hooks/use-copy";
import { IconButton } from "./icon-button";

export function CopyIconButton({
  value,
  label,
  className
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { state, copy } = useCopy(value);
  const feedback = state === "copied" ? "已复制" : state === "failed" ? "复制失败，请重试" : label;
  return (
    <>
      <IconButton label={feedback} onClick={() => void copy()} className={className}>
        {state === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </IconButton>
      <span className="sr-only" role="status">
        {state === "idle" ? "" : feedback}
      </span>
    </>
  );
}
