import * as git from "isomorphic-git";
import { diffCommitTrees, looksBinary, type RepositoryDiffChange } from "./repository-diff";
import { loadRepositoryFromStorage, type RepositorySnapshotStorage } from "./git-repo-loader";
import { StorageService } from "./storage-service";

const OID_REGEX = /^[0-9a-f]{40}$/i;
const README_CANDIDATES = ["readme.md", "readme", "readme.txt", "readme.mkd"];
const MAX_README_BYTES = 200 * 1024;
const MAX_FILE_PREVIEW_BYTES = 512 * 1024;

type RepositoryBranch = {
  name: string;
  oid: string;
};

type RepositoryEntryType = "tree" | "blob" | "commit";

export type RepositoryDetail = {
  defaultBranch: string | null;
  selectedRef: string | null;
  headOid: string | null;
  branches: RepositoryBranch[];
  readme: {
    path: string;
    content: string;
  } | null;
};

type CommitSummary = {
  oid: string;
  message: string;
  author: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset: number;
  };
  committer: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset: number;
  };
  parents: string[];
};

type RepositoryTreeEntry = {
  name: string;
  path: string;
  oid: string;
  mode: string;
  type: RepositoryEntryType;
  latestCommit: CommitSummary | null;
};

type RepositoryFilePreview = {
  path: string;
  oid: string;
  mode: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
  content: string | null;
  latestCommit: CommitSummary | null;
};

export type RepositoryBrowseResult = {
  defaultBranch: string | null;
  selectedRef: string | null;
  headOid: string | null;
  path: string;
  kind: "tree" | "blob";
  entries: RepositoryTreeEntry[];
  file: RepositoryFilePreview | null;
  readme: { path: string; content: string } | null;
};

export type RepositoryPathHistoryResult = {
  ref: string | null;
  path: string;
  commits: CommitSummary[];
};

export type RepositoryCommitHistoryResult = {
  ref: string | null;
  commits: CommitSummary[];
  pagination: {
    page: number;
    perPage: number;
    hasNextPage: boolean;
  };
};

export type RepositoryCommitDetail = {
  commit: CommitSummary;
  filesChanged: number;
  additions: number;
  deletions: number;
  changes: RepositoryDiffChange[];
};

export class RepositoryBrowsePathNotFoundError extends Error {
  constructor(path: string) {
    super(path ? `Path not found: ${path}` : "Path not found");
    this.name = "RepositoryBrowsePathNotFoundError";
  }
}

export class RepositoryBrowseInvalidPathError extends Error {
  constructor() {
    super("Invalid path");
    this.name = "RepositoryBrowseInvalidPathError";
  }
}

function stripHeadsPrefix(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

function branchNameFromHead(head: string | null): string | null {
  if (!head || !head.startsWith("ref: ")) {
    return null;
  }
  return stripHeadsPrefix(head.slice("ref: ".length).trim());
}

function resolveRefInput(input: string, branchNames: Set<string>): string {
  if (OID_REGEX.test(input)) {
    return input.toLowerCase();
  }
  if (input.startsWith("refs/")) {
    return input;
  }
  if (branchNames.has(input)) {
    return `refs/heads/${input}`;
  }
  return input;
}

function normalizeRepositoryPath(input?: string): string {
  if (!input) {
    return "";
  }
  const segments = input
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new RepositoryBrowseInvalidPathError();
    }
    if (segment.includes("\u0000")) {
      throw new RepositoryBrowseInvalidPathError();
    }
  }

  return segments.join("/");
}

