const MONACO_VIEWER_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace";

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cjs: "javascript",
  cs: "csharp",
  css: "css",
  diff: "diff",
  go: "go",
  h: "cpp",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  less: "less",
  log: "plaintext",
  md: "markdown",
  mjs: "javascript",
  patch: "diff",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shell",
  sql: "sql",
  text: "plaintext",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  xml: "xml",
  zsh: "shell"
};

const FILENAME_LANGUAGE_MAP: Record<string, string> = {
  ".env": "shell",
  ".gitignore": "plaintext",
  "package-lock.json": "json",
  "package.json": "json",
  "tsconfig.json": "json",
  "vite.config.ts": "typescript",
  "wrangler.jsonc": "json"
};

export function guessMonacoLanguage(path?: string, fallback = "plaintext"): string {
  if (!path) {
    return fallback;
  }

  const normalizedPath = path.replaceAll("\\", "/");
  const filename = normalizedPath.split("/").at(-1)?.toLowerCase() ?? normalizedPath.toLowerCase();
  const directMatch = FILENAME_LANGUAGE_MAP[filename];
  if (directMatch) {
    return directMatch;
  }

  const extension = filename.includes(".") ? filename.split(".").at(-1)?.toLowerCase() : undefined;
  if (!extension) {
    return fallback;
  }

  return EXTENSION_LANGUAGE_MAP[extension] ?? fallback;
}

export function buildMonacoModelPath(path: string, scope = "viewer"): string {
  const normalizedPath = path.replaceAll("\\", "/").replace(/^\/+/, "");
  return `inmemory://gits/${scope}/${encodeURI(normalizedPath)}`;
}

export function estimateMonacoHeight(
  value: string,
  options?: {
    lineHeight?: number;
    minHeight?: number;
    maxHeight?: number;
    padding?: number;
  }
): number {
  const lineHeight = options?.lineHeight ?? 20;
  const minHeight = options?.minHeight ?? 120;
  const maxHeight = options?.maxHeight ?? 720;
  const padding = options?.padding ?? 24;
  const lineCount = Math.max(value.split(/\r\n|\n|\r/).length, 1);
  return Math.min(Math.max(lineCount * lineHeight + padding, minHeight), maxHeight);
}

export function monacoViewerFontFamily(): string {
  return MONACO_VIEWER_FONT_FAMILY;
}
