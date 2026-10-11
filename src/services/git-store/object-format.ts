import { createHash } from "node:crypto";

export type ObjectType = "commit" | "tree" | "blob" | "tag";

export const TYPE_CODES: Record<ObjectType, number> = { commit: 1, tree: 2, blob: 3, tag: 4 };

export const MAX_RESOLVE_BYTES = 32 * 1024 * 1024;

export const MAX_DELTA_DEPTH = 50;

export class GitObjectTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`Object exceeds resolution limit: ${size} bytes`);
  }
}

export class GitObjectNotFoundError extends Error {
  constructor(readonly oid: string) {
    super(`Object not found: ${oid}`);
  }
}

export class GitMissingObjectError extends Error {
  constructor(readonly oid: string) {
    super(`Missing base object: ${oid}`);
  }
}

export function objectType(code: number): ObjectType {
  const type = (["", "commit", "tree", "blob", "tag"] as const)[code];
  if (!type) {
    throw new Error(`Invalid object type: ${code}`);
  }
  return type;
}

export function objectHeader(type: ObjectType, size: number): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("Invalid object size");
  }
  return new TextEncoder().encode(`${type} ${size}\0`);
}

export function objectHash(type: ObjectType, content: Uint8Array): string {
  return createHash("sha1")
    .update(objectHeader(type, content.length))
    .update(content)
    .digest("hex");
}

export function checkResolveSize(size: number): void {
  if (size > MAX_RESOLVE_BYTES) {
    throw new GitObjectTooLargeError(size);
  }
}

export class GitPackTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Pack exceeds maxBytes (${maxBytes})`);
  }
}
