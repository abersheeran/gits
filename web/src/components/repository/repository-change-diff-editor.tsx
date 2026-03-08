import { DiffEditor, type Monaco } from "@monaco-editor/react";
import { useEffect, useRef, type MutableRefObject } from "react";
import type { IDisposable, editor as MonacoEditor } from "monaco-editor";
import type {
  RepositoryDiffLineDecoration,
  RepositoryDiffLineTarget
} from "@/components/repository/repository-diff-view";
import { buildMonacoModelPath, guessMonacoLanguage, monacoViewerFontFamily } from "@/lib/monaco";
import { configureMonaco } from "@/lib/monaco-runtime";
import type { RepositoryCompareChange } from "@/lib/api";

type RepositoryChangeDiffEditorProps = {
  change: RepositoryCompareChange;
  height: number;
  onDiffLineClick?: (target: RepositoryDiffLineTarget) => void;
  isDiffLineSelected?: (target: RepositoryDiffLineTarget) => boolean;
  lineDecorations?: RepositoryDiffLineDecoration[];
};

type ChangeLineIndex = {
  baseTargets: Map<number, RepositoryDiffLineTarget>;
  headTargets: Map<number, RepositoryDiffLineTarget>;
  allTargets: RepositoryDiffLineTarget[];
};

function buildChangeLineIndex(change: RepositoryCompareChange): ChangeLineIndex {
  const baseTargets = new Map<number, RepositoryDiffLineTarget>();
  const headTargets = new Map<number, RepositoryDiffLineTarget>();
  const allTargets: RepositoryDiffLineTarget[] = [];

  for (const hunk of change.hunks) {
    for (const line of hunk.lines) {
      if (line.oldLineNumber !== null) {
        const target = {
          change,
          hunk,
          line,
          side: "base" as const,
          lineNumber: line.oldLineNumber
        };
        baseTargets.set(line.oldLineNumber, target);
        allTargets.push(target);
      }

      if (line.newLineNumber !== null) {
        const target = {
          change,
          hunk,
          line,
          side: "head" as const,
          lineNumber: line.newLineNumber
        };
        headTargets.set(line.newLineNumber, target);
        allTargets.push(target);
      }
    }
  }

  return {
    baseTargets,
    headTargets,
    allTargets
  };
}

function groupDecorationsByLine(
  decorations: RepositoryDiffLineDecoration[],
  side: "base" | "head"
): Map<number, RepositoryDiffLineDecoration[]> {
  const grouped = new Map<number, RepositoryDiffLineDecoration[]>();

  for (const decoration of decorations) {
    if (decoration.side !== side) {
      continue;
    }
    const existing = grouped.get(decoration.lineNumber);
    if (existing) {
      existing.push(decoration);
      continue;
    }
    grouped.set(decoration.lineNumber, [decoration]);
  }

  return grouped;
}

function hoverMessagesForDecorations(
  decorations: RepositoryDiffLineDecoration[]
): Array<{ value: string }> | undefined {
  const messages = decorations
    .map((decoration) => decoration.hoverMessage?.trim())
    .filter((value): value is string => Boolean(value));
  if (messages.length === 0) {
    return undefined;
  }
  return messages.map((value) => ({ value }));
}

