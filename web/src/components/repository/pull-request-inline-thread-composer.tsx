import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import type { PullRequestReviewThreadSide } from "@/lib/api";

type PullRequestInlineThreadComposerProps = {
  selectedLabel: string;
  compareLabel: string;
  hunkHeader: string | null;
  side: PullRequestReviewThreadSide;
  lineCount: number;
  body: string;
  onBodyChange: (value: string) => void;
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
  body,
  onBodyChange,
  onClearSelection,
  onDiscardDraft,
  onSubmit,
  submitting,
  disabled
}: PullRequestInlineThreadComposerProps) {
  const hasDraft = body.trim().length > 0;
  const [editing, setEditing] = useState(hasDraft);
  const expanded = editing || hasDraft;

  function handleDiscardDraft() {
    onDiscardDraft();
    setEditing(false);
  }

  return (
    <div className="panel-card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <MessageSquarePlus className="h-4 w-4 text-text-supportingStrong" />
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
          <Button type="button" variant="outline" size="sm" onClick={handleDiscardDraft}>
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
        collapsible
        expanded={expanded}
        onExpandedChange={setEditing}
        enterEditLabel="Write thread comment"
        collapsedHint="编写这条 review thread。"
      />

      {expanded ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
