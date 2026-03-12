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

function maskSensitiveConfigPreview(value: string): string {
  return value
    .replace(
      /((?:^|[{\s,])["']?(?:authorization|token|api[_-]?key|secret|password)["']?\s*[:=]\s*["'])([^"'`\n]+)(["'])/gim,
      (_, prefix: string, secret: string, suffix: string) => `${prefix}${maskSecret(secret)}${suffix}`
    )
    .replace(/\b(Bearer\s+)([^\s"',}]+)/gim, (_, prefix: string, secret: string) => `${prefix}${maskSecret(secret)}`)
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/g, (secret: string) => maskSecret(secret));
}

function maskSecret(secret: string): string {
  const trimmedSecret = secret.trim();
  const bearerMatch = trimmedSecret.match(/^(Bearer\s+).+$/i);
  if (bearerMatch) {
    return `${bearerMatch[1]}[masked]`;
  }
  return "[masked]";
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
  emptyDescription = "编辑后可保存对应的配置文件内容。"
}: CodeConfigPanelProps) {
  const hasValue = value.trim().length > 0;
  const lineCount = countLines(value);
  const previewValue = maskSensitiveConfigPreview(value);
  const previewIsMasked = previewValue !== value;

  return (
    <section
      className={cn(
        "panel-inset",
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-label-xs text-text-supporting">
            <FileCog className="h-3.5 w-3.5" />
            {title}
          </div>
          {description ? <p className="text-body-sm leading-6 text-text-secondary">{description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {statusText ? (
            <Badge
              variant="outline"
              className="border-border-subtle bg-surface-focus px-3 py-1 text-label-xs text-text-primary"
            >
              {statusText}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className="border-border-subtle bg-surface-focus px-3 py-1 text-label-xs text-text-secondary"
          >
            {hasValue ? `${lineCount} lines` : "Empty"}
          </Badge>
        </div>
      </div>

      <div className="mt-3 panel-card-compact">
        {editing ? (
          <div className="space-y-3">
            <Label className="text-body-sm text-text-primary">{label}</Label>
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
              className="overflow-x-auto whitespace-pre rounded-[16px] bg-surface-canvas px-3 py-3 font-mono text-code-sm leading-6 shadow-none"
              style={style}
            />
          </div>
        ) : hasValue ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-label-xs text-text-supporting">
                <Braces className="h-3.5 w-3.5" />
                Read-only preview
              </div>
              {previewIsMasked ? (
                <span className="text-label-xs text-text-supporting">Sensitive values masked</span>
              ) : null}
            </div>
            <pre
              className="max-h-[20rem] overflow-auto whitespace-pre rounded-[16px] bg-surface-canvas px-3 py-3 text-code-sm leading-6 text-text-primary"
              style={style}
            >
              {previewValue}
            </pre>
          </div>
        ) : (
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[20px] border border-dashed border-border-subtle bg-surface-base px-4 py-6 text-center">
            <Sparkles className="h-4 w-4 text-text-supporting" />
            <p className="mt-3 text-body-sm font-medium text-text-primary">{emptyTitle}</p>
            <p className="mt-1 max-w-md text-body-sm leading-6 text-text-secondary">{emptyDescription}</p>
          </div>
        )}
      </div>
    </section>
  );
}
