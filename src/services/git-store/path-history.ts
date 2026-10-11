import { GitObjectNotFoundError, type ObjectStore } from "./object-store";

export const MAX_PATH_HISTORY_COMMITS = 10000;
export type ReadCommit = ReturnType<ObjectStore["readCommit"]>;

export class PathHistory {
  readonly commits: ReadCommit[] = [];
  done = false;
  private lastFileOid: string | null = null;
  private lastCommit: ReadCommit | undefined;

  constructor(
    private readonly path: string,
    private readonly depth: number
  ) {
  }

  visit(commit: ReadCommit, oid: string | null): void {
    if (oid === null) {
      if (!this.lastCommit) {
        throw new GitObjectNotFoundError(this.path);
      }
      this.commits.push(this.lastCommit);
      this.done = true;
      return;
    }
    if (this.lastCommit && this.lastFileOid !== oid) {
      this.commits.push(this.lastCommit);
    }
    this.lastFileOid = oid;
    this.lastCommit = commit;
    if (this.commits.length >= this.depth) {
      this.commits.push(commit);
      this.done = true;
    }
  }

  finish(): void {
    if (this.lastCommit && !this.done) {
      this.commits.push(this.lastCommit);
    }
    this.done = true;
  }
}
