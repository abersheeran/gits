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

function readThemeColor(
  rootStyles: CSSStyleDeclaration | null,
  variable: string,
  fallback: string
) {
  return rootStyles?.getPropertyValue(variable).trim() || fallback;
}

type ParsedColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

function clampByte(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampAlpha(value: number) {
  return Math.min(1, Math.max(0, value));
}

function parseThemeColor(value: string): ParsedColor | null {
  const normalized = value.trim();

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1]
      .split(",")
      .map((part) => Number.parseFloat(part.trim()))
      .filter((part) => Number.isFinite(part));
    if (parts.length === 3 || parts.length === 4) {
      return {
        red: clampByte(parts[0]),
        green: clampByte(parts[1]),
        blue: clampByte(parts[2]),
        alpha: clampAlpha(parts[3] ?? 1)
      };
    }
  }

  const hex = normalized.replace("#", "");
  if (!/^[\da-f]+$/i.test(hex)) {
    return null;
  }

  if (hex.length === 3 || hex.length === 4) {
    const [red, green, blue, alpha = "f"] = hex.split("");
    return parseThemeColor(`#${red}${red}${green}${green}${blue}${blue}${alpha}${alpha}`);
  }

  if (hex.length === 6 || hex.length === 8) {
    const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return {
      red: Number.parseInt(hex.slice(0, 2), 16),
      green: Number.parseInt(hex.slice(2, 4), 16),
      blue: Number.parseInt(hex.slice(4, 6), 16),
      alpha: clampAlpha(alpha)
    };
  }

  return null;
}

