import { NegotiationError, NegotiationLimitError } from "./git-errors";
import { ObjectStore } from "./git-store/object-store";
import { RefStore } from "./git-store/ref-store";
import { RepositoryGraph } from "./git-store/repository-graph";
export { computeObjectClosureForPack } from "./git-pack-object-selection";

const OID_REGEX = /^[0-9a-f]{40}$/i;
const DEFAULT_MAX_HAVE_LINES = 256;
const DEFAULT_MAX_COMMITS = 50000;
const DEFAULT_MAX_OBJECTS = 250000;
const DEFAULT_MAX_DEEPEN_NOT_COMMITS = 100000;

export type GitContext = { store: ObjectStore; refs: RefStore };

function normalizeOidList(input: string[]): string[] {
  return [...new Set(input.map((oid) => oid.toLowerCase()))].filter((oid) => OID_REGEX.test(oid));
}

async function tryReadCommit(args: GitContext, oid: string): Promise<boolean> {
  return args.store.readHeader(oid)?.type === "commit";
}

async function objectExists(args: GitContext, oid: string): Promise<boolean> {
  return args.store.has(oid);
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
      const tag = args.store.readTag(current);
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

type ResolvedWants = {
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
    if (resolution.terminalOid !== want) {
      if (!args.store.has(resolution.terminalOid)) {
        throw new NegotiationError(`want object not found: ${resolution.terminalOid}`);
      }
      extraObjectWants.add(resolution.terminalOid);
    }
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
  const haves = normalizeOidList(args.haves).slice(0, args.maxHaveLines ?? DEFAULT_MAX_HAVE_LINES);
  return haves.filter((oid) => args.store.readHeader(oid)?.type === "commit");
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
      oid = new RepositoryGraph(args.store, args.refs).resolveRef(candidate);
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

    let commit: Awaited<ReturnType<ObjectStore["readCommit"]>> | undefined;
    try {
      commit = args.store.readCommit(next);
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

async function resolveDeepenNotExcludeSet(args: GitContext, refs: string[]): Promise<Set<string>> {
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

type CommitPackSelection = {
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

    let commit: Awaited<ReturnType<ObjectStore["readCommit"]>> | undefined;
    try {
      commit = args.store.readCommit(next.oid);
    } catch {
      continue;
    }

    const commitTimestamp = commit.commit.committer.timestamp;
    if (args.deepenSince !== undefined && commitTimestamp < args.deepenSince) {
      continue;
    }

    visited.add(next.oid);
    if (visited.size > maxCommits) {
      throw new NegotiationLimitError(`pack commit limit exceeded (${maxCommits})`);
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
        let parentCommit: Awaited<ReturnType<ObjectStore["readCommit"]>> | undefined;
        try {
          parentCommit = args.store.readCommit(parentOid);
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
