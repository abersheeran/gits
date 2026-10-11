import { bytesToOid } from "./oid";
import type { CommitObject, TagObject, TreeEntry } from "./parsed-object";

const decoder = new TextDecoder();

function normalizeNewlines(value: string): string {
  return value.replace(/\r/g, "").replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
}

function identity(value: string) {
  const match = /^(.*) <(.*)> (.*) ([+-])(\d\d)(\d\d)$/.exec(value);
  if (!match) {
    throw new Error("Invalid Git identity");
  }
  const offset = (match[4] === "+" ? 1 : -1) * (Number(match[5]) * 60 + Number(match[6]));
  return {
    name: match[1]!,
    email: match[2]!,
    timestamp: Number(match[3]),
    timezoneOffset: offset === 0 ? offset : -offset
  };
}

function headers(text: string, commit: boolean): Record<string, unknown> {
  const lines: string[] = [];
  for (const line of text.slice(0, text.indexOf("\n\n")).split("\n")) {
    if (line.startsWith(" ")) {
      lines[lines.length - 1] += `\n${line.slice(1)}`;
    } else {
      lines.push(line);
    }
  }
  const result: Record<string, unknown> = commit ? { parent: [] } : {};
  for (const line of lines) {
    const space = line.indexOf(" ");
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (Array.isArray(result[key])) {
      (result[key] as string[]).push(value);
    } else {
      result[key] = value;
    }
  }
  for (const key of commit ? ["author", "committer"] : ["tagger", "committer"]) {
    if (typeof result[key] === "string") {
      result[key] = identity(result[key]);
    }
  }
  return result;
}

export function parseCommit(oid: string, content: Uint8Array) {
  const text = decoder.decode(content);
  const commit = {
    message: normalizeNewlines(text.slice(text.indexOf("\n\n") + 2)),
    ...headers(text, true)
  } as CommitObject;
  let payload = normalizeNewlines(text);
  if (payload.includes("\ngpgsig")) {
    payload = normalizeNewlines(
      payload.slice(0, payload.indexOf("\ngpgsig")) +
        "\n" +
        payload.slice(
          payload.indexOf("-----END PGP SIGNATURE-----\n") + "-----END PGP SIGNATURE-----\n".length
        )
    );
  }
  return { oid, commit, payload };
}

export function parseTag(oid: string, content: Uint8Array) {
  const text = decoder.decode(content);
  let unsigned = normalizeNewlines(text);
  if (unsigned.includes("\n-----BEGIN PGP SIGNATURE-----")) {
    unsigned = unsigned.slice(0, unsigned.lastIndexOf("\n-----BEGIN PGP SIGNATURE-----"));
  }
  const gpgsig = text.includes("\n-----BEGIN PGP SIGNATURE-----")
    ? normalizeNewlines(
        text.slice(
          text.indexOf("-----BEGIN PGP SIGNATURE-----"),
          text.indexOf("-----END PGP SIGNATURE-----") + "-----END PGP SIGNATURE-----".length
        )
      )
    : undefined;
  const tag = {
    ...headers(text, false),
    message: unsigned.slice(unsigned.indexOf("\n\n") + 2),
    gpgsig
  } as TagObject;
  return { oid, tag, payload: unsigned + "\n" };
}

function normalizeTreeMode(mode: string): string {
  const modes = [
    [/^0?4/, "040000"],
    [/^1006/, "100644"],
    [/^1007/, "100755"],
    [/^120/, "120000"],
    [/^160/, "160000"]
  ] as const;
  for (const [pattern, normalized] of modes) {
    if (pattern.test(mode)) {
      return normalized;
    }
  }
  throw new Error(`Invalid tree mode: ${mode}`);
}

export function parseTree(
  oid: string,
  content: Uint8Array
): {
  oid: string;
  tree: TreeEntry[];
} {
  const tree: TreeEntry[] = [];
  for (let offset = 0; offset < content.length; ) {
    const space = content.indexOf(32, offset);
    const end = content.indexOf(0, space + 1);
    if (space < offset || end < space || end + 21 > content.length) {
      throw new Error("Invalid tree entry");
    }
    const rawMode = decoder.decode(content.subarray(offset, space));
    const mode = normalizeTreeMode(rawMode);
    const type = mode === "040000" ? "tree" : mode === "160000" ? "commit" : "blob";
    const path = decoder.decode(content.subarray(space + 1, end));
    if (!path || /[\/\0]/.test(path)) {
      throw new Error("Invalid tree path");
    }
    tree.push({ mode, path, oid: bytesToOid(content.subarray(end + 1, end + 21)), type });
    offset = end + 21;
  }
  tree.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { oid, tree };
}

export function parseBlob(oid: string, content: Uint8Array) {
  return { oid, blob: content };
}
