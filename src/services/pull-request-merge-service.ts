import * as git from "isomorphic-git";
import {
  loadRepositoryFromStorage,
  persistRepositoryToStorage,
  type MutableGitFs
} from "./git-repo-loader";
import { StorageService } from "./storage-service";
import type { AuthUser, PullRequestRecord } from "../types";

export class PullRequestMergeConflictError extends Error {
  constructor() {
    super("Pull request has merge conflicts");
    this.name = "PullRequestMergeConflictError";
  }
}

export class PullRequestMergeBranchNotFoundError extends Error {
  constructor(branchRole: "base" | "head", refName: string) {
    super(`${branchRole === "base" ? "Base" : "Head"} branch not found: ${refName}`);
    this.name = "PullRequestMergeBranchNotFoundError";
  }
}

export class PullRequestMergeNotSupportedError extends Error {
  constructor() {
    super("Squash merge is not supported for this pull request history");
    this.name = "PullRequestMergeNotSupportedError";
  }
}

export type PullRequestSquashMergeResult = {
  baseOid: string;
  headOid: string;
  mergeCommitOid: string;
  createdCommit: boolean;
};

function buildSquashCommitMessage(pullRequest: Pick<PullRequestRecord, "number" | "title" | "body">): string {
  const title = pullRequest.title.trim() || `Pull request #${pullRequest.number}`;
  const summary = `${title} (#${pullRequest.number})`;
  const body = pullRequest.body.trim();
  return body ? `${summary}\n\n${body}` : summary;
}

function buildCommitIdentity(user: AuthUser) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    name: user.username,
    email: `${user.username}@users.noreply.gits.local`,
    timestamp,
    timezoneOffset: new Date().getTimezoneOffset()
  };
}

export class PullRequestMergeService {
  constructor(private readonly storage: StorageService) {}

  private async resolveRequiredRef(args: {
    fs: unknown;
    dir: string;
    gitdir: string;
    ref: string;
    role: "base" | "head";
  }): Promise<string> {
    try {
      return await git.resolveRef({
        fs: args.fs as never,
        dir: args.dir,
        gitdir: args.gitdir,
        ref: args.ref
      });
    } catch {
      throw new PullRequestMergeBranchNotFoundError(args.role, args.ref);
    }
  }

  async squashMergePullRequest(input: {
    owner: string;
    repo: string;
    pullRequest: PullRequestRecord;
    mergedBy: AuthUser;
  }): Promise<PullRequestSquashMergeResult> {
    const loaded = await loadRepositoryFromStorage(this.storage, input.owner, input.repo);
    const baseOid = await this.resolveRequiredRef({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: input.pullRequest.base_ref,
      role: "base"
    });
    const headOid = await this.resolveRequiredRef({
      fs: loaded.fs,
      dir: loaded.dir,
      gitdir: loaded.gitdir,
      ref: input.pullRequest.head_ref,
      role: "head"
    });
    const commitIdentity = buildCommitIdentity(input.mergedBy);

    try {
      const mergeResult = await git.merge({
        fs: loaded.fs as never,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ours: input.pullRequest.base_ref,
        theirs: input.pullRequest.head_ref,
        fastForward: false,
        noUpdateBranch: true,
        abortOnConflict: true,
        author: commitIdentity,
        committer: commitIdentity
      });

      if (mergeResult.alreadyMerged) {
        return {
          baseOid,
          headOid,
          mergeCommitOid: mergeResult.oid ?? baseOid,
          createdCommit: false
        };
      }

      if (!mergeResult.tree) {
        throw new PullRequestMergeNotSupportedError();
      }

      const mergeCommitOid = await git.commit({
        fs: loaded.fs as never,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        ref: input.pullRequest.base_ref,
        message: buildSquashCommitMessage(input.pullRequest),
        tree: mergeResult.tree,
        parent: [baseOid],
        author: commitIdentity,
        committer: commitIdentity
      });

      await persistRepositoryToStorage({
        storage: this.storage,
        fs: loaded.fs as MutableGitFs,
        gitdir: loaded.gitdir,
        owner: input.owner,
        repo: input.repo
      });

      return {
        baseOid: mergeCommitOid,
        headOid,
        mergeCommitOid,
        createdCommit: true
      };
    } catch (error) {
      if (error instanceof git.Errors.MergeConflictError) {
        throw new PullRequestMergeConflictError();
      }
      if (error instanceof git.Errors.MergeNotSupportedError) {
        throw new PullRequestMergeNotSupportedError();
      }
      throw error;
    }
  }
}
