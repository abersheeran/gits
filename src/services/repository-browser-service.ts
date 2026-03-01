import * as git from "isomorphic-git";
import { loadRepositoryFromStorage } from "./git-repo-loader";
import { StorageService } from "./storage-service";

const OID_REGEX = /^[0-9a-f]{40}$/i;
const README_CANDIDATES = ["readme.md", "readme", "readme.txt", "readme.mkd"];
const MAX_README_BYTES = 200 * 1024;

type RepositoryBranch = {
  name: string;
  oid: string;
};

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
    commitOid: string;
  }): Promise<{ path: string; content: string } | null> {
    try {
      const tree = await git.readTree({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        oid: args.commitOid
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
      return {
        path: entry.path,
        content: new TextDecoder().decode(bytes)
      };
    } catch {
      return null;
    }
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
          commitOid: headOid
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
