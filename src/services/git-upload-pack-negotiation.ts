import * as git from "isomorphic-git";
import { NegotiationError } from "./git-errors";

const OID_REGEX = /^[0-9a-f]{40}$/i;
const DEFAULT_MAX_HAVE_LINES = 256;
const DEFAULT_MAX_COMMITS = 50000;
const DEFAULT_MAX_OBJECTS = 250000;
const DEFAULT_MAX_DEEPEN_NOT_COMMITS = 100000;

type GitContext = {
  fs: unknown;
  dir: string;
  gitdir: string;
  cache?: object;
};

function withCache(cache: object | undefined): { cache?: object } {
  if (cache === undefined) {
    return {};
  }
  return { cache };
}

function normalizeOidList(input: string[]): string[] {
  return [...new Set(input.map((oid) => oid.toLowerCase()))].filter((oid) => OID_REGEX.test(oid));
}

async function tryReadCommit(args: GitContext, oid: string): Promise<boolean> {
  try {
    await git.readCommit({
      fs: args.fs as never,
      dir: args.dir,
      gitdir: args.gitdir,
      oid,
      ...withCache(args.cache)
    });
    return true;
  } catch {
    return false;
  }
}

async function objectExists(args: GitContext, oid: string): Promise<boolean> {
  try {
    await git.readObject({
      fs: args.fs as never,
      dir: args.dir,
      gitdir: args.gitdir,
      oid,
      ...withCache(args.cache)
    });
    return true;
  } catch {
    return false;
  }
}

type TagResolution = {
  tagChain: string[];
  commitOid?: string;
  terminalOid: string;
};

async function peelTagToCommit(args: GitContext, oid: string): Promise<TagResolution> {
  const seen = new Set<string>();
  const chain: string[] = [];
  let current = oid;

  while (!seen.has(current)) {
    seen.add(current);

    if (await tryReadCommit(args, current)) {
      return {
        tagChain: chain,
        commitOid: current,
        terminalOid: current
      };
    }

    try {
      const tag = await git.readTag({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: current,
        ...withCache(args.cache)
      });
      chain.push(current);
      current = tag.tag.object.toLowerCase();
      continue;
    } catch {
      return {
        tagChain: chain,
        terminalOid: current
      };
    }
  }

  return {
    tagChain: chain,
    terminalOid: current
  };
}

export type ResolvedWants = {
  commitWants: string[];
  extraObjectWants: string[];
};

export async function resolveWants(args: GitContext & { wants: string[] }): Promise<ResolvedWants> {
  const commitWants = new Set<string>();
  const extraObjectWants = new Set<string>();

  for (const want of normalizeOidList(args.wants)) {
    if (await tryReadCommit(args, want)) {
      commitWants.add(want);
      continue;
    }

    const resolution = await peelTagToCommit(args, want);
    for (const tagOid of resolution.tagChain) {
      extraObjectWants.add(tagOid);
    }
    if (resolution.commitOid) {
      commitWants.add(resolution.commitOid);
      continue;
    }
    if (!(await objectExists(args, want))) {
      throw new NegotiationError(`want object not found: ${want}`);
    }
    extraObjectWants.add(want);
  }

  return {
    commitWants: [...commitWants],
    extraObjectWants: [...extraObjectWants]
  };
}

export async function findCommonHaves(
  args: GitContext & {
    wantCommits: string[];
    haves: string[];
    maxHaveLines?: number;
  }
): Promise<string[]> {
  const wants = normalizeOidList(args.wantCommits);
  const haves = normalizeOidList(args.haves).slice(0, args.maxHaveLines ?? DEFAULT_MAX_HAVE_LINES);
  if (wants.length === 0 || haves.length === 0) {
    return [];
  }

  const common = new Set<string>();
  for (const have of haves) {
    if (!(await tryReadCommit(args, have))) {
      continue;
    }

    for (const want of wants) {
      if (want === have) {
        common.add(have);
        break;
      }

      try {
        const isAncestor = await git.isDescendent({
          fs: args.fs as never,
          dir: args.dir,
          gitdir: args.gitdir,
          oid: want,
          ancestor: have,
          ...withCache(args.cache)
        });
        if (isAncestor) {
          common.add(have);
          break;
        }
      } catch {
        continue;
      }
    }
  }

  return [...common];
}

