import { Checkbox } from "@/components/ui/checkbox";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type {
  RepositoryLabelRecord,
  RepositoryMilestoneRecord,
  RepositoryUserSummary
} from "@/lib/api";
import { RepositoryLabelChip } from "./repository-label-chip";

type RepositoryMetadataFieldsProps = {
  canEdit: boolean;
  labels: RepositoryLabelRecord[];
  selectedLabelIds: string[];
  onSelectedLabelIdsChange?: (ids: string[]) => void;
  participants?: RepositoryUserSummary[];
  assigneeIds?: string[];
  onAssigneeIdsChange?: (ids: string[]) => void;
  reviewerIds?: string[];
  onReviewerIdsChange?: (ids: string[]) => void;
  milestones?: RepositoryMilestoneRecord[];
  milestoneId?: string | null;
  onMilestoneIdChange?: (id: string | null) => void;
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
  labels,
  selectedLabelIds,
  onSelectedLabelIdsChange,
  participants = [],
  assigneeIds = [],
  onAssigneeIdsChange,
  reviewerIds,
  onReviewerIdsChange,
  milestones = [],
  milestoneId = null,
  onMilestoneIdChange,
  draft,
  onDraftChange,
  onSave,
  saving = false
}: RepositoryMetadataFieldsProps) {
  const selectedLabels = labels.filter((label) => selectedLabelIds.includes(label.id));
  const selectedAssignees = participants.filter((participant) => assigneeIds.includes(participant.id));
  const selectedReviewers =
    reviewerIds === undefined
      ? []
      : participants.filter((participant) => reviewerIds.includes(participant.id));
  const selectedMilestone = milestones.find((milestone) => milestone.id === milestoneId) ?? null;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Labels</h3>
        {canEdit && onSelectedLabelIdsChange ? (
          labels.length > 0 ? (
            <div className="space-y-2">
              {labels.map((label) => (
                <label key={label.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <Checkbox
                    checked={selectedLabelIds.includes(label.id)}
                    onCheckedChange={() => onSelectedLabelIdsChange(toggleId(selectedLabelIds, label.id))}
                  />
                  <RepositoryLabelChip label={label} />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No labels configured.</p>
          )
        ) : selectedLabels.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedLabels.map((label) => (
              <RepositoryLabelChip key={label.id} label={label} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No labels.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Assignees</h3>
        {canEdit && onAssigneeIdsChange ? (
          participants.length > 0 ? (
            <div className="space-y-2">
              {participants.map((participant) => (
                <label
                  key={participant.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
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
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
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

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Milestone</h3>
        {canEdit && onMilestoneIdChange ? (
          milestones.length > 0 ? (
            <Select
              value={milestoneId ?? "none"}
              onValueChange={(value) => onMilestoneIdChange(value === "none" ? null : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No milestone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No milestone</SelectItem>
                {milestones.map((milestone) => (
                  <SelectItem key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">No milestones configured.</p>
          )
        ) : selectedMilestone ? (
          <div className="rounded-md border px-3 py-2">
            <p className="text-sm font-medium">{selectedMilestone.title}</p>
            {selectedMilestone.description ? (
              <p className="mt-1 text-xs text-muted-foreground">{selectedMilestone.description}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No milestone.</p>
        )}
      </section>

      {draft !== undefined ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Draft</h3>
          {canEdit && onDraftChange ? (
            <label className="flex items-center justify-between rounded-md border px-3 py-2">
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
