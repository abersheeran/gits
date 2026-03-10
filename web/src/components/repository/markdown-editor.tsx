import { useEffect, useId, useState } from "react";
import { Eye, FileText, PencilLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MarkdownBody } from "@/components/repository/markdown-body";
import { cn } from "@/lib/utils";

type MarkdownEditorProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  previewEmptyText?: string;
  className?: string;
  textareaClassName?: string;
  collapsible?: boolean;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  enterEditLabel?: string;
  collapsedHint?: string;
};

function countNonEmptyLines(value: string): number {
  return value.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function excerptText(value: string): string {
  const excerpt = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
  return excerpt;
}

export function MarkdownEditor({
  label,
  value,
  onChange,
  rows = 8,
  placeholder,
  previewEmptyText,
  className,
  textareaClassName,
  collapsible = false,
  expanded: expandedProp,
  defaultExpanded,
  onExpandedChange,
  enterEditLabel,
  collapsedHint
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(
    defaultExpanded ?? !collapsible
  );
  const textareaId = useId();
  const expanded = collapsible ? (expandedProp ?? uncontrolledExpanded) : true;
  const hasValue = value.trim().length > 0;
  const nonEmptyLineCount = countNonEmptyLines(value);
  const excerpt = excerptText(value);

  useEffect(() => {
    if (!expanded) {
      setMode("write");
    }
  }, [expanded]);

  function setExpanded(nextExpanded: boolean) {
    if (!collapsible) {
      return;
    }
    if (expandedProp === undefined) {
      setUncontrolledExpanded(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  }

  if (!expanded) {
    return (
      <div
        className={cn(
          "rounded-xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-slate-100/70 p-3 shadow-sm",
          className
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <FileText className="h-3.5 w-3.5" />
              {label}
            </div>
            <p className="text-sm leading-6 text-slate-600">
              {collapsedHint ?? placeholder ?? "Click edit to start writing."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-slate-200 bg-white px-3 shadow-sm"
            onClick={() => setExpanded(true)}
          >
            <PencilLine className="h-3.5 w-3.5" />
            {enterEditLabel ?? `Edit ${label}`}
          </Button>
        </div>

        <div className="mt-3 rounded-lg border border-white/80 bg-white/90 p-3 shadow-inner shadow-slate-200/40">
          {hasValue ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                >
                  {nonEmptyLineCount} lines
                </Badge>
                <Badge
                  variant="outline"
                  className="rounded-full border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700"
                >
                  Draft in progress
                </Badge>
              </div>
              <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                {excerpt}
              </pre>
            </div>
          ) : (
            <div className="flex min-h-[120px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5 text-center">
              <Sparkles className="h-4 w-4 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700">编辑器当前收起</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                点击右侧按钮后，才会显示编辑器和 Write / Preview 切换。
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
      <div
        className={cn(
          "space-y-4 rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm",
          className
        )}
      >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <PencilLine className="h-3.5 w-3.5" />
            {label}
          </div>
          <p className="text-sm leading-6 text-slate-600">
            {collapsedHint ?? placeholder ?? "Use markdown to structure the content."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {collapsible ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 rounded-md px-3 text-xs text-slate-500"
              onClick={() => setExpanded(false)}
            >
              Cancel
            </Button>
          ) : null}
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
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
        >
          {nonEmptyLineCount} lines
        </Badge>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
        >
          {hasValue ? "Draft present" : "Empty draft"}
        </Badge>
      </div>

      {mode === "write" ? (
        <Textarea
          id={textareaId}
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={cn(
            "rounded-lg border-slate-200 bg-white/95 px-3 py-3 text-sm leading-7 shadow-inner shadow-slate-200/40 focus-visible:ring-slate-400",
            textareaClassName
          )}
        />
      ) : (
        <div className="min-h-[8rem] rounded-lg border border-slate-200 bg-white/95 px-3 py-3 shadow-inner shadow-slate-200/40">
          <MarkdownBody content={value} emptyText={previewEmptyText} />
        </div>
      )}
    </div>
  );
}