async function resolveDeepenNotRefToCommitOid(
  args: GitContext,
  refName: string
): Promise<string | null> {
  const value = refName.trim();
  if (!value) {
    return null;
  }

  if (OID_REGEX.test(value) && (await tryReadCommit(args, value.toLowerCase()))) {
    return value.toLowerCase();
  }

  const candidates = value.startsWith("refs/")
    ? [value]
    : [value, `refs/heads/${value}`, `refs/tags/${value}`];
  for (const candidate of candidates) {
    let oid: string;
    try {
      oid = await git.resolveRef({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        ref: candidate,
        ...withCache(args.cache)
      });
    } catch {
      continue;
    }

    const peeled = await peelTagToCommit(args, oid.toLowerCase());
    if (peeled.commitOid) {
      return peeled.commitOid;
    }
  }

  return null;
}

async function collectAncestors(
  args: GitContext,
  roots: string[],
  maxCommits = DEFAULT_MAX_DEEPEN_NOT_COMMITS
): Promise<Set<string>> {
  const visited = new Set<string>();
  const queue = [...normalizeOidList(roots)];

  while (queue.length > 0) {
    const next = queue.pop();
    if (!next || visited.has(next)) {
      continue;
    }

    let commit:
      | Awaited<ReturnType<typeof git.readCommit>>
      | undefined;
    try {
      commit = await git.readCommit({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: next,
        ...withCache(args.cache)
      });
    } catch {
      continue;
    }

    visited.add(next);
    if (visited.size > maxCommits) {
      throw new NegotiationError(`deepen-not commit limit exceeded (${maxCommits})`);
    }

    for (const parent of commit.commit.parent) {
      const parentOid = parent.toLowerCase();
      if (!visited.has(parentOid)) {
        queue.push(parentOid);
      }
    }
  }

  return visited;
}

async function resolveDeepenNotExcludeSet(
  args: GitContext,
  refs: string[]
): Promise<Set<string>> {
  if (refs.length === 0) {
    return new Set<string>();
  }
  const commitRoots: string[] = [];
  for (const ref of [...new Set(refs.map((value) => value.trim()).filter(Boolean))]) {
    const oid = await resolveDeepenNotRefToCommitOid(args, ref);
    if (!oid) {
      throw new NegotiationError(`deepen-not ref not found: ${ref}`);
    }
    commitRoots.push(oid);
  }

  return collectAncestors(args, commitRoots);
}

export type CommitPackSelection = {
  commitOids: string[];
  shallowOids: string[];
};

export async function computeCommitSetForPack(
  args: GitContext & {
    wantCommits: string[];
    commonOids: string[];
    deepen?: number;
    deepenSince?: number;
    deepenNot?: string[];
    maxCommits?: number;
  }
): Promise<CommitPackSelection> {
  const stopSet = new Set(normalizeOidList(args.commonOids));
  const deepenNotStopSet = await resolveDeepenNotExcludeSet(args, args.deepenNot ?? []);
  const useShallowBoundaries =
    args.deepen !== undefined ||
    args.deepenSince !== undefined ||
    (args.deepenNot?.length ?? 0) > 0;
  const queue = normalizeOidList(args.wantCommits).map((oid) => ({ oid, depth: 1 }));
  const visited = new Set<string>();
  const shallow = new Set<string>();
  const maxCommits = args.maxCommits ?? DEFAULT_MAX_COMMITS;

  while (queue.length > 0) {
    const next = queue.pop();
    if (!next) {
      continue;
    }
    if (visited.has(next.oid) || stopSet.has(next.oid) || deepenNotStopSet.has(next.oid)) {
      continue;
    }

    let commit:
      | Awaited<ReturnType<typeof git.readCommit>>
      | undefined;
    try {
      commit = await git.readCommit({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: next.oid,
        ...withCache(args.cache)
      });
    } catch {
      continue;
    }

    const commitTimestamp = commit.commit.committer.timestamp;
    if (args.deepenSince !== undefined && commitTimestamp < args.deepenSince) {
      continue;
    }

    visited.add(next.oid);
    if (visited.size > maxCommits) {
      throw new NegotiationError(`pack commit limit exceeded (${maxCommits})`);
    }

    if (args.deepen !== undefined && next.depth >= args.deepen) {
      if (commit.commit.parent.length > 0) {
        shallow.add(next.oid);
      }
      continue;
    }

    let shallowBoundary = false;
    for (const parent of commit.commit.parent) {
      const parentOid = parent.toLowerCase();
      if (visited.has(parentOid)) {
        continue;
      }
      if (stopSet.has(parentOid) || deepenNotStopSet.has(parentOid)) {
        if (useShallowBoundaries) {
          shallowBoundary = true;
        }
        continue;
      }

      if (args.deepenSince !== undefined) {
        let parentCommit:
          | Awaited<ReturnType<typeof git.readCommit>>
          | undefined;
        try {
          parentCommit = await git.readCommit({
            fs: args.fs as never,
            dir: args.dir,
            gitdir: args.gitdir,
            oid: parentOid,
            ...withCache(args.cache)
          });
        } catch {
          continue;
        }
        if (parentCommit.commit.committer.timestamp < args.deepenSince) {
          shallowBoundary = true;
          continue;
        }
      }

      queue.push({ oid: parentOid, depth: next.depth + 1 });
    }

    if (useShallowBoundaries && shallowBoundary) {
      shallow.add(next.oid);
    }
  }

  return {
    commitOids: [...visited],
    shallowOids: [...shallow]
  };
}

