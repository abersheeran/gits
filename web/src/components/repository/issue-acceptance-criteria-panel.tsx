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
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/80 bg-white shadow-sm">
        <Sparkles className="h-5 w-5 text-slate-400" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{description}</p>
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
    <section className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-sky-50/80 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-sky-100/80 via-white to-emerald-100/70" />
      <div className="relative space-y-4 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm backdrop-blur">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              Delivery contract
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                Acceptance criteria
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                让 Issue 里始终保留一份稳定的完成定义，供 Agent 交付和人类验收对照。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className="rounded-full border-white/80 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm"
            >
              Stable definition
            </Badge>
            {canUpdate && editing ? (
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium shadow-sm",
                  draftIsSynced
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                )}
              >
                {draftIsSynced ? "Saved copy is current" : "Draft changed"}
              </Badge>
            ) : null}
            {canUpdate && !editing ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-full border-white/80 bg-white/85 px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-white"
                onClick={startEditing}
              >
                <PencilLine className="h-3.5 w-3.5" />
                Edit
              </Button>
            ) : null}
          </div>
        </div>

        <div className={cn("grid gap-4", canUpdate && editing ? "xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]" : "")}>
          <div className="rounded-xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                  <FileText className="h-3.5 w-3.5" />
                  Current definition
                </div>
                <h3 className="text-sm font-semibold text-slate-950">当前生效标准</h3>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium",
                  hasContent
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-100 text-slate-600"
                )}
              >
                {hasContent ? "Ready for review" : "Waiting for definition"}
              </Badge>
            </div>
            <div className="mt-3 rounded-lg border border-white/80 bg-white/95 p-3 shadow-inner shadow-slate-200/40">
              {hasContent ? (
                <MarkdownBody content={content} emptyText="(no acceptance criteria)" />
              ) : (
                <EmptyState
                  title="还没有验收标准"
                  description="建议补充可验证结果、关键命令和需要回看的产物，让交付边界更稳定。"
                />
              )}
            </div>
            {canUpdate && !editing ? (
              <div className="mt-4 flex flex-col gap-3 border-t border-slate-200/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-slate-500">
                  仅在进入编辑状态后显示草稿编辑器和预览切换。
                </p>
                <Button
                  type="button"
                  className="h-9 rounded-lg bg-slate-950 px-3.5 text-white shadow-sm hover:bg-slate-800"
                  onClick={startEditing}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  编辑验收标准
                </Button>
              </div>
            ) : null}
          </div>

          {canUpdate && editing ? (
            <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    <PencilLine className="h-3.5 w-3.5" />
                    Edit surface
                  </div>
                  <h3 className="text-sm font-semibold text-slate-950">Refine acceptance criteria</h3>
                </div>
                <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "write" ? "secondary" : "ghost"}
                    className={cn(
                      "h-8 rounded-md px-3 text-xs",
                      mode === "write" ? "shadow-sm" : "text-slate-500"
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
                      "h-8 rounded-md px-3 text-xs",
                      mode === "preview" ? "shadow-sm" : "text-slate-500"
                    )}
                    onClick={() => setMode("preview")}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                >
                  {formatCount(lineCount, "line")}
                </Badge>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                >
                  {formatCount(checklistItemCount, "checklist item")}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-medium",
                    draftIsSynced
                      ? "border-slate-200 bg-slate-100 text-slate-600"
                      : "border-sky-200 bg-sky-50 text-sky-700"
                  )}
                >
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
                    className="min-h-[280px] rounded-lg border-slate-200 bg-white/95 px-3 py-3 text-sm leading-7 shadow-inner shadow-slate-200/40 focus-visible:ring-slate-400"
                  />
                ) : (
                  <div className="min-h-[280px] rounded-lg border border-slate-200 bg-white/95 px-3 py-3 shadow-inner shadow-slate-200/40">
                    {hasDraft ? (
                      <MarkdownBody content={draft} emptyText="暂无验收标准。" />
                    ) : (
                      <EmptyState
                        title="预览区域为空"
                        description="切回 Write 模式输入内容后，这里会显示最终渲染结果。"
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-xs leading-5 text-slate-500">
                  建议把通过条件、验证命令、预期结果和关键产物都写清楚。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-lg border-slate-200 bg-white px-3.5"
                    disabled={saving}
                    onClick={cancelEditing}
                  >
                    Cancel
                  </Button>
                  <PendingButton
                    pending={saving}
                    pendingText="Saving acceptance criteria..."
                    disabled={draftIsSynced}
                    className="h-10 rounded-lg bg-slate-950 px-4 text-white shadow-sm hover:bg-slate-800"
                    onClick={onSave}
                  >
                    保存验收标准
                  </PendingButton>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
