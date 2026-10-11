import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { IconButton } from "./icon-button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
export function HelpTip({ label, children }: { label: string; children?: ReactNode }) {
  if (!children)
    return (
      <IconButton label={label}>
        <CircleHelp className="size-4" />
      </IconButton>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={label}>
          <CircleHelp className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}
