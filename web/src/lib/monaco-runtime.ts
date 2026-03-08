import { loader, type Monaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

const globalMonacoEnvironment = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker(moduleId: string, label: string): Worker;
  };
};

if (!globalMonacoEnvironment.MonacoEnvironment) {
  globalMonacoEnvironment.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      if (label === "json") {
        return new jsonWorker();
      }
      if (label === "css" || label === "scss" || label === "less") {
        return new cssWorker();
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new htmlWorker();
      }
      if (label === "typescript" || label === "javascript") {
        return new tsWorker();
      }
      return new editorWorker();
    }
  };
}

loader.config({ monaco });

let monacoConfigured = false;

export function configureMonaco(instance: Monaco) {
  if (monacoConfigured) {
    return;
  }
  monacoConfigured = true;

  instance.editor.defineTheme("gits-light", {
    base: "vs",
    inherit: true,
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#00000000",
      "editorLineNumber.foreground": "#6b7280",
      "editorLineNumber.activeForeground": "#111827"
    },
    rules: []
  });

  const compilerOptions = {
    allowNonTsExtensions: true,
    jsx: instance.languages.typescript.JsxEmit.ReactJSX,
    target: instance.languages.typescript.ScriptTarget.ES2022
  };

  instance.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);
  instance.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
}
