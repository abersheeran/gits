import { NegotiationLimitError } from "./git-errors";
import type { TreeEntry } from "./git-store/parsed-object";
import type { GitContext } from "./git-upload-pack-negotiation";

export async function computeObjectClosureForPack(
  args: GitContext & {
    commitOids: string[];
    commonOids?: string[];
    clientShallows?: string[];
    extraOids?: string[];
    filter?: { blobNone?: boolean; blobLimitBytes?: number };
    maxObjects?: number;
  }
): Promise<string[]> {
  const objects = new Set<string>();
  const processed = new Set<string>();
  const available = new Set([...(args.commonOids ?? []), ...args.commitOids]);
  const shallows = new Set(args.clientShallows ?? []);
  const maxObjects = args.maxObjects ?? 250000;
  const pending: Array<{ oid: string; parents: string[] }> = [];
  function add(oid: string): void {
    objects.add(oid);
    if (objects.size > maxObjects) {
      throw new NegotiationLimitError(`pack object limit exceeded (${maxObjects})`);
    }
  }
  function addBlob(oid: string): void {
    if (args.filter?.blobNone) {
      return;
    }
    const header = args.store.readHeader(oid);
    if (
      header &&
      (args.filter?.blobLimitBytes === undefined || header.size <= args.filter.blobLimitBytes)
    ) {
      add(oid);
    }
  }
  for (const oid of args.extraOids ?? []) {
    // Explicit blob wants are needed for checkout of a partial clone.
    add(oid);
    if (args.store.readHeader(oid)?.type === "tree") {
      pending.push({ oid, parents: [] });
    }
  }
  for (const oid of args.commitOids) {
    const commit = args.store.readCommit(oid).commit;
    add(oid);
    const parents = shallows.has(oid)
      ? []
      : commit.parent
          .filter((parent) => available.has(parent))
          .map((parent) => args.store.readCommit(parent).commit.tree);
    pending.push({ oid: commit.tree, parents });
  }
  while (pending.length) {
    const next = pending.pop()!;
    if (processed.has(next.oid) || next.parents.includes(next.oid)) {
      continue;
    }
    processed.add(next.oid);
    add(next.oid);
    const parents = next.parents.map(
      (oid) =>
        new Map<string, TreeEntry>(
          args.store.readTree(oid).tree.map((entry) => [entry.path, entry])
        )
    );
    for (const entry of args.store.readTree(next.oid).tree) {
      if (entry.type === "commit") {
        continue;
      }
      const previous = parents.map((tree) => tree.get(entry.path));
      if (previous.some((item) => item?.oid === entry.oid && item.type === entry.type)) {
        continue;
      }
      if (entry.type === "blob") {
        addBlob(entry.oid);
      } else {
        pending.push({
          oid: entry.oid,
          parents: previous.filter((item) => item?.type === "tree").map((item) => item!.oid)
        });
      }
    }
  }
  return [...objects];
}
