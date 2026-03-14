import { Checkbox } from "@/components/ui/checkbox";
import { PendingButton } from "@/components/ui/pending-button";

type RepositoryMetadataFieldsProps = {
  canEdit: boolean;
  draft?: boolean;
  onDraftChange?: (draft: boolean) => void;
  onSave?: () => void;
  saving?: boolean;
};

export function RepositoryMetadataFields({
  canEdit,
  draft,
  onDraftChange,
  onSave,
  saving = false
}: RepositoryMetadataFieldsProps) {
  return (
    <div className="space-y-4">
      {draft !== undefined ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Draft</h3>
          {canEdit && onDraftChange ? (
            <label className="flex items-center justify-between rounded-[12px] bg-surface-focus px-3 py-2">
              <span className="text-sm">Keep this pull request as draft</span>
              <Checkbox
                checked={draft}
                onCheckedChange={(checked) => onDraftChange(checked === true)}
              />
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">{draft ? "Draft" : "Ready for review"}</p>
          )}
        </section>
      ) : null}

      {canEdit && onSave ? (
        <PendingButton
          type="button"
          className="w-full"
          onClick={onSave}
          pending={saving}
          pendingText="Saving..."
        >
          Save
        </PendingButton>
      ) : null}
    </div>
  );
}
