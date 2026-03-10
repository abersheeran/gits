import type { CSSProperties } from "react";
import { Braces, FileCog, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type CodeConfigPanelProps = {
  title: string;
  description?: string;
  label: string;
  value: string;
  editing: boolean;
  onChange?: (value: string) => void;
  rows?: number;
  style?: CSSProperties;
  className?: string;
  statusText?: string;
  emptyTitle?: string;
  emptyDescription?: string;
};

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.split(/\r?\n/).length;
}

export function CodeConfigPanel({
  title,
  description,
  label,
  value,
  editing,
  onChange,
  rows = 10,
  style,
  className,
  statusText,
  emptyTitle = "还没有配置内容",
  emptyDescription = "进入编辑状态后，这里可以填写并保存对应的配置文件。"
}: CodeConfigPanelProps) {
  const hasValue = value.trim().length > 0;
  const lineCount = countLines(value);

  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm",
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <FileCog className="h-3.5 w-3.5" />
            {title}
          </div>
          {description ? <p className="text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {statusText ? (
            <Badge
              variant="outline"
              className="rounded-full border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700"
            >
              {statusText}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className="rounded-full border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
          >
            {hasValue ? `${lineCount} lines` : "Empty"}
          </Badge>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-inner shadow-slate-200/40">
        {editing ? (
          <div className="space-y-3">
            <Label className="text-sm font-medium text-slate-700">{label}</Label>
            <Textarea
              aria-label={label}
              value={value}
              onChange={(event) => onChange?.(event.target.value)}
              rows={rows}
              wrap="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              className="overflow-x-auto whitespace-pre rounded-lg border-slate-200 bg-slate-950/[0.02] px-3 py-3 font-mono text-xs leading-5 shadow-inner shadow-slate-200/40 focus-visible:ring-slate-400"
              style={style}
            />
          </div>
        ) : hasValue ? (
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
              <Braces className="h-3.5 w-3.5" />
              Read-only preview
            </div>
            <pre
              className="max-h-[20rem] overflow-auto whitespace-pre text-xs leading-6 text-slate-700"
              style={style}
            >
              {value}
            </pre>
          </div>
        ) : (
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center">
            <Sparkles className="h-4 w-4 text-slate-400" />
            <p className="mt-3 text-sm font-medium text-slate-700">{emptyTitle}</p>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{emptyDescription}</p>
          </div>
        )}
      </div>
    </section>
  );
}
