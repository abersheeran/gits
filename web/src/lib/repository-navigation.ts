export type CodeViewKind = "tree" | "blob";
export function selectedBranchName(ref: string | null): string | null {
  return ref?.replace(/^refs\/heads\//, "") ?? null;
}
export function decodeUriSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
export function parseCodeSplatPath(value?: string): string | undefined {
  return value?.split("/").filter(Boolean).map(decodeUriSegment).join("/") || undefined;
}
export function buildCodePath(input: {
  owner: string;
  repo: string;
  kind: CodeViewKind;
  ref?: string;
  path?: string;
  defaultBranch?: string | null;
}): string {
  const base = `/repo/${input.owner}/${input.repo}`;
  const path = input.path?.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  if (!input.ref || (input.kind === "tree" && !path && input.ref === input.defaultBranch))
    return base;
  return `${base}/${input.kind}/${encodeURIComponent(input.ref)}${path ? `/${path}` : ""}`;
}
export function commitTitle(message: string): string {
  return message.split("\n")[0]?.trim() || "（无提交说明）";
}