function formatThemeColor(color: ParsedColor) {
  const red = clampByte(color.red);
  const green = clampByte(color.green);
  const blue = clampByte(color.blue);
  const alpha = clampAlpha(color.alpha);
  const toHex = (value: number) => value.toString(16).padStart(2, "0");

  if (alpha >= 0.999) {
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  }

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}${toHex(Math.round(alpha * 255))}`;
}

function mixColor(color: string, amount: number) {
  const parsed = parseThemeColor(color);
  if (!parsed) {
    return color;
  }

  return formatThemeColor({
    ...parsed,
    alpha: parsed.alpha * (amount / 100)
  });
}

function blendColors(primary: string, primaryAmount: number, secondary: string) {
  const primaryParsed = parseThemeColor(primary);
  const secondaryParsed = parseThemeColor(secondary);
  if (!primaryParsed || !secondaryParsed) {
    return primary;
  }

  const primaryWeight = primaryAmount / 100;
  const secondaryWeight = 1 - primaryWeight;

  return formatThemeColor({
    red: primaryParsed.red * primaryWeight + secondaryParsed.red * secondaryWeight,
    green: primaryParsed.green * primaryWeight + secondaryParsed.green * secondaryWeight,
    blue: primaryParsed.blue * primaryWeight + secondaryParsed.blue * secondaryWeight,
    alpha: primaryParsed.alpha * primaryWeight + secondaryParsed.alpha * secondaryWeight
  });
}

function toMonacoTokenColor(color: string) {
  return color.replace("#", "");
}

export function configureMonaco(instance: Monaco) {
  if (monacoConfigured) {
    return;
  }
  monacoConfigured = true;

  const rootStyles = globalThis.document
    ? getComputedStyle(globalThis.document.documentElement)
    : null;
  const surfaceBase = readThemeColor(rootStyles, "--color-surface-base", "#ffffff");
  const surfaceFocus = readThemeColor(rootStyles, "--color-surface-focus", "#f4eeeb");
  const surfaceHover = readThemeColor(rootStyles, "--color-surface-hover", "#f6f4f4");
  const fillPrimary = readThemeColor(rootStyles, "--color-fill-primary", "#ebe4e0");
  const fillSecondary = readThemeColor(rootStyles, "--color-fill-secondary", "#d1cecc");
  const fillTertiary = readThemeColor(rootStyles, "--color-fill-tertiary", "#bbb6b4");
  const textPrimary = readThemeColor(rootStyles, "--text-primary", "#0f0e0d");
  const textSecondary = readThemeColor(rootStyles, "--text-secondary", "#766f6a");
  const textTertiary = readThemeColor(rootStyles, "--text-tertiary", "#a6a09b");
  const textSupporting = readThemeColor(rootStyles, "--text-supporting", "#6e6e6e");
  const textSupportingStrong = readThemeColor(
    rootStyles,
    "--text-supporting-strong",
    "#44403b"
  );
  const borderSubtle = readThemeColor(rootStyles, "--border-subtle", "#efe9e7");
  const borderDefault = readThemeColor(rootStyles, "--border-default", "#e5e5e5");
  const dangerSurface = readThemeColor(rootStyles, "--color-danger-surface", "#f9ece8");
  const dangerBorder = readThemeColor(rootStyles, "--border-danger", "#e9c6bf");
  const success = readThemeColor(rootStyles, "--color-status-success", "#5d7b67");
  const successMuted = readThemeColor(rootStyles, "--color-status-success-muted", "#edf3ee");
  const syntaxComment = blendColors(textTertiary, 84, surfaceBase);
  const syntaxKeyword = blendColors(textSupportingStrong, 74, fillTertiary);
  const syntaxOperator = blendColors(textSupporting, 78, fillSecondary);
  const syntaxString = blendColors(success, 52, textSupportingStrong);
  const syntaxConstant = blendColors(fillTertiary, 44, textSupportingStrong);
  const syntaxType = blendColors(textPrimary, 62, fillSecondary);
  const syntaxFunction = blendColors(textPrimary, 72, textSecondary);
  const syntaxTag = blendColors(textSupportingStrong, 72, success);
  const syntaxAttribute = blendColors(textSecondary, 64, fillTertiary);
  const syntaxDelimiter = blendColors(textSupporting, 76, surfaceBase);

  instance.editor.defineTheme("gits-light", {
    base: "vs",
    inherit: true,
    colors: {
      "editor.foreground": textPrimary,
      "editor.background": surfaceBase,
      "editorGutter.background": surfaceBase,
      "editorLineNumber.foreground": textSecondary,
      "editorLineNumber.activeForeground": textSupportingStrong,
      "editor.lineHighlightBackground": mixColor(surfaceFocus, 84),
      "editor.selectionBackground": mixColor(fillPrimary, 88),
      "editor.inactiveSelectionBackground": mixColor(fillPrimary, 56),
      "editor.selectionHighlightBackground": mixColor(fillPrimary, 34),
      "editor.wordHighlightBackground": mixColor(fillPrimary, 26),
      "editor.wordHighlightStrongBackground": mixColor(fillSecondary, 24),
      "editor.hoverHighlightBackground": mixColor(surfaceHover, 76),
      "editorCursor.foreground": textSupportingStrong,
      "editorWhitespace.foreground": mixColor(textSecondary, 22),
      "editorIndentGuide.background1": blendColors(borderSubtle, 78, surfaceBase),
      "editorIndentGuide.activeBackground1": borderDefault,
      "editorWidget.background": surfaceBase,
      "editorWidget.border": borderSubtle,
      "editorHoverWidget.background": surfaceBase,
      "editorHoverWidget.border": borderSubtle,
      "widget.shadow": mixColor(textPrimary, 12),
      "scrollbarSlider.background": mixColor(fillSecondary, 34),
      "scrollbarSlider.hoverBackground": mixColor(fillSecondary, 52),
      "scrollbarSlider.activeBackground": mixColor(textSecondary, 30),
      "editorOverviewRuler.border": "transparent",
      "editorLink.activeForeground": textPrimary,
      "diffEditor.border": borderSubtle,
      "diffEditor.diagonalFill": blendColors(borderSubtle, 72, surfaceBase),
      "diffEditor.insertedTextBackground": blendColors(successMuted, 88, surfaceBase),
      "diffEditor.insertedLineBackground": blendColors(successMuted, 72, surfaceBase),
      "diffEditor.insertedTextBorder": blendColors(success, 28, successMuted),
      "diffEditor.removedTextBackground": mixColor(dangerSurface, 78),
      "diffEditor.removedLineBackground": mixColor(dangerSurface, 52),
      "diffEditor.removedTextBorder": dangerBorder,
      "diffEditorGutter.insertedLineBackground": blendColors(successMuted, 78, surfaceBase),
      "diffEditorGutter.removedLineBackground": mixColor(dangerSurface, 68),
      "diffEditor.unchangedRegionBackground": blendColors(surfaceFocus, 82, surfaceBase),
      "diffEditor.unchangedRegionForeground": textSecondary,
      "diffEditor.unchangedRegionShadow": mixColor(textPrimary, 16)
    },
    rules: [
      { token: "comment", foreground: toMonacoTokenColor(syntaxComment), fontStyle: "italic" },
      { token: "comment.doc", foreground: toMonacoTokenColor(syntaxComment), fontStyle: "italic" },
      { token: "keyword", foreground: toMonacoTokenColor(syntaxKeyword) },
      { token: "keyword.operator", foreground: toMonacoTokenColor(syntaxOperator) },
      { token: "operator", foreground: toMonacoTokenColor(syntaxOperator) },
      { token: "storage", foreground: toMonacoTokenColor(syntaxKeyword) },
      { token: "string", foreground: toMonacoTokenColor(syntaxString) },
      { token: "regexp", foreground: toMonacoTokenColor(syntaxString) },
      { token: "number", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "constant", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "constant.language", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "type", foreground: toMonacoTokenColor(syntaxType) },
      { token: "type.identifier", foreground: toMonacoTokenColor(syntaxType) },
      { token: "class", foreground: toMonacoTokenColor(syntaxType) },
      { token: "interface", foreground: toMonacoTokenColor(syntaxType) },
      { token: "function", foreground: toMonacoTokenColor(syntaxFunction) },
      { token: "function.call", foreground: toMonacoTokenColor(syntaxFunction) },
      { token: "tag", foreground: toMonacoTokenColor(syntaxTag) },
      { token: "attribute.name", foreground: toMonacoTokenColor(syntaxAttribute) },
      { token: "delimiter", foreground: toMonacoTokenColor(syntaxDelimiter) },
      { token: "delimiter.bracket", foreground: toMonacoTokenColor(syntaxDelimiter) }
    ]
  });

  const compilerOptions = {
    allowNonTsExtensions: true,
    jsx: instance.languages.typescript.JsxEmit.ReactJSX,
    target: instance.languages.typescript.ScriptTarget.ES2022
  };

  instance.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);
  instance.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
}
