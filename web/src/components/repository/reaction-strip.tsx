import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactionContent, ReactionSummary } from "@/lib/api";

const REACTION_META: Record<ReactionContent, { emoji: string; label: string }> = {
  "+1": { emoji: "👍", label: "Thumbs up" },
  "-1": { emoji: "👎", label: "Thumbs down" },
  laugh: { emoji: "😄", label: "Laugh" },
  hooray: { emoji: "🎉", label: "Hooray" },
  confused: { emoji: "😕", label: "Confused" },
  heart: { emoji: "❤️", label: "Heart" },
  rocket: { emoji: "🚀", label: "Rocket" },
  eyes: { emoji: "👀", label: "Eyes" }
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
      {orderedReactions.map((reaction) => {
        const meta = REACTION_META[reaction.content];
        const reactionCountLabel = `${reaction.count} reaction${reaction.count === 1 ? "" : "s"}`;
        return (
          <Button
            key={reaction.content}
            type="button"
            size="sm"
            variant={reaction.viewer_reacted ? "secondary" : "outline"}
            className="h-7 rounded-full px-2 text-xs"
            disabled={disabled || !onToggle}
            title={meta.label}
            aria-label={`${meta.label}, ${reactionCountLabel}${
              reaction.viewer_reacted ? ", selected" : ""
            }`}
            onClick={() => onToggle?.(reaction.content, reaction.viewer_reacted)}
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {meta.emoji}
            </span>
            <span className="tabular-nums">{reaction.count}</span>
          </Button>
        );
      })}
      {onToggle
        ? (Object.keys(REACTION_META) as ReactionContent[])
            .filter((content) => !orderedReactions.some((reaction) => reaction.content === content))
            .map((content) => {
              const meta = REACTION_META[content];
              return (
                <Button
                  key={content}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full px-2 text-xs text-muted-foreground"
                  disabled={disabled}
                  title={meta.label}
                  aria-label={`Add ${meta.label} reaction`}
                  onClick={() => onToggle(content, false)}
                >
                  <span aria-hidden="true" className="text-sm leading-none">
                    {meta.emoji}
                  </span>
                </Button>
              );
            })
        : null}
    </div>
  );
}