function useDiffDecorations(args: {
  diffEditorRef: MutableRefObject<MonacoEditor.IStandaloneDiffEditor | null>;
  monacoRef: MutableRefObject<Monaco | null>;
  lineIndex: ChangeLineIndex;
  isDiffLineSelected?: (target: RepositoryDiffLineTarget) => boolean;
  lineDecorations?: RepositoryDiffLineDecoration[];
}) {
  const { diffEditorRef, monacoRef, lineIndex, isDiffLineSelected, lineDecorations } = args;
  const originalDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const modifiedDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!diffEditorRef.current || !monacoRef.current) {
      return;
    }

    const monacoInstance = monacoRef.current;
    const relevantDecorations = lineDecorations ?? [];
    const baseGroupedDecorations = groupDecorationsByLine(relevantDecorations, "base");
    const headGroupedDecorations = groupDecorationsByLine(relevantDecorations, "head");

    if (!originalDecorationsRef.current) {
      originalDecorationsRef.current =
        diffEditorRef.current.getOriginalEditor().createDecorationsCollection();
    }
    if (!modifiedDecorationsRef.current) {
      modifiedDecorationsRef.current =
        diffEditorRef.current.getModifiedEditor().createDecorationsCollection();
    }

    const selectedTargets = isDiffLineSelected
      ? lineIndex.allTargets.filter((target) => isDiffLineSelected?.(target))
      : [];

    const baseDecorations: MonacoEditor.IModelDeltaDecoration[] = selectedTargets
      .filter((target) => target.side === "base")
      .map((target) => ({
        range: new monacoInstance.Range(target.lineNumber, 1, target.lineNumber, 1),
        options: {
          className: "gits-monaco-selected-line",
          isWholeLine: true,
          lineNumberClassName: "gits-monaco-selected-line-number",
          linesDecorationsClassName: "gits-monaco-selected-line-decoration",
          stickiness:
            monacoInstance.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }));

    for (const [lineNumber, decorations] of baseGroupedDecorations) {
      if (!lineIndex.baseTargets.has(lineNumber)) {
        continue;
      }
      baseDecorations.push({
        range: new monacoInstance.Range(lineNumber, 1, lineNumber, 1),
        options: {
          className: "gits-monaco-thread-line",
          isWholeLine: true,
          lineNumberClassName: "gits-monaco-thread-line-number",
          linesDecorationsClassName: "gits-monaco-thread-line-decoration",
          hoverMessage: hoverMessagesForDecorations(decorations),
          stickiness:
            monacoInstance.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      });
    }

    const headDecorations: MonacoEditor.IModelDeltaDecoration[] = selectedTargets
      .filter((target) => target.side === "head")
      .map((target) => ({
        range: new monacoInstance.Range(target.lineNumber, 1, target.lineNumber, 1),
        options: {
          className: "gits-monaco-selected-line",
          isWholeLine: true,
          lineNumberClassName: "gits-monaco-selected-line-number",
          linesDecorationsClassName: "gits-monaco-selected-line-decoration",
          stickiness:
            monacoInstance.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }));

    for (const [lineNumber, decorations] of headGroupedDecorations) {
      if (!lineIndex.headTargets.has(lineNumber)) {
        continue;
      }
      headDecorations.push({
        range: new monacoInstance.Range(lineNumber, 1, lineNumber, 1),
        options: {
          className: "gits-monaco-thread-line",
          isWholeLine: true,
          lineNumberClassName: "gits-monaco-thread-line-number",
          linesDecorationsClassName: "gits-monaco-thread-line-decoration",
          hoverMessage: hoverMessagesForDecorations(decorations),
          stickiness:
            monacoInstance.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      });
    }

    originalDecorationsRef.current.set(baseDecorations);
    modifiedDecorationsRef.current.set(headDecorations);
  }, [diffEditorRef, isDiffLineSelected, lineDecorations, lineIndex, monacoRef]);
}

export function RepositoryChangeDiffEditor(props: RepositoryChangeDiffEditorProps) {
  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const originalListenerRef = useRef<IDisposable | null>(null);
  const modifiedListenerRef = useRef<IDisposable | null>(null);
  const lineIndex = buildChangeLineIndex(props.change);

  useDiffDecorations({
    diffEditorRef,
    monacoRef,
    lineIndex,
    isDiffLineSelected: props.isDiffLineSelected,
    lineDecorations: props.lineDecorations
  });

  useEffect(() => {
    return () => {
      originalListenerRef.current?.dispose();
      modifiedListenerRef.current?.dispose();
    };
  }, []);

  const originalPath = buildMonacoModelPath(props.change.previousPath ?? props.change.path, "diff-base");
  const modifiedPath = buildMonacoModelPath(props.change.path, "diff-head");
  const language = guessMonacoLanguage(props.change.path || props.change.previousPath || undefined);

  function bindLineSelection(
    editorInstance: MonacoEditor.IStandaloneCodeEditor,
    side: "base" | "head"
  ) {
    if (!props.onDiffLineClick || !monacoRef.current) {
      return null;
    }

    const monacoInstance = monacoRef.current;
    const lineMap = side === "base" ? lineIndex.baseTargets : lineIndex.headTargets;

    return editorInstance.onMouseDown((event) => {
      if (
        event.target.type !== monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        event.target.type !== monacoInstance.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        return;
      }

      const lineNumber =
        event.target.position?.lineNumber ?? event.target.range?.startLineNumber ?? null;
      if (!lineNumber) {
        return;
      }

      const target = lineMap.get(lineNumber);
      if (target) {
        props.onDiffLineClick?.(target);
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <DiffEditor
        original={props.change.oldContent ?? ""}
        modified={props.change.newContent ?? ""}
        originalModelPath={originalPath}
        modifiedModelPath={modifiedPath}
        language={language}
        theme="gits-light"
        height={props.height}
        loading={<div className="px-3 py-2 text-xs text-muted-foreground">Loading diff…</div>}
        beforeMount={configureMonaco}
        onMount={(editor, monacoInstance) => {
          diffEditorRef.current = editor;
          monacoRef.current = monacoInstance;
          originalListenerRef.current?.dispose();
          modifiedListenerRef.current?.dispose();
          originalListenerRef.current = bindLineSelection(editor.getOriginalEditor(), "base");
          modifiedListenerRef.current = bindLineSelection(editor.getModifiedEditor(), "head");
        }}
        options={{
          automaticLayout: true,
          contextmenu: true,
          diffCodeLens: false,
          enableSplitViewResizing: true,
          folding: false,
          fontFamily: monacoViewerFontFamily(),
          fontSize: 12,
          glyphMargin: true,
          lineDecorationsWidth: 12,
          lineHeight: 20,
          minimap: {
            enabled: false
          },
          originalEditable: false,
          overviewRulerBorder: false,
          readOnly: true,
          renderIndicators: true,
          renderMarginRevertIcon: false,
          renderOverviewRuler: false,
          renderSideBySide: true,
          scrollBeyondLastLine: false,
          scrollbar: {
            alwaysConsumeMouseWheel: false,
            horizontalScrollbarSize: 10,
            verticalScrollbarSize: 10
          },
          stickyScroll: {
            enabled: false
          },
          useInlineViewWhenSpaceIsLimited: true,
          wordWrap: "off"
        }}
      />
    </div>
  );
}
