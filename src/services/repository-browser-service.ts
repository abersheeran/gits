import * as git from "isomorphic-git";
import { createTwoFilesPatch, diffLines } from "diff";
import { loadRepositoryFromStorage, type RepositorySnapshotStorage } from "./git-repo-loader";
import { StorageService } from "./storage-service";

const OID_REGEX = /^[0-9a-f]{40}$/i;
const README_CANDIDATES = ["readme.md", "readme", "readme.txt", "readme.mkd"];
const MAX_README_BYTES = 200 * 1024;
const MAX_FILE_PREVIEW_BYTES = 512 * 1024;
const BINARY_SAMPLE_BYTES = 8000;
const MAX_DIFF_TEXT_BYTES = 256 * 1024;

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
  latestCommit: CommitSummary | null;
};

export type RepositoryFilePreview = {
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

export type RepositoryCompareChange = {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "deleted";
  mode: string | null;
  previousMode: string | null;
  oid: string | null;
  previousOid: string | null;
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch: string | null;
  hunks: RepositoryDiffHunk[];
  oldContent: string | null;
  newContent: string | null;
};

export type RepositoryDiffLine = {
  kind: "context" | "add" | "delete" | "meta";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type RepositoryDiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: RepositoryDiffLine[];
};

export type RepositoryCommitDetail = {
  commit: CommitSummary;
  filesChanged: number;
  additions: number;
  deletions: number;
  changes: RepositoryCompareChange[];
};

export type RepositoryCompareResult = {
  baseRef: string;
  headRef: string;
  baseOid: string;
  headOid: string;
  mergeBaseOid: string | null;
  mergeable: "mergeable" | "conflicting" | "unknown";
  aheadBy: number;
  behindBy: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  commits: CommitSummary[];
  changes: RepositoryCompareChange[];
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

type FlatTreeEntry = {
  path: string;
  oid: string;
  mode: string;
  type: RepositoryEntryType;
};

type TextBlobInfo = {
  content: string | null;
  isBinary: boolean;
  size: number;
};

function buildSyntheticGitIdentity() {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    name: "gits",
    email: "noreply@gits.local",
    timestamp,
    timezoneOffset: 0
  };
}

const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/;

function parseHunkLineCount(value: string | undefined, start: number): number {
  if (value !== undefined) {
    return Number.parseInt(value, 10);
  }
  return start === 0 ? 0 : 1;
}

function parseUnifiedDiffHunks(patch: string | null): RepositoryDiffHunk[] {
  if (!patch) {
    return [];
  }

  const patchLines = patch.split("\n");
  const hunks: RepositoryDiffHunk[] = [];
  let index = 0;

  while (index < patchLines.length) {
    const headerLine = patchLines[index] ?? "";
    const match = headerLine.match(HUNK_HEADER_REGEX);
    if (!match) {
      index += 1;
      continue;
    }

    const oldStart = Number.parseInt(match[1] ?? "0", 10);
    const oldLines = parseHunkLineCount(match[2], oldStart);
    const newStart = Number.parseInt(match[3] ?? "0", 10);
    const newLines = parseHunkLineCount(match[4], newStart);
    const lines: RepositoryDiffLine[] = [];
    let oldLineNumber = oldStart;
    let newLineNumber = newStart;
    index += 1;

    while (index < patchLines.length) {
      const currentLine = patchLines[index] ?? "";
      if (HUNK_HEADER_REGEX.test(currentLine)) {
        break;
      }
      if (currentLine.startsWith("\\ No newline at end of file")) {
        lines.push({
          kind: "meta",
          content: currentLine,
          oldLineNumber: null,
          newLineNumber: null
        });
        index += 1;
        continue;
      }

      const marker = currentLine[0];
      const content = currentLine.slice(1);
      if (marker === " ") {
        lines.push({
          kind: "context",
          content,
          oldLineNumber,
          newLineNumber
        });
        oldLineNumber += 1;
        newLineNumber += 1;
        index += 1;
        continue;
      }
      if (marker === "+") {
        lines.push({
          kind: "add",
          content,
          oldLineNumber: null,
          newLineNumber
        });
        newLineNumber += 1;
        index += 1;
        continue;
      }
      if (marker === "-") {
        lines.push({
          kind: "delete",
          content,
          oldLineNumber,
          newLineNumber: null
        });
        oldLineNumber += 1;
        index += 1;
        continue;
      }

      if (currentLine.length === 0) {
        index += 1;
        continue;
      }

      lines.push({
        kind: "meta",
        content: currentLine,
        oldLineNumber: null,
        newLineNumber: null
      });
      index += 1;
    }

    hunks.push({
      header: headerLine,
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines
    });
  }

  return hunks;
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

  private async flattenTree(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    oid: string;
    basePath?: string;
    output?: Map<string, FlatTreeEntry>;
  }): Promise<Map<string, FlatTreeEntry>> {
    const output = args.output ?? new Map<string, FlatTreeEntry>();
    const tree = await git.readTree({
      fs: args.fs as never,
      dir: args.dir,
      gitdir: args.gitdir,
      oid: args.oid
    });
    for (const entry of tree.tree) {
      const path = args.basePath ? `${args.basePath}/${entry.path}` : entry.path;
      if (entry.type === "tree") {
        await this.flattenTree({
          fs: args.fs,
          dir: args.dir,
          gitdir: args.gitdir,
          oid: entry.oid,
          basePath: path,
          output
        });
        continue;
      }
      output.set(path, {
        path,
        oid: entry.oid,
        mode: entry.mode,
        type: entry.type
      });
    }
    return output;
  }

  private async readTextBlob(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    oid: string | null;
  }): Promise<TextBlobInfo> {
    if (!args.oid) {
      return {
        content: "",
        isBinary: false,
        size: 0
      };
    }
    const blob = await git.readBlob({
      fs: args.fs as never,
      dir: args.dir,
      gitdir: args.gitdir,
      oid: args.oid
    });
    if (looksBinary(blob.blob)) {
      return {
        content: null,
        isBinary: true,
        size: blob.blob.byteLength
      };
    }
    const limited = blob.blob.byteLength > MAX_DIFF_TEXT_BYTES ? blob.blob.slice(0, MAX_DIFF_TEXT_BYTES) : blob.blob;
    return {
      content: new TextDecoder().decode(limited),
      isBinary: false,
      size: blob.blob.byteLength
    };
  }

  private buildDiffChange(args: {
    path: string;
    previousEntry: FlatTreeEntry | null;
    nextEntry: FlatTreeEntry | null;
    previousText: TextBlobInfo;
    nextText: TextBlobInfo;
  }): RepositoryCompareChange {
    const status =
      args.previousEntry && args.nextEntry
        ? "modified"
        : args.nextEntry
          ? "added"
          : "deleted";
    const isBinary = args.previousText.isBinary || args.nextText.isBinary;
    if (isBinary) {
      return {
        path: args.path,
        previousPath: null,
        status,
        mode: args.nextEntry?.mode ?? null,
        previousMode: args.previousEntry?.mode ?? null,
        oid: args.nextEntry?.oid ?? null,
        previousOid: args.previousEntry?.oid ?? null,
        additions: 0,
        deletions: 0,
        isBinary: true,
        patch: null,
        hunks: [],
        oldContent: null,
        newContent: null
      };
    }

    const oldContent = args.previousText.content ?? "";
    const newContent = args.nextText.content ?? "";
    const changes = diffLines(oldContent, newContent);
    let additions = 0;
    let deletions = 0;
    for (const change of changes) {
      const lineCount = change.count ?? change.value.split("\n").length - 1;
      if (change.added) {
        additions += lineCount;
      } else if (change.removed) {
        deletions += lineCount;
      }
    }

    const patch = createTwoFilesPatch(
      args.path,
      args.path,
      oldContent,
      newContent,
      args.previousEntry?.oid ?? "",
      args.nextEntry?.oid ?? ""
    );

    return {
      path: args.path,
      previousPath: null,
      status,
      mode: args.nextEntry?.mode ?? null,
      previousMode: args.previousEntry?.mode ?? null,
      oid: args.nextEntry?.oid ?? null,
      previousOid: args.previousEntry?.oid ?? null,
      additions,
      deletions,
      isBinary: false,
      patch,
      hunks: parseUnifiedDiffHunks(patch),
      oldContent,
      newContent
    };
  }

  private async compareTrees(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    previousOid: string | null;
    nextOid: string | null;
  }): Promise<{
    filesChanged: number;
    additions: number;
    deletions: number;
    changes: RepositoryCompareChange[];
  }> {
    const previousEntries = args.previousOid
      ? await this.flattenTree({
          fs: args.fs,
          dir: args.dir,
          gitdir: args.gitdir,
          oid: args.previousOid
        })
      : new Map<string, FlatTreeEntry>();
    const nextEntries = args.nextOid
      ? await this.flattenTree({
          fs: args.fs,
          dir: args.dir,
          gitdir: args.gitdir,
          oid: args.nextOid
        })
      : new Map<string, FlatTreeEntry>();
    const paths = Array.from(new Set([...previousEntries.keys(), ...nextEntries.keys()])).sort((left, right) =>
      left.localeCompare(right)
    );

    const changes: RepositoryCompareChange[] = [];
    let additions = 0;
    let deletions = 0;

    for (const path of paths) {
      const previousEntry = previousEntries.get(path) ?? null;
      const nextEntry = nextEntries.get(path) ?? null;
      if (
        previousEntry &&
        nextEntry &&
        previousEntry.oid === nextEntry.oid &&
        previousEntry.mode === nextEntry.mode &&
        previousEntry.type === nextEntry.type
      ) {
        continue;
      }
      const [previousText, nextText] = await Promise.all([
        previousEntry?.type === "blob"
          ? this.readTextBlob({
              fs: args.fs,
              dir: args.dir,
              gitdir: args.gitdir,
              oid: previousEntry.oid
            })
          : Promise.resolve({ content: "", isBinary: false, size: 0 }),
        nextEntry?.type === "blob"
          ? this.readTextBlob({
              fs: args.fs,
              dir: args.dir,
              gitdir: args.gitdir,
              oid: nextEntry.oid
            })
          : Promise.resolve({ content: "", isBinary: false, size: 0 })
      ]);
      const change = this.buildDiffChange({
        path,
        previousEntry,
        nextEntry,
        previousText,
        nextText
      });
      additions += change.additions;
      deletions += change.deletions;
      changes.push(change);
    }

    return {
      filesChanged: changes.length,
      additions,
      deletions,
      changes
    };
  }

  private async listCommitsUntilAncestor(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    ref: string;
    stopOid: string | null;
  }): Promise<CommitSummary[]> {
    const commits = await git.log({
      fs: args.fs as never,
      dir: args.dir,
      gitdir: args.gitdir,
      ref: args.ref,
      depth: 250
    });
    const items: CommitSummary[] = [];
    for (const commit of commits) {
      if (args.stopOid && commit.oid === args.stopOid) {
        break;
      }
      items.push(toCommitSummary(commit));
    }
    return items;
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
    const comparison = await this.compareTrees({
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

  async compareRefs(input: {
    owner: string;
    repo: string;
    baseRef: string;
    headRef: string;
  }, loadedContext?: LoadedRepositoryContext): Promise<RepositoryCompareResult> {
    const loaded = await this.ensureLoadedContext(input.owner, input.repo, loadedContext);
    const baseRef = resolveRefInput(input.baseRef, loaded.branchNames);
    const headRef = resolveRefInput(input.headRef, loaded.branchNames);
    const [baseOid, headOid] = await Promise.all([
      this.tryResolveCommitOid({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ref: baseRef
      }),
      this.tryResolveCommitOid({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ref: headRef
      })
    ]);

    if (!baseOid || !headOid) {
      throw new RepositoryBrowsePathNotFoundError("compare");
    }

    const mergeBases = await git.findMergeBase({
      fs: loaded.fs as never,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      oids: [baseOid, headOid]
    });
    const mergeBaseOid = mergeBases[0] ?? null;
    const mergeable =
      OID_REGEX.test(baseRef) || OID_REGEX.test(headRef)
        ? "unknown"
        : await (async (): Promise<"mergeable" | "conflicting" | "unknown"> => {
            const identity = buildSyntheticGitIdentity();
            try {
              await git.merge({
                fs: loaded.fs as never,
                dir: loaded.dir,
                gitdir: loaded.gitdir,
                ours: baseRef,
                theirs: headRef,
                fastForward: false,
                dryRun: true,
                noUpdateBranch: true,
                abortOnConflict: true,
                author: identity,
                committer: identity
              });
              return "mergeable";
            } catch (error) {
              if (error instanceof git.Errors.MergeConflictError) {
                return "conflicting";
              }
              if (error instanceof git.Errors.MergeNotSupportedError) {
                return "unknown";
              }
              throw error;
            }
          })();

    const [aheadCommits, behindCommits, comparison] = await Promise.all([
      this.listCommitsUntilAncestor({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ref: headRef,
        stopOid: mergeBaseOid
      }),
      this.listCommitsUntilAncestor({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ref: baseRef,
        stopOid: mergeBaseOid
      }),
      this.compareTrees({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        previousOid: mergeBaseOid ?? baseOid,
        nextOid: headOid
      })
    ]);

    return {
      baseRef,
      headRef,
      baseOid,
      headOid,
      mergeBaseOid,
      mergeable,
      aheadBy: aheadCommits.length,
      behindBy: behindCommits.length,
      filesChanged: comparison.filesChanged,
      additions: comparison.additions,
      deletions: comparison.deletions,
      commits: aheadCommits,
      changes: comparison.changes
    };
  }
}