function sortTreeEntries(entries: RepositoryTreeEntry[]): RepositoryTreeEntry[] {
  return entries.sort((left, right) => {
    if (left.type === "tree" && right.type !== "tree") {
      return -1;
    }
    if (left.type !== "tree" && right.type === "tree") {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function toCommitSummary(commit: {
  oid: string;
  commit: {
    message: string;
    parent: string[];
    author: {
      name: string;
      email: string;
      timestamp: number;
      timezoneOffset: number;
    };
    committer: {
      name: string;
      email: string;
      timestamp: number;
      timezoneOffset: number;
    };
  };
}): CommitSummary {
  return {
    oid: commit.oid,
    message: commit.commit.message,
    author: commit.commit.author,
    committer: commit.commit.committer,
    parents: commit.commit.parent
  };
}

export type LoadedRepositoryContext = Awaited<ReturnType<typeof loadRepositoryFromStorage>> & {
  branches: RepositoryBranch[];
  branchNames: Set<string>;
  defaultBranch: string | null;
};

export function buildLoadedRepositoryContext(
  loaded: Awaited<ReturnType<typeof loadRepositoryFromStorage>>
): LoadedRepositoryContext {
  const branches = loaded.headRefs.map((item) => ({
    name: stripHeadsPrefix(item.name),
    oid: item.oid
  }));
  return {
    ...loaded,
    branches,
    branchNames: new Set(branches.map((item) => item.name)),
    defaultBranch: branchNameFromHead(loaded.head) ?? branches[0]?.name ?? null
  };
}

export class RepositoryBrowserService {
  constructor(
    private readonly storage: StorageService,
    private readonly snapshotStorage?: RepositorySnapshotStorage
  ) {}

  async loadRepositoryContext(owner: string, repo: string): Promise<LoadedRepositoryContext> {
    return buildLoadedRepositoryContext(
      await loadRepositoryFromStorage(this.storage, owner, repo, this.snapshotStorage)
    );
  }

  private async ensureLoadedContext(
    owner: string,
    repo: string,
    loadedContext?: LoadedRepositoryContext
  ): Promise<LoadedRepositoryContext> {
    return loadedContext ?? this.loadRepositoryContext(owner, repo);
  }

  private async tryResolveCommitOid(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    ref: string | null;
  }): Promise<string | null> {
    if (!args.ref) {
      return null;
    }
    if (OID_REGEX.test(args.ref)) {
      return args.ref.toLowerCase();
    }

    try {
      return await git.resolveRef({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        ref: args.ref
      });
    } catch {
      return null;
    }
  }

  private selectRef(ref: string | undefined, context: LoadedRepositoryContext): string | null {
    return (
      (ref && resolveRefInput(ref, context.branchNames)) ||
      (context.defaultBranch ? `refs/heads/${context.defaultBranch}` : null)
    );
  }

  private async latestCommitForPath(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    ref: string | null;
    path: string;
  }): Promise<CommitSummary | null> {
    if (!args.ref) {
      return null;
    }
    try {
      const commits = await git.log({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        ref: args.ref,
        filepath: args.path,
        depth: 1
      });
      const latest = commits[0];
      return latest ? toCommitSummary(latest) : null;
    } catch {
      return null;
    }
  }

  private async enrichEntriesWithLatestCommits(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    ref: string | null;
    entries: RepositoryTreeEntry[];
  }): Promise<RepositoryTreeEntry[]> {
    const latestCommits = await Promise.all(
      args.entries.map((entry) =>
        this.latestCommitForPath({
          fs: args.fs,
          dir: args.dir,
          gitdir: args.gitdir,
          ref: args.ref,
          path: entry.path
        })
      )
    );
    return args.entries.map((entry, index) => ({
      ...entry,
      latestCommit: latestCommits[index] ?? null
    }));
  }

  private async tryReadReadme(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    treeOid: string;
    directoryPath: string;
  }): Promise<{ path: string; content: string } | null> {
    try {
      const tree = await git.readTree({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: args.treeOid
      });

      const entry = tree.tree.find((item) => {
        const path = item.path.toLowerCase();
        return item.type === "blob" && README_CANDIDATES.includes(path);
      });
      if (!entry) {
        return null;
      }

      const blob = await git.readBlob({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: entry.oid
      });
      const bytes = blob.blob.slice(0, MAX_README_BYTES);
      const fullPath = args.directoryPath ? `${args.directoryPath}/${entry.path}` : entry.path;
      return {
        path: fullPath,
        content: new TextDecoder().decode(bytes)
      };
    } catch {
      return null;
    }
  }

  private mapTreeEntries(
    entries: Array<{ path: string; oid: string; type: RepositoryEntryType; mode: string }>,
    basePath: string
  ): RepositoryTreeEntry[] {
    return sortTreeEntries(
      entries.map((item) => ({
        name: item.path,
        path: basePath ? `${basePath}/${item.path}` : item.path,
        oid: item.oid,
        mode: item.mode,
        type: item.type,
        latestCommit: null
      }))
    );
  }

  private async resolveBrowseTarget(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    commitOid: string;
    path: string;
  }): Promise<
    | {
        kind: "tree";
        treeOid: string;
        path: string;
        entries: RepositoryTreeEntry[];
      }
    | {
        kind: "blob";
        path: string;
        entry: { oid: string; mode: string };
      }
  > {
    if (!args.path) {
      const rootTree = await git.readTree({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: args.commitOid
      });
      return {
        kind: "tree",
        treeOid: rootTree.oid,
        path: "",
        entries: this.mapTreeEntries(rootTree.tree, "")
      };
    }

    const segments = args.path.split("/");
    let currentOid = args.commitOid;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLast = index === segments.length - 1;
      const tree = await git.readTree({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: currentOid
      });
      const entry = tree.tree.find((item) => item.path === segment);
      if (!entry) {
        throw new RepositoryBrowsePathNotFoundError(args.path);
      }

      if (!isLast) {
        if (entry.type !== "tree") {
          throw new RepositoryBrowsePathNotFoundError(args.path);
        }
        currentOid = entry.oid;
        continue;
      }

      if (entry.type === "tree") {
        const targetTree = await git.readTree({
          fs: args.fs as never,
          dir: args.dir,
          gitdir: args.gitdir,
          oid: entry.oid
        });
        return {
          kind: "tree",
          treeOid: entry.oid,
          path: args.path,
          entries: this.mapTreeEntries(targetTree.tree, args.path)
        };
      }

      if (entry.type !== "blob") {
        throw new RepositoryBrowsePathNotFoundError(args.path);
      }
      return {
        kind: "blob",
        path: args.path,
        entry: {
          oid: entry.oid,
          mode: entry.mode
        }
      };
    }

    throw new RepositoryBrowsePathNotFoundError(args.path);
  }

  private async readBlobPreview(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    oid: string;
    mode: string;
    path: string;
  }): Promise<RepositoryFilePreview> {
    const blob = await git.readBlob({
      fs: args.fs as never,
      dir: args.dir,
      gitdir: args.gitdir,
      oid: args.oid
    });
    const size = blob.blob.byteLength;
    const isBinary = looksBinary(blob.blob);
    const truncated = size > MAX_FILE_PREVIEW_BYTES;
    const contentBytes = truncated ? blob.blob.slice(0, MAX_FILE_PREVIEW_BYTES) : blob.blob;
    const content = isBinary ? null : new TextDecoder().decode(contentBytes);

    return {
      path: args.path,
      oid: args.oid,
      mode: args.mode,
      size,
      isBinary,
      truncated,
      content,
      latestCommit: null
    };
  }

  async getRepositoryDetail(input: {
    owner: string;
    repo: string;
    ref?: string;
  }, loadedContext?: LoadedRepositoryContext): Promise<RepositoryDetail> {
    const loaded = await this.ensureLoadedContext(input.owner, input.repo, loadedContext);
    const selectedRef = this.selectRef(input.ref, loaded);

    const headOid = await this.tryResolveCommitOid({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: selectedRef
    });

    const readme = headOid
      ? await this.tryReadReadme({
          fs: loaded.fs,
          dir: loaded.dir,
          gitdir: loaded.gitdir,
          treeOid: headOid,
          directoryPath: ""
        })
      : null;

    return {
      defaultBranch: loaded.defaultBranch,
      selectedRef,
      headOid,
      branches: loaded.branches,
      readme
    };
  }

  async browseRepositoryContents(input: {
    owner: string;
    repo: string;
    ref?: string;
    path?: string;
  }, loadedContext?: LoadedRepositoryContext): Promise<RepositoryBrowseResult> {
    const loaded = await this.ensureLoadedContext(input.owner, input.repo, loadedContext);
    const selectedRef = this.selectRef(input.ref, loaded);
    const headOid = await this.tryResolveCommitOid({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: selectedRef
    });

    const normalizedPath = normalizeRepositoryPath(input.path);
    if (!headOid) {
      return {
        defaultBranch: loaded.defaultBranch,
        selectedRef,
        headOid: null,
        path: normalizedPath,
        kind: "tree",
        entries: [],
        file: null,
        readme: null
      };
    }

    const target = await this.resolveBrowseTarget({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      commitOid: headOid,
      path: normalizedPath
    });

    if (target.kind === "tree") {
      const entries = await this.enrichEntriesWithLatestCommits({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ref: selectedRef,
        entries: target.entries
      });
      const readme = await this.tryReadReadme({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        treeOid: target.treeOid,
        directoryPath: target.path
      });
      return {
        defaultBranch: loaded.defaultBranch,
        selectedRef,
        headOid,
        path: target.path,
        kind: "tree",
        entries,
        file: null,
        readme
      };
    }

    const file = await this.readBlobPreview({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      oid: target.entry.oid,
      mode: target.entry.mode,
      path: target.path
    });
    file.latestCommit = await this.latestCommitForPath({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: selectedRef,
      path: target.path
    });
    return {
      defaultBranch: loaded.defaultBranch,
      selectedRef,
      headOid,
      path: target.path,
      kind: "blob",
      entries: [],
      file,
      readme: null
    };
  }

  async listCommitHistory(input: {
    owner: string;
    repo: string;
    ref?: string;
    limit?: number;
    page?: number;
  }, loadedContext?: LoadedRepositoryContext): Promise<RepositoryCommitHistoryResult> {
    const loaded = await this.ensureLoadedContext(input.owner, input.repo, loadedContext);
    const selectedRef = this.selectRef(input.ref, loaded);
    const perPage = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const page = Math.max(input.page ?? 1, 1);
    if (!selectedRef) {
      return {
        ref: null,
        commits: [],
        pagination: {
          page,
          perPage,
          hasNextPage: false
        }
      };
    }

    const offset = (page - 1) * perPage;
    const depth = offset + perPage + 1;
    let commitsRaw: Array<{
      oid: string;
      commit: {
        message: string;
        parent: string[];
        author: {
          name: string;
          email: string;
          timestamp: number;
          timezoneOffset: number;
        };
        committer: {
          name: string;
          email: string;
          timestamp: number;
          timezoneOffset: number;
        };
      };
    }> = [];

    try {
      commitsRaw = await git.log({
        fs: loaded.fs as never,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ref: selectedRef,
        depth
      });
    } catch {
      return {
        ref: selectedRef,
        commits: [],
        pagination: {
          page,
          perPage,
          hasNextPage: false
        }
      };
    }

    const hasNextPage = commitsRaw.length > offset + perPage;
    const commits = commitsRaw.slice(offset, offset + perPage).map((item) => toCommitSummary(item));

    return {
      ref: selectedRef,
      commits,
      pagination: {
        page,
        perPage,
        hasNextPage
      }
    };
  }

  async listPathHistory(input: {
    owner: string;
    repo: string;
    ref?: string;
    path: string;
    limit?: number;
  }, loadedContext?: LoadedRepositoryContext): Promise<RepositoryPathHistoryResult> {
    const loaded = await this.ensureLoadedContext(input.owner, input.repo, loadedContext);
    const selectedRef = this.selectRef(input.ref, loaded);
    const normalizedPath = normalizeRepositoryPath(input.path);
    if (!selectedRef || !normalizedPath) {
      return {
        ref: selectedRef,
        path: normalizedPath,
        commits: []
      };
    }
    try {
      const commits = await git.log({
        fs: loaded.fs as never,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ref: selectedRef,
        filepath: normalizedPath,
        depth: Math.min(Math.max(input.limit ?? 20, 1), 100)
      });
      return {
        ref: selectedRef,
        path: normalizedPath,
        commits: commits.map((item) => toCommitSummary(item))
      };
    } catch {
      return {
        ref: selectedRef,
        path: normalizedPath,
        commits: []
      };
    }
  }

  async getCommitDetail(input: {
    owner: string;
    repo: string;
    oid: string;
  }, loadedContext?: LoadedRepositoryContext): Promise<RepositoryCommitDetail> {
    const loaded = await this.ensureLoadedContext(input.owner, input.repo, loadedContext);
    const commitData = await git.readCommit({
      fs: loaded.fs as never,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      oid: input.oid
    });
    const previousOid = commitData.commit.parent[0] ?? null;
    const comparison = await diffCommitTrees({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      previousOid,
      nextOid: input.oid
    });
    return {
      commit: toCommitSummary(commitData),
      filesChanged: comparison.filesChanged,
      additions: comparison.additions,
      deletions: comparison.deletions,
      changes: comparison.changes
    };
  }
}
