import * as git from "isomorphic-git";
import { loadRepositoryFromStorage } from "./git-repo-loader";
import { StorageService } from "./storage-service";

const OID_REGEX = /^[0-9a-f]{40}$/i;
const README_CANDIDATES = ["readme.md", "readme", "readme.txt", "readme.mkd"];
const MAX_README_BYTES = 200 * 1024;
const MAX_FILE_PREVIEW_BYTES = 512 * 1024;
const BINARY_SAMPLE_BYTES = 8000;

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

export type CommitSummary = {
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

export type RepositoryTreeEntry = {
  name: string;
  path: string;
  oid: string;
  mode: string;
  type: RepositoryEntryType;
};

export type RepositoryFilePreview = {
  path: string;
  oid: string;
  mode: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
  content: string | null;
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

function looksBinary(content: Uint8Array): boolean {
  const sample = content.subarray(0, Math.min(content.length, BINARY_SAMPLE_BYTES));
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) {
      return true;
    }
  }
  return false;
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

export class RepositoryBrowserService {
  constructor(private readonly storage: StorageService) {}

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
        type: item.type
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
      content
    };
  }

  async getRepositoryDetail(input: {
    owner: string;
    repo: string;
    ref?: string;
  }): Promise<RepositoryDetail> {
    const loaded = await loadRepositoryFromStorage(this.storage, input.owner, input.repo);
    const branches = loaded.headRefs.map((item) => ({
      name: stripHeadsPrefix(item.name),
      oid: item.oid
    }));
    const branchNames = new Set(branches.map((item) => item.name));

    const defaultBranch = branchNameFromHead(loaded.head) ?? branches[0]?.name ?? null;
    const selectedRef =
      (input.ref && resolveRefInput(input.ref, branchNames)) ||
      (defaultBranch ? `refs/heads/${defaultBranch}` : null);

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
      defaultBranch,
      selectedRef,
      headOid,
      branches,
      readme
    };
  }

  async browseRepositoryContents(input: {
    owner: string;
    repo: string;
    ref?: string;
    path?: string;
  }): Promise<RepositoryBrowseResult> {
    const loaded = await loadRepositoryFromStorage(this.storage, input.owner, input.repo);
    const branches = loaded.headRefs.map((item) => ({
      name: stripHeadsPrefix(item.name),
      oid: item.oid
    }));
    const branchNames = new Set(branches.map((item) => item.name));
    const defaultBranch = branchNameFromHead(loaded.head) ?? branches[0]?.name ?? null;
    const selectedRef =
      (input.ref && resolveRefInput(input.ref, branchNames)) ||
      (defaultBranch ? `refs/heads/${defaultBranch}` : null);
    const headOid = await this.tryResolveCommitOid({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: selectedRef
    });

    const normalizedPath = normalizeRepositoryPath(input.path);
    if (!headOid) {
      return {
        defaultBranch,
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
      const readme = await this.tryReadReadme({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        treeOid: target.treeOid,
        directoryPath: target.path
      });
      return {
        defaultBranch,
        selectedRef,
        headOid,
        path: target.path,
        kind: "tree",
        entries: target.entries,
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
    return {
      defaultBranch,
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
  }): Promise<{ ref: string | null; commits: CommitSummary[] }> {
    const loaded = await loadRepositoryFromStorage(this.storage, input.owner, input.repo);
    const branches = loaded.headRefs.map((item) => stripHeadsPrefix(item.name));
    const branchNames = new Set(branches);
    const defaultBranch = branchNameFromHead(loaded.head) ?? branches[0] ?? null;
    const selectedRef =
      (input.ref && resolveRefInput(input.ref, branchNames)) ||
      (defaultBranch ? `refs/heads/${defaultBranch}` : null);
    if (!selectedRef) {
      return {
        ref: null,
        commits: []
      };
    }

    const depth = Math.min(Math.max(input.limit ?? 20, 1), 100);
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
        commits: []
      };
    }

    return {
      ref: selectedRef,
      commits: commitsRaw.map((item) => ({
        oid: item.oid,
        message: item.commit.message,
        author: item.commit.author,
        committer: item.commit.committer,
        parents: item.commit.parent
      }))
    };
  }
}
