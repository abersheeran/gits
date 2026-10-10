import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopy } from "@/hooks/use-copy";
import { shortOid } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ShaCopyButton({ oid, className }: { oid: string; className?: string }) {
  const { state, copy } = useCopy(oid);
  const label =
    state === "copied" ? "已复制" : state === "failed" ? "复制失败，请重试" : "复制完整 SHA";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${label} ${oid}`}
          onClick={() => void copy()}
          className={cn(
            "relative shrink-0 px-2 font-mono text-[13px] font-normal text-text-secondary hover:text-text-primary",
            className
          )}
        >
          <span className={state === "copied" ? "invisible" : undefined}>{shortOid(oid)}</span>
          {state === "copied" && <Check aria-hidden="true" className="absolute h-4 w-4" />}
          <span className="sr-only" role="status">
            {state === "idle" ? "" : label}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
