import { MessageSquarePlus } from "lucide-react";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PendingButton } from "@/components/ui/pending-button";
import { Textarea } from "@/components/ui/textarea";
import type { PullRequestReviewThreadSide } from "@/lib/api";

type PullRequestInlineThreadComposerProps = {
  selectedLabel: string;
  compareLabel: string;
  hunkHeader: string | null;
  side: PullRequestReviewThreadSide;
  lineCount: number;
  supportsSuggestion: boolean;
  body: string;
  onBodyChange: (value: string) => void;
  suggestedCode: string;
  onSuggestedCodeChange: (value: string) => void;
  onClearSelection: () => void;
  onDiscardDraft: () => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
};

function pluralizeLines(count: number): string {
  return `${count} line${count === 1 ? "" : "s"}`;
}

export function PullRequestInlineThreadComposer({
  selectedLabel,
  compareLabel,
  hunkHeader,
  side,
  lineCount,
  supportsSuggestion,
  body,
  onBodyChange,
  suggestedCode,
  onSuggestedCodeChange,
  onClearSelection,
  onDiscardDraft,
  onSubmit,
  submitting,
  disabled
}: PullRequestInlineThreadComposerProps) {
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <MessageSquarePlus className="h-4 w-4 text-[#0969da]" />
              Draft review thread
            </span>
            <Badge variant="outline">{side === "head" ? "Head side" : "Base side"}</Badge>
            <Badge variant="secondary">{pluralizeLines(lineCount)}</Badge>
          </div>
          <p className="truncate font-mono text-xs text-foreground">{selectedLabel}</p>
          <p className="text-xs text-muted-foreground">
            {compareLabel}
            {hunkHeader ? ` · ${hunkHeader}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
            Clear selection
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onDiscardDraft}>
            Discard draft
          </Button>
        </div>
      </div>

      <MarkdownEditor
        label="Thread body"
        value={body}
        onChange={onBodyChange}
        rows={4}
        placeholder="Describe the requested change for this selected diff range"
        previewEmptyText="Nothing to preview."
      />

      <div className="space-y-2">
        <Label htmlFor="inline-review-thread-suggested-code">Suggested change</Label>
        <Textarea
          id="inline-review-thread-suggested-code"
          value={suggestedCode}
          onChange={(event) => onSuggestedCodeChange(event.target.value)}
          rows={5}
          disabled={!supportsSuggestion}
          placeholder={
            supportsSuggestion
              ? "Optional replacement code for the selected head-side range"
              : "Suggested changes are only available for head-side ranges"
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <PendingButton
          onClick={onSubmit}
          pending={submitting}
          disabled={disabled}
          pendingText="Creating thread..."
        >
          Create review thread
        </PendingButton>
      </div>
    </div>
  );
}
