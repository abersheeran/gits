import type { RepositoryDiffChange } from "./repository-diff";

export type RepositoryBranch = {
  name: string;
  oid: string;
};

export type RepositoryEntryType = "tree" | "blob" | "commit";

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
