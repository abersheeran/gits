import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactionContent, ReactionSummary } from "@/lib/api";

const REACTION_LABELS: Record<ReactionContent, string> = {
  "+1": "+1",
  "-1": "-1",
  laugh: "laugh",
  hooray: "hooray",
  confused: "confused",
  heart: "heart",
  rocket: "rocket",
  eyes: "eyes"
};

type ReactionStripProps = {
  reactions: ReactionSummary[];
  disabled?: boolean;
  className?: string;
  onToggle?: (content: ReactionContent, viewerReacted: boolean) => void;
};

export function ReactionStrip({
  reactions,
  disabled = false,
  className,
  onToggle
}: ReactionStripProps) {
  if (reactions.length === 0 && !onToggle) {
    return null;
  }

  const orderedReactions = reactions.slice().sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.content.localeCompare(right.content);
  });

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {orderedReactions.map((reaction) => (
        <Button
          key={reaction.content}
          type="button"
          size="sm"
          variant={reaction.viewer_reacted ? "secondary" : "outline"}
          className="h-7 rounded-full px-2 text-xs"
          disabled={disabled || !onToggle}
          onClick={() => onToggle?.(reaction.content, reaction.viewer_reacted)}
        >
          <span>{REACTION_LABELS[reaction.content]}</span>
          <span>{reaction.count}</span>
        </Button>
      ))}
      {onToggle
        ? (Object.keys(REACTION_LABELS) as ReactionContent[])
            .filter((content) => !orderedReactions.some((reaction) => reaction.content === content))
            .map((content) => (
              <Button
                key={content}
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 rounded-full px-2 text-xs text-muted-foreground"
                disabled={disabled}
                onClick={() => onToggle(content, false)}
              >
                <span>{REACTION_LABELS[content]}</span>
              </Button>
            ))
        : null}
    </div>
  );
}
