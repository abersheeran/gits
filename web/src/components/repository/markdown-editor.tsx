import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
};

export function MarkdownEditor({
  label,
  value,
  onChange,
  rows = 8,
  placeholder,
  previewEmptyText,
  className,
  textareaClassName
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const textareaId = useId();

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={textareaId}>{label}</Label>
        <div className="inline-flex items-center rounded-md border bg-muted/30 p-0.5">
          <Button
            type="button"
            size="sm"
            variant={mode === "write" ? "secondary" : "ghost"}
            className="h-7"
            onClick={() => setMode("write")}
          >
            Write
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "preview" ? "secondary" : "ghost"}
            className="h-7"
            onClick={() => setMode("preview")}
          >
            Preview
          </Button>
        </div>
      </div>
      {mode === "write" ? (
        <Textarea
          id={textareaId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={textareaClassName}
        />
      ) : (
        <div className="min-h-[8rem] rounded-md border bg-background px-4 py-3">
          <MarkdownBody content={value} emptyText={previewEmptyText} />
        </div>
      )}
    </div>
  );
}
