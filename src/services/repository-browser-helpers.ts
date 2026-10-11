import {
  RepositoryBrowseInvalidPathError,
  type CommitSummary,
  type RepositoryTreeEntry
} from "./repository-browser-types";

export function normalizeRepositoryPath(input?: string): string {
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

export function sortTreeEntries(entries: RepositoryTreeEntry[]): RepositoryTreeEntry[] {
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

export function toCommitSummary(commit: {
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
