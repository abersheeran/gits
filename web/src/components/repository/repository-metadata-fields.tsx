import { Checkbox } from "@/components/ui/checkbox";
import { PendingButton } from "@/components/ui/pending-button";
import type { RepositoryUserSummary } from "@/lib/api";

type RepositoryMetadataFieldsProps = {
  canEdit: boolean;
  participants?: RepositoryUserSummary[];
  assigneeIds?: string[];
  onAssigneeIdsChange?: (ids: string[]) => void;
  reviewerIds?: string[];
  onReviewerIdsChange?: (ids: string[]) => void;
  draft?: boolean;
  onDraftChange?: (draft: boolean) => void;
  onSave?: () => void;
  saving?: boolean;
};

function toggleId(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function RepositoryMetadataFields({
  canEdit,
  participants = [],
  assigneeIds = [],
  onAssigneeIdsChange,
  reviewerIds,
  onReviewerIdsChange,
  draft,
  onDraftChange,
  onSave,
  saving = false
}: RepositoryMetadataFieldsProps) {
  const selectedAssignees = participants.filter((participant) => assigneeIds.includes(participant.id));
  const selectedReviewers =
    reviewerIds === undefined
      ? []
      : participants.filter((participant) => reviewerIds.includes(participant.id));

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Assignees</h3>
        {canEdit && onAssigneeIdsChange ? (
          participants.length > 0 ? (
            <div className="space-y-2">
              {participants.map((participant) => (
                <label
                  key={participant.id}
                  className="flex items-center justify-between gap-3 rounded-[18px] bg-surface-focus px-3 py-2"
                >
                  <span className="text-sm">{participant.username}</span>
                  <Checkbox
                    checked={assigneeIds.includes(participant.id)}
                    onCheckedChange={() => onAssigneeIdsChange(toggleId(assigneeIds, participant.id))}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No assignable users.</p>
          )
        ) : selectedAssignees.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {selectedAssignees.map((participant) => participant.username).join(", ")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No assignees.</p>
        )}
      </section>

      {reviewerIds !== undefined ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Reviewers</h3>
          {canEdit && onReviewerIdsChange ? (
            participants.length > 0 ? (
              <div className="space-y-2">
                {participants.map((participant) => (
                  <label
                    key={participant.id}
                    className="flex items-center justify-between gap-3 rounded-[18px] bg-surface-focus px-3 py-2"
                  >
                    <span className="text-sm">{participant.username}</span>
                    <Checkbox
                      checked={reviewerIds.includes(participant.id)}
                      onCheckedChange={() =>
                        onReviewerIdsChange(toggleId(reviewerIds, participant.id))
                      }
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No reviewers available.</p>
            )
          ) : selectedReviewers.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {selectedReviewers.map((participant) => participant.username).join(", ")}
            </p>
          ) : (
          <p className="text-sm text-muted-foreground">No reviewers requested.</p>
          )}
        </section>
      ) : null}

      {draft !== undefined ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Draft</h3>
          {canEdit && onDraftChange ? (
            <label className="flex items-center justify-between rounded-[18px] bg-surface-focus px-3 py-2">
              <span className="text-sm">Keep this pull request as draft</span>
              <Checkbox checked={draft} onCheckedChange={(checked) => onDraftChange(checked === true)} />
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
          pendingText="Saving metadata..."
        >
          Save metadata
        </PendingButton>
      ) : null}
    </div>
  );
}