export async function computeObjectClosureForPack(
  args: GitContext & {
    commitOids: string[];
    extraOids?: string[];
    filter?: {
      blobNone?: boolean;
      blobLimitBytes?: number;
    };
    maxObjects?: number;
  }
): Promise<string[]> {
  const objects = new Set<string>(normalizeOidList(args.extraOids ?? []));
  const treeQueue: string[] = [];
  const processedTrees = new Set<string>();
  const maxObjects = args.maxObjects ?? DEFAULT_MAX_OBJECTS;

  for (const oid of normalizeOidList(args.commitOids)) {
    try {
      const commit = await git.readCommit({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid,
        ...withCache(args.cache)
      });
      objects.add(oid);
      const treeOid = commit.commit.tree.toLowerCase();
      treeQueue.push(treeOid);
    } catch {
      continue;
    }
  }

  while (treeQueue.length > 0) {
    const treeOid = treeQueue.pop();
    if (!treeOid || processedTrees.has(treeOid)) {
      continue;
    }
    processedTrees.add(treeOid);
    if (!objects.has(treeOid)) {
      objects.add(treeOid);
      if (objects.size > maxObjects) {
        throw new NegotiationError(`pack object limit exceeded (${maxObjects})`);
      }
    }

    let tree:
      | Awaited<ReturnType<typeof git.readTree>>
      | undefined;
    try {
      tree = await git.readTree({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: treeOid,
        ...withCache(args.cache)
      });
    } catch {
      continue;
    }

    for (const entry of tree.tree) {
      const entryOid = entry.oid.toLowerCase();
      // Tree gitlinks (submodules) point to commits outside this repository object DB.
      if (entry.type === "commit") {
        continue;
      }
      if (entry.type === "blob" && args.filter?.blobNone) {
        continue;
      }
      if (entry.type === "blob" && args.filter?.blobLimitBytes !== undefined) {
        let blob:
          | Awaited<ReturnType<typeof git.readBlob>>
          | undefined;
        try {
          blob = await git.readBlob({
            fs: args.fs as never,
            dir: args.dir,
            gitdir: args.gitdir,
            oid: entryOid,
            ...withCache(args.cache)
          });
        } catch {
          continue;
        }
        if (blob.blob.byteLength > args.filter.blobLimitBytes) {
          continue;
        }
      }
      if (!objects.has(entryOid)) {
        objects.add(entryOid);
        if (objects.size > maxObjects) {
          throw new NegotiationError(`pack object limit exceeded (${maxObjects})`);
        }
      }
      if (entry.type === "tree" && !processedTrees.has(entryOid)) {
        treeQueue.push(entryOid);
      }
    }
  }

  return [...objects];
}
