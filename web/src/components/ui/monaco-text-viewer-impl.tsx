import Editor from "@monaco-editor/react";
import type { MonacoTextViewerProps } from "@/components/ui/monaco-text-viewer";
import { buildMonacoModelPath, guessMonacoLanguage, monacoViewerFontFamily } from "@/lib/monaco";
import { configureMonaco } from "@/lib/monaco-runtime";
import { cn } from "@/lib/utils";

export function MonacoTextViewerImpl({
  value,
  path,
  language,
  scope = "viewer",
  className,
  height,
  wrap = "off",
  lineNumbers = "on"
}: MonacoTextViewerProps) {
  const resolvedLanguage = language ?? guessMonacoLanguage(path);

  return (
    <div className={cn("overflow-hidden rounded-md border bg-background", className)}>
      <Editor
        value={value}
        language={resolvedLanguage}
        path={path ? buildMonacoModelPath(path, scope) : undefined}
        theme="gits-light"
        height={height}
        loading={<div className="px-3 py-2 text-xs text-muted-foreground">Loading editor…</div>}
        beforeMount={configureMonaco}
        options={{
          automaticLayout: true,
          contextmenu: true,
          domReadOnly: true,
          folding: false,
          fontFamily: monacoViewerFontFamily(),
          fontSize: 12,
          glyphMargin: false,
          lineHeight: 20,
          lineNumbers,
          lineNumbersMinChars: lineNumbers === "on" ? 4 : 0,
          minimap: { enabled: false },
          occurrencesHighlight: "off",
          overviewRulerBorder: false,
          padding: {
            top: 8,
            bottom: 8
          },
          readOnly: true,
          renderLineHighlight: "none",
          renderWhitespace: "selection",
          scrollBeyondLastLine: false,
          scrollbar: {
            alwaysConsumeMouseWheel: false,
            horizontalScrollbarSize: 10,
            verticalScrollbarSize: 10
          },
          selectionHighlight: false,
          stickyScroll: {
            enabled: false
          },
          wordWrap: wrap
        }}
      />
    </div>
  );
}
