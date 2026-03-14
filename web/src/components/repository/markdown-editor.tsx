import { useId, useState } from "react";
import { Eye, FileText, PencilLine } from "lucide-react";
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
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(
    defaultExpanded ?? !collapsible
  );
  const expanded = collapsible ? (expandedProp ?? uncontrolledExpanded) : true;
  const hasValue = value.trim().length > 0;
  const nonEmptyLineCount = countNonEmptyLines(value);
  const excerpt = excerptText(value);

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
      <div className={className}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-supporting">
              <FileText className="h-3.5 w-3.5" />
              {label}
            </div>
            <p className="text-body-sm text-text-secondary">
              {collapsedHint ?? placeholder ?? "Click edit to start writing."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 px-4"
            onClick={() => setExpanded(true)}
          >
            <PencilLine className="h-3.5 w-3.5" />
            {enterEditLabel ?? `Edit ${label}`}
          </Button>
        </div>

        {hasValue ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-surface-focus">
                {nonEmptyLineCount} lines
              </Badge>
              <Badge variant="secondary">
                Draft in progress
              </Badge>
            </div>
            <pre className="whitespace-pre-wrap break-words text-body-sm text-text-secondary">
              {excerpt}
            </pre>
          </div>
        ) : (
          <p className="mt-3 text-body-sm text-text-tertiary">点击右侧按钮开始编写</p>
        )}
      </div>
    );
  }

  return (
    <ExpandedMarkdownEditorPanel
      label={label}
      value={value}
      onChange={onChange}
      rows={rows}
      placeholder={placeholder}
      previewEmptyText={previewEmptyText}
      className={className}
      textareaClassName={textareaClassName}
      collapsible={collapsible}
      onCollapse={() => setExpanded(false)}
      collapsedHint={collapsedHint}
      hasValue={hasValue}
      nonEmptyLineCount={nonEmptyLineCount}
    />
  );
}

type ExpandedMarkdownEditorPanelProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
  previewEmptyText?: string;
  className?: string;
  textareaClassName?: string;
  collapsible: boolean;
  onCollapse: () => void;
  collapsedHint?: string;
  hasValue: boolean;
  nonEmptyLineCount: number;
};

function ExpandedMarkdownEditorPanel({
  label,
  value,
  onChange,
  rows,
  placeholder,
  previewEmptyText,
  className,
  textareaClassName,
  collapsible,
  onCollapse,
  collapsedHint,
  hasValue,
  nonEmptyLineCount
}: ExpandedMarkdownEditorPanelProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const textareaId = useId();

  return (
    <div
      className={cn(
        "space-y-4",
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-supporting">
            <PencilLine className="h-3.5 w-3.5" />
            {label}
          </div>
          <p className="text-body-sm text-text-secondary">
            {collapsedHint ?? placeholder ?? "Use markdown to structure the content."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {collapsible ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-3 text-xs text-text-secondary"
              onClick={onCollapse}
            >
              Cancel
            </Button>
          ) : null}
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
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="bg-surface-base">
          {nonEmptyLineCount} lines
        </Badge>
        <Badge variant="outline" className="bg-surface-base">
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
            "min-h-[220px] bg-surface-base shadow-none",
            textareaClassName
          )}
        />
      ) : (
        <div className="min-h-[8rem]">
          <MarkdownBody content={value} emptyText={previewEmptyText} />
        </div>
      )}
    </div>
  );
}
