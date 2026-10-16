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
  rootStyles: CSSStyleDeclaration,
  variable: string
) {
  return rootStyles.getPropertyValue(variable).trim();
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

  const rootStyles = getComputedStyle(document.documentElement);
  const surfaceCanvas = readThemeColor(rootStyles, "--color-surface-canvas");
  const fillPrimary = readThemeColor(rootStyles, "--color-fill-primary");
  const fillSecondary = readThemeColor(rootStyles, "--color-fill-secondary");
  const fillTertiary = readThemeColor(rootStyles, "--color-fill-tertiary");
  const textPrimary = readThemeColor(rootStyles, "--text-primary");
  const textSecondary = readThemeColor(rootStyles, "--text-secondary");
  const textTertiary = readThemeColor(rootStyles, "--text-tertiary");
  const textSupportingStrong = readThemeColor(rootStyles, "--text-supporting-strong");
  const borderSubtle = readThemeColor(rootStyles, "--border-subtle");
  const borderDefault = readThemeColor(rootStyles, "--border-default");
  const dangerText = readThemeColor(rootStyles, "--text-danger");
  const success = readThemeColor(rootStyles, "--color-status-success");
  const syntaxComment = blendColors(textTertiary, 40, textSecondary);
  const syntaxSecondary = blendColors(textSecondary, 80, textSupportingStrong);
  const syntaxString = blendColors(success, 40, textSupportingStrong);
  const syntaxConstant = blendColors(dangerText, 65, textSecondary);
  const highlightBackground = blendColors(fillPrimary, 40, surfaceCanvas);
  const widgetBackground = blendColors(fillPrimary, 20, surfaceCanvas);
  // Text highlights overlay line highlights on the canvas without hiding selections.
  const insertedLineBackground = mixColor(success, 10);
  const insertedTextBackground = mixColor(success, 13);
  const removedLineBackground = mixColor(dangerText, 8);
  const removedTextBackground = mixColor(dangerText, 11);
  const transparentBorder = mixColor(textPrimary, 0);

  instance.editor.defineTheme("gits-light", {
    base: "vs",
    // Default to the site text color; do not inherit more specific VS token rules.
    inherit: false,
    colors: {
      foreground: textPrimary,
      descriptionForeground: textSecondary,
      disabledForeground: syntaxComment,
      errorForeground: dangerText,
      focusBorder: textSecondary,
      "icon.foreground": textSecondary,
      "textLink.foreground": textSecondary,
      "textLink.activeForeground": textSupportingStrong,
      "textPreformat.foreground": textSupportingStrong,
      "textPreformat.background": surfaceCanvas,
      "textCodeBlock.background": surfaceCanvas,
      "editor.foreground": textPrimary,
      "editor.background": surfaceCanvas,
      "editorGutter.background": surfaceCanvas,
      "editorLineNumber.foreground": textSecondary,
      "editorLineNumber.activeForeground": textSupportingStrong,
      "editorLineNumber.dimmedForeground": textSecondary,
      "editor.lineHighlightBackground": highlightBackground,
      "editor.lineHighlightBorder": transparentBorder,
      "editor.selectionBackground": mixColor(fillSecondary, 60),
      "editor.selectionForeground": textPrimary,
      "editor.inactiveSelectionBackground": mixColor(fillSecondary, 35),
      "editor.selectionHighlightBackground": mixColor(fillTertiary, 25),
      "editor.wordHighlightBackground": mixColor(fillSecondary, 40),
      "editor.wordHighlightStrongBackground": mixColor(fillTertiary, 30),
      "editor.wordHighlightTextBackground": mixColor(fillSecondary, 40),
      "editor.hoverHighlightBackground": mixColor(fillPrimary, 50),
      "editor.findMatchBackground": mixColor(fillTertiary, 55),
      "editor.findMatchBorder": textSecondary,
      "editor.findMatchHighlightBackground": mixColor(fillSecondary, 40),
      "editor.findRangeHighlightBackground": mixColor(fillPrimary, 35),
      "editor.rangeHighlightBackground": mixColor(fillPrimary, 35),
      "editor.symbolHighlightBackground": mixColor(fillSecondary, 40),
      "editorCursor.foreground": textSupportingStrong,
      "editorCursor.background": surfaceCanvas,
      "editorWhitespace.foreground": blendColors(textSecondary, 35, surfaceCanvas),
      "editorIndentGuide.background1": blendColors(fillTertiary, 40, surfaceCanvas),
      "editorIndentGuide.activeBackground1": blendColors(textSecondary, 45, surfaceCanvas),
      "editorBracketMatch.background": mixColor(fillSecondary, 40),
      "editorBracketMatch.border": fillTertiary,
      "editorBracketHighlight.foreground1": syntaxSecondary,
      "editorBracketHighlight.foreground2": syntaxSecondary,
      "editorBracketHighlight.foreground3": syntaxSecondary,
      "editorBracketHighlight.foreground4": syntaxSecondary,
      "editorBracketHighlight.foreground5": syntaxSecondary,
      "editorBracketHighlight.foreground6": syntaxSecondary,
      "editorBracketHighlight.unexpectedBracket.foreground": dangerText,
      "editorWidget.background": widgetBackground,
      "editorWidget.foreground": textPrimary,
      "editorWidget.border": borderDefault,
      "editorWidget.resizeBorder": textSecondary,
      "editorHoverWidget.background": widgetBackground,
      "editorHoverWidget.foreground": textPrimary,
      "editorHoverWidget.border": borderDefault,
      "editorHoverWidget.statusBarBackground": highlightBackground,
      "input.background": surfaceCanvas,
      "input.foreground": textPrimary,
      "input.border": borderDefault,
      "input.placeholderForeground": textSecondary,
      "inputOption.activeBackground": highlightBackground,
      "inputOption.activeForeground": textSupportingStrong,
      "inputOption.activeBorder": textSecondary,
      "inputOption.hoverBackground": highlightBackground,
      "inputValidation.errorBackground": removedLineBackground,
      "inputValidation.errorForeground": dangerText,
      "inputValidation.errorBorder": dangerText,
      "menu.background": widgetBackground,
      "menu.foreground": textPrimary,
      "menu.border": borderDefault,
      "menu.selectionBackground": highlightBackground,
      "menu.selectionForeground": textPrimary,
      "menu.selectionBorder": transparentBorder,
      "menu.separatorBackground": borderDefault,
      "toolbar.hoverBackground": highlightBackground,
      "toolbar.activeBackground": blendColors(fillPrimary, 70, surfaceCanvas),
      "widget.shadow": mixColor(textPrimary, 12),
      "widget.border": borderDefault,
      "scrollbar.shadow": mixColor(textPrimary, 10),
      "scrollbarSlider.background": mixColor(textSecondary, 22),
      "scrollbarSlider.hoverBackground": mixColor(textSecondary, 34),
      "scrollbarSlider.activeBackground": mixColor(textSecondary, 48),
      "editorOverviewRuler.background": surfaceCanvas,
      "editorOverviewRuler.border": transparentBorder,
      "editorOverviewRuler.findMatchForeground": textSecondary,
      "editorOverviewRuler.selectionHighlightForeground": fillTertiary,
      "editorOverviewRuler.rangeHighlightForeground": fillTertiary,
      "editorOverviewRuler.wordHighlightForeground": fillTertiary,
      "editorOverviewRuler.wordHighlightStrongForeground": textSecondary,
      "editorOverviewRuler.wordHighlightTextForeground": fillTertiary,
      "editorOverviewRuler.errorForeground": dangerText,
      "editorOverviewRuler.warningForeground": textSecondary,
      "editorOverviewRuler.infoForeground": textSecondary,
      "editorError.foreground": dangerText,
      "editorWarning.foreground": textSecondary,
      "editorInfo.foreground": textSecondary,
      "editorHint.foreground": textSecondary,
      "editorLink.activeForeground": textSupportingStrong,
      "diffEditor.border": borderSubtle,
      "diffEditor.diagonalFill": blendColors(fillTertiary, 45, surfaceCanvas),
      "diffEditor.insertedTextBackground": insertedTextBackground,
      "diffEditor.insertedLineBackground": insertedLineBackground,
      "diffEditor.insertedTextBorder": transparentBorder,
      "diffEditor.removedTextBackground": removedTextBackground,
      "diffEditor.removedLineBackground": removedLineBackground,
      "diffEditor.removedTextBorder": transparentBorder,
      "diffEditorGutter.insertedLineBackground": blendColors(success, 26, surfaceCanvas),
      "diffEditorGutter.removedLineBackground": blendColors(dangerText, 22, surfaceCanvas),
      "diffEditor.unchangedRegionBackground": highlightBackground,
      "diffEditor.unchangedRegionForeground": textSecondary,
      "diffEditor.unchangedCodeBackground": transparentBorder,
      "diffEditor.unchangedRegionShadow": mixColor(textPrimary, 12)
    },
    rules: [
      {
        token: "",
        foreground: toMonacoTokenColor(textPrimary),
        background: toMonacoTokenColor(surfaceCanvas)
      },
      { token: "comment", foreground: toMonacoTokenColor(syntaxComment), fontStyle: "italic" },
      { token: "keyword", foreground: toMonacoTokenColor(textSupportingStrong) },
      { token: "keyword.operator", foreground: toMonacoTokenColor(syntaxSecondary) },
      { token: "keyword.md", foreground: toMonacoTokenColor(textSupportingStrong), fontStyle: "bold" },
      { token: "operator", foreground: toMonacoTokenColor(syntaxSecondary) },
      { token: "storage", foreground: toMonacoTokenColor(textSupportingStrong) },
      { token: "string", foreground: toMonacoTokenColor(syntaxString) },
      { token: "string.key", foreground: toMonacoTokenColor(syntaxSecondary) },
      { token: "string.escape", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "string.link", foreground: toMonacoTokenColor(syntaxSecondary), fontStyle: "underline" },
      { token: "string.target", foreground: toMonacoTokenColor(syntaxSecondary), fontStyle: "underline" },
      { token: "string.md", foreground: toMonacoTokenColor(textSupportingStrong) },
      { token: "variable.md", foreground: toMonacoTokenColor(textSupportingStrong) },
      { token: "regexp", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "number", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "constant", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "constants", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "tag", foreground: toMonacoTokenColor(textSupportingStrong) },
      { token: "metatag", foreground: toMonacoTokenColor(textSupportingStrong) },
      { token: "key", foreground: toMonacoTokenColor(syntaxSecondary) },
      { token: "attribute.name", foreground: toMonacoTokenColor(syntaxSecondary) },
      { token: "attribute.value", foreground: toMonacoTokenColor(syntaxString) },
      { token: "attribute.value.number", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "attribute.value.unit", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "attribute.value.hex", foreground: toMonacoTokenColor(syntaxConstant) },
      { token: "delimiter", foreground: toMonacoTokenColor(syntaxSecondary) },
      { token: "meta.separator", foreground: toMonacoTokenColor(syntaxSecondary) },
      { token: "annotation", foreground: toMonacoTokenColor(syntaxSecondary) },
      { token: "strong", foreground: toMonacoTokenColor(textPrimary), fontStyle: "bold" },
      { token: "emphasis", foreground: toMonacoTokenColor(textPrimary), fontStyle: "italic" },
      { token: "invalid", foreground: toMonacoTokenColor(dangerText) }
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
