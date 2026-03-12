import { useState } from "react";
import { CheckCircle2, Eye, FileText, PencilLine, Sparkles } from "lucide-react";
import { MarkdownBody } from "@/components/repository/markdown-body";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type IssueAcceptanceCriteriaPanelProps = {
  canUpdate: boolean;
  content: string;
  draft: string;
  onDraftChange: (value: string) => void;
  saving: boolean;
  onSave: () => void;
};

function countNonEmptyLines(value: string): number {
  return value.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function countChecklistItems(value: string): number {
  return value.split(/\r?\n/).filter((line) => /^\s*(?:[-*+]|\d+\.)\s+/.test(line)).length;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[20px] border border-dashed border-border-subtle bg-surface-focus px-4 py-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-border-subtle bg-surface-base shadow-container">
        <Sparkles className="h-5 w-5 text-text-tertiary" />
      </div>
      <p className="mt-4 text-body-sm font-semibold text-text-primary">{title}</p>
      <p className="mt-2 max-w-sm text-body-sm text-text-secondary">{description}</p>
    </div>
  );
}

export function IssueAcceptanceCriteriaPanel({
  canUpdate,
  content,
  draft,
  onDraftChange,
  saving,
  onSave
}: IssueAcceptanceCriteriaPanelProps) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const hasContent = content.trim().length > 0;
  const hasDraft = draft.trim().length > 0;
  const draftIsSynced = draft === content;
  const lineCount = countNonEmptyLines(draft);
  const checklistItemCount = countChecklistItems(draft);

  function startEditing() {
    setMode("write");
    setEditing(true);
  }

  function cancelEditing() {
    onDraftChange(content);
    setMode("write");
    setEditing(false);
  }

  return (
    <section className="page-panel overflow-hidden">
      <div className="border-b border-border-subtle bg-surface-focus px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-base px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-supporting shadow-container">
              <CheckCircle2 className="h-3.5 w-3.5 text-text-supportingStrong" />
              Delivery contract
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-heading-3-16-semibold text-text-primary">
                Acceptance criteria
              </h2>
              <p className="max-w-2xl text-body-sm text-text-secondary">
                让 Issue 里始终保留一份稳定的完成定义，供 Agent 交付和人类验收对照。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="bg-surface-base">
              Stable definition
            </Badge>
            {canUpdate && editing ? (
              <Badge variant={draftIsSynced ? "outline" : "secondary"} className="bg-surface-base">
                {draftIsSynced ? "Saved copy is current" : "Draft changed"}
              </Badge>
            ) : null}
            {canUpdate && !editing ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 px-4"
                onClick={startEditing}
              >
                <PencilLine className="h-3.5 w-3.5" />
                Edit
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 md:p-5">
        <div className="grid gap-4">
          {canUpdate && editing ? (
            <div className="panel-inset">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-supporting">
                    <PencilLine className="h-3.5 w-3.5" />
                    Edit surface
                  </div>
                  <h3 className="text-body-sm font-semibold text-text-primary">
                    Refine acceptance criteria
                  </h3>
                </div>
                <div className="inline-flex items-center rounded-full bg-surface-base p-1 shadow-container">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "write" ? "secondary" : "ghost"}
                    className={cn(
                      "h-8 rounded-full px-3 text-xs",
                      mode === "write" ? "shadow-sm" : "text-text-secondary"
                    )}
                    onClick={() => setMode("write")}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    Write
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "preview" ? "secondary" : "ghost"}
                    className={cn(
                      "h-8 rounded-full px-3 text-xs",
                      mode === "preview" ? "shadow-sm" : "text-text-secondary"
                    )}
                    onClick={() => setMode("preview")}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-surface-base">
                  {formatCount(lineCount, "line")}
                </Badge>
                <Badge variant="outline" className="bg-surface-base">
                  {formatCount(checklistItemCount, "checklist item")}
                </Badge>
                <Badge variant={draftIsSynced ? "outline" : "secondary"} className="bg-surface-base">
                  {draftIsSynced ? "No local changes" : "Unsaved draft"}
                </Badge>
              </div>

              <div className="mt-4">
                {mode === "write" ? (
                  <Textarea
                    aria-label="Edit acceptance criteria"
                    value={draft}
                    onChange={(event) => onDraftChange(event.target.value)}
                    rows={10}
                    className="min-h-[280px] bg-surface-base shadow-none"
                  />
                ) : (
                  <div className="panel-card min-h-[280px]">
                    {hasDraft ? (
                      <MarkdownBody content={draft} emptyText="暂无验收标准。" />
                    ) : (
                      <EmptyState
                        title="预览区域为空"
                        description="添加验收标准以生成预览。"
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-xs leading-5 text-text-secondary">
                  建议把通过条件、验证命令、预期结果和关键产物都写清楚。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-4"
                    disabled={saving}
                    onClick={cancelEditing}
                  >
                    Cancel
                  </Button>
                  <PendingButton
                    pending={saving}
                    pendingText="Saving acceptance criteria..."
                    disabled={draftIsSynced}
                    className="h-10 px-4"
                    onClick={onSave}
                  >
                    保存验收标准
                  </PendingButton>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel-inset">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-supporting">
                    <FileText className="h-3.5 w-3.5" />
                    Current definition
                  </div>
                  <h3 className="text-body-sm font-semibold text-text-primary">当前生效标准</h3>
                </div>
                <Badge variant={hasContent ? "secondary" : "outline"} className="bg-surface-base">
                  {hasContent ? "Ready for review" : "Waiting for definition"}
                </Badge>
              </div>
              <div className="mt-3 panel-card-compact">
                {hasContent ? (
                  <MarkdownBody content={content} emptyText="(no acceptance criteria)" />
                ) : (
                  <EmptyState
                    title="还没有验收标准"
                    description="建议补充可验证结果、关键命令和需要回看的产物，让交付边界更稳定。"
                  />
                )}
              </div>
              {canUpdate ? (
                <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-text-secondary">需要时更新验收标准并预览 Markdown。</p>
                  <Button
                    type="button"
                    className="h-9 px-4"
                    onClick={startEditing}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    编辑验收标准
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
