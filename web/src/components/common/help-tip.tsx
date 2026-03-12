import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type HelpTipProps = {
  content: ReactNode;
  label?: string;
  className?: string;
};

export function HelpTip({
  content,
  label = "查看说明",
  className
}: HelpTipProps) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-full border border-border-subtle bg-surface-base text-text-supporting transition-colors duration-100 ease-in-out hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
              className
            )}
          >
            <CircleHelp className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="max-w-64 text-balance">{content}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
