import { CommitQueue } from "./commit-queue";
import { ObjectStore } from "./object-store";
import type { TreeEntry } from "./parsed-object";
import { MAX_PATH_HISTORY_COMMITS, PathHistory, type ReadCommit } from "./path-history";
import { RefStore } from "./ref-store";

type PathTreeCache = Map<string, { oid: string; entries: Map<string, TreeEntry> }>;

export class RepositoryGraph {
  constructor(
    readonly store: ObjectStore,
    readonly refs: RefStore
  ) {
  }

  resolveRef(ref: string): string {
    if (/^[0-9a-f]{40}$/i.test(ref)) {
      return ref.toLowerCase();
    }
    if (ref === "HEAD") {
      const head = this.refs.getHead();
      if (!head) {
        throw new Error("HEAD not found");
      }
      return this.resolveRef(head.startsWith("ref: ") ? head.slice(5) : head);
    }
    const candidates = [ref, `refs/${ref}`, `refs/tags/${ref}`, `refs/heads/${ref}`];
    for (const name of candidates) {
      const oid = this.refs.getRef(name);
      if (oid) {
        return oid;
      }
    }
    throw new Error(`Reference not found: ${ref}`);
  }

  peel(oid: string): string {
    const seen = new Set<string>();
    while (this.store.readHeader(oid)?.type === "tag") {
      if (seen.has(oid)) {
        throw new Error("Cyclic tag");
      }
      seen.add(oid);
      oid = this.store.readTag(oid).tag.object;
    }
    return oid;
  }

  readCommit(oid: string) {
    return this.store.readCommit(this.peel(oid));
  }

  readTree(oid: string) {
    oid = this.peel(oid);
    if (this.store.readHeader(oid)?.type === "commit") {
      oid = this.store.readCommit(oid).commit.tree;
    }
    return this.store.readTree(oid);
  }

  entry(oid: string, path: string): TreeEntry | null {
    const segments = path.split("/");
    let entry: TreeEntry | undefined;
    for (let i = 0; i < segments.length; i++) {
      entry = this.readTree(oid).tree.find((item) => item.path === segments[i]);
      if (!entry || (i < segments.length - 1 && entry.type !== "tree")) {
        return null;
      }
      oid = entry.oid;
    }
    return entry ?? null;
  }

  private *walk(ref: string, maxCommits = Infinity): Generator<ReadCommit, boolean> {
    const queue = new CommitQueue();
    const first = this.readCommit(this.resolveRef(ref));
    queue.push(first);
    const queued = new Set([first.oid]);
    let visited = 0;
    while (queue.length) {
      const commit = queue.pop();
      queued.delete(commit.oid);
      visited++;
      yield commit;
      if (visited >= maxCommits) {
        return !queue.length && !commit.commit.parent.length;
      }
      for (const parent of commit.commit.parent) {
        if (!queued.has(parent)) {
          queued.add(parent);
          queue.push(this.store.readCommit(parent));
        }
      }
    }
    return true;
  }

  private pathOids(
    treeOid: string,
    paths: Iterable<string>,
    trees: PathTreeCache
  ): Map<string, string | null> {
    const result = new Map<string, string | null>();
    for (const path of paths) {
      let oid = treeOid;
      let directory = "";
      const segments = path.split("/");
      let entry: TreeEntry | undefined;
      for (let index = 0; index < segments.length; index++) {
        let cached = trees.get(directory);
        if (cached?.oid !== oid) {
          const entries = new Map(this.store.readTree(oid).tree.map((item) => [item.path, item]));
          // Keep only one tree version per requested directory, independent of history length.
          cached = { oid, entries };
          trees.set(directory, cached);
        }
        entry = cached.entries.get(segments[index]!);
        if (!entry || (index < segments.length - 1 && entry.type !== "tree")) {
          entry = undefined;
          break;
        }
        oid = entry.oid;
        directory = directory ? `${directory}/${segments[index]}` : segments[index]!;
      }
      result.set(path, entry?.oid ?? null);
    }
    return result;
  }

  latestCommits(ref: string, paths: string[]): Map<string, ReadCommit | null> {
    const result = new Map<string, ReadCommit | null>(paths.map((path) => [path, null]));
    const pending = new Map(paths.map((path) => [path, new PathHistory(path, 1)]));
    if (!pending.size) {
      return result;
    }
    const walker = this.walk(ref, MAX_PATH_HISTORY_COMMITS);
    const trees: PathTreeCache = new Map();
    try {
      while (pending.size) {
        const next = walker.next();
        if (next.done) {
          if (next.value) {
            for (const [path, state] of pending) {
              state.finish();
              result.set(path, state.commits[0] ?? null);
            }
          }
          break;
        }
        const oids = this.pathOids(next.value.commit.tree, pending.keys(), trees);
        for (const [path, state] of pending) {
          try {
            state.visit(next.value, oids.get(path) ?? null);
            if (!state.done) {
              continue;
            }
            result.set(path, state.commits[0] ?? null);
          } catch {
            result.set(path, null);
          }
          pending.delete(path);
        }
      }
    } catch {
      // Paths not resolved before an unreadable commit keep their null result.
    } finally {
      walker.return(false);
    }
    return result;
  }

  log(ref: string, depth: number, filepath?: string): ReadCommit[] {
    if (!filepath) {
      const commits: ReadCommit[] = [];
      for (const commit of this.walk(ref)) {
        commits.push(commit);
        if (commits.length >= depth) {
          break;
        }
      }
      return commits;
    }
    const state = new PathHistory(filepath, depth);
    const walker = this.walk(ref, MAX_PATH_HISTORY_COMMITS);
    const trees: PathTreeCache = new Map();
    try {
      while (!state.done) {
        const next = walker.next();
        if (next.done) {
          if (next.value) {
            state.finish();
          }
          break;
        }
        const oid = this.pathOids(next.value.commit.tree, [filepath], trees).get(filepath) ?? null;
        state.visit(next.value, oid);
      }
      return state.commits;
    } finally {
      walker.return(false);
    }
  }
}
