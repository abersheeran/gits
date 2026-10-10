import { DiffEditor } from "@monaco-editor/react";
import { buildMonacoModelPath, guessMonacoLanguage, monacoViewerFontFamily } from "@/lib/monaco";
import { configureMonaco } from "@/lib/monaco-runtime";
import type { RepositoryCommitChange } from "@/lib/api";

const DIFF_CONTEXT_LINE_COUNT = 5;
const DIFF_HIDDEN_REGION_REVEAL_LINE_COUNT = 10;
const DIFF_HIDDEN_REGION_MINIMUM_LINE_COUNT = 3;

type RepositoryChangeDiffEditorProps = {
  change: RepositoryCommitChange;
  height: number;
};

export function RepositoryChangeDiffEditor(props: RepositoryChangeDiffEditorProps) {
  const originalPath = buildMonacoModelPath(props.change.previousPath ?? props.change.path, "diff-base");
  const modifiedPath = buildMonacoModelPath(props.change.path, "diff-head");
  const language = guessMonacoLanguage(props.change.path || props.change.previousPath || undefined);

  return (
    <div className="monaco-shell">
      <div className="monaco-shell__viewport">
        <DiffEditor
          original={props.change.oldContent ?? ""}
          modified={props.change.newContent ?? ""}
          originalModelPath={originalPath}
          modifiedModelPath={modifiedPath}
          language={language}
          theme="gits-light"
          height={props.height}
          loading={<div className="px-3 py-2 text-xs text-text-secondary">Loading diff…</div>}
          beforeMount={configureMonaco}
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
            padding: {
              top: 10,
              bottom: 10
            },
            readOnly: true,
            hideUnchangedRegions: {
              enabled: true,
              contextLineCount: DIFF_CONTEXT_LINE_COUNT,
              revealLineCount: DIFF_HIDDEN_REGION_REVEAL_LINE_COUNT,
              minimumLineCount: DIFF_HIDDEN_REGION_MINIMUM_LINE_COUNT
            },
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
    </div>
  );
}
