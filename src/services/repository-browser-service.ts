import { GitObjectTooLargeError, ObjectStore } from "./git-store/object-store";
import { RefStore } from "./git-store/ref-store";
import { RepositoryGraph } from "./git-store/repository-graph";
import {
  normalizeRepositoryPath,
  sortTreeEntries,
  toCommitSummary
} from "./repository-browser-helpers";
import {
  RepositoryBrowsePathNotFoundError,
  type RepositoryBrowseResult,
  type RepositoryCommitDetail,
  type RepositoryCommitHistoryResult,
  type RepositoryDetail,
  type RepositoryFilePreview,
  type RepositoryPathHistoryResult
} from "./repository-browser-types";
import { diffCommitTrees, looksBinary } from "./repository-diff";

export * from "./repository-browser-types";
type BrowseInput = { owner: string; repo: string; ref?: string };
const README_CANDIDATES = ["readme.md", "readme", "readme.txt", "readme.mkd"];

export class RepositoryBrowserService {
  readonly graph: RepositoryGraph;

  constructor(
    private readonly store: ObjectStore,
    private readonly refs: RefStore
  ) {
    this.graph = new RepositoryGraph(store, refs);
  }

  private context(ref?: string) {
    const branches = this.refs.listRefs("refs/heads/").map((item) => ({
      name: item.name.slice(11),
      oid: item.oid
    }));
    const head = this.refs.getHead();
    const defaultBranch = head?.startsWith("ref: ")
      ? head.slice(5).replace(/^refs\/heads\//, "")
      : (branches[0]?.name ?? null);
    let selectedRef = ref || (defaultBranch ? `refs/heads/${defaultBranch}` : null);
    if (selectedRef && /^[0-9a-f]{40}$/i.test(selectedRef)) {
      selectedRef = selectedRef.toLowerCase();
    } else if (branches.some((branch) => branch.name === selectedRef)) {
      selectedRef = `refs/heads/${selectedRef}`;
    }
    let headOid: string | null = null;
    try {
      headOid = selectedRef ? this.graph.resolveRef(selectedRef) : null;
    } catch {
      headOid = null;
    }
    return { branches, defaultBranch, selectedRef, headOid };
  }

  private latest(ref: string | null, path: string) {
    try {
      const commit = ref ? this.graph.log(ref, 1, path)[0] : null;
      return commit ? toCommitSummary(commit) : null;
    } catch {
      return null;
    }
  }

  private readme(oid: string, directory: string) {
    try {
      const entry = this.graph
        .readTree(oid)
        .tree.find(
          (item) => item.type === "blob" && README_CANDIDATES.includes(item.path.toLowerCase())
        );
      if (!entry) {
        return null;
      }
      const preview = this.store.readPrefix(entry.oid, 200 * 1024);
      if (looksBinary(preview.content)) {
        return null;
      }
      return {
        path: directory ? `${directory}/${entry.path}` : entry.path,
        content: new TextDecoder().decode(preview.content)
      };
    } catch {
      return null;
    }
  }

  private preview(oid: string, mode: string, path: string): RepositoryFilePreview {
    const header = this.store.readHeader(oid);
    if (!header) {
      throw new RepositoryBrowsePathNotFoundError(path);
    }
    try {
      const preview = this.store.readPrefix(oid, 512 * 1024);
      const isBinary = looksBinary(preview.content);
      return {
        path,
        oid,
        mode,
        size: preview.size,
        isBinary,
        truncated: preview.truncated,
        content: isBinary ? null : new TextDecoder().decode(preview.content),
        latestCommit: null
      };
    } catch (error) {
      if (!(error instanceof GitObjectTooLargeError)) {
        throw error;
      }
      return {
        path,
        oid,
        mode,
        size: header.size,
        isBinary: true,
        truncated: true,
        content: null,
        latestCommit: null
      };
    }
  }

  async getRepositoryDetail(input: BrowseInput): Promise<RepositoryDetail> {
    const context = this.context(input.ref);
    return {
      ...context,
      readme: context.headOid ? this.readme(context.headOid, "") : null
    };
  }

  async browseRepositoryContents(
    input: BrowseInput & { path?: string }
  ): Promise<RepositoryBrowseResult> {
    const { defaultBranch, selectedRef, headOid } = this.context(input.ref);
    const path = normalizeRepositoryPath(input.path);
    const base = { defaultBranch, selectedRef, headOid, path };
    if (!headOid) {
      return { ...base, kind: "tree", entries: [], file: null, readme: null };
    }
    const entry = path ? this.graph.entry(headOid, path) : null;
    if (path && (!entry || entry.type === "commit")) {
      throw new RepositoryBrowsePathNotFoundError(path);
    }
    if (entry?.type === "blob") {
      const file = this.preview(entry.oid, entry.mode, path);
      file.latestCommit = this.latest(selectedRef, path);
      return { ...base, kind: "blob", entries: [], file, readme: null };
    }
    const tree = this.graph.readTree(entry?.oid ?? headOid);
    const paths = tree.tree.map((item) => (path ? `${path}/${item.path}` : item.path));
    const latest = this.graph.latestCommits(selectedRef ?? headOid, paths);
    const entries = sortTreeEntries(
      tree.tree.map((item) => {
        const fullPath = path ? `${path}/${item.path}` : item.path;
        return {
          name: item.path,
          path: fullPath,
          oid: item.oid,
          mode: item.mode,
          type: item.type,
          latestCommit: latest.get(fullPath) ? toCommitSummary(latest.get(fullPath)!) : null
        };
      })
    );
    return {
      ...base,
      kind: "tree",
      entries,
      file: null,
      readme: this.readme(tree.oid, path)
    };
  }

  async listCommitHistory(
    input: BrowseInput & { limit?: number; page?: number }
  ): Promise<RepositoryCommitHistoryResult> {
    const { selectedRef } = this.context(input.ref);
    const perPage = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const page = Math.max(input.page ?? 1, 1);
    const offset = (page - 1) * perPage;
    let commits: ReturnType<RepositoryGraph["log"]> = [];
    try {
      commits = selectedRef ? this.graph.log(selectedRef, offset + perPage + 1) : [];
    } catch {
      commits = [];
    }
    return {
      ref: selectedRef,
      commits: commits.slice(offset, offset + perPage).map(toCommitSummary),
      pagination: { page, perPage, hasNextPage: commits.length > offset + perPage }
    };
  }

  async listPathHistory(
    input: BrowseInput & { path: string; limit?: number }
  ): Promise<RepositoryPathHistoryResult> {
    const { selectedRef } = this.context(input.ref);
    const path = normalizeRepositoryPath(input.path);
    try {
      const commits =
        selectedRef && path
          ? this.graph.log(selectedRef, Math.min(Math.max(input.limit ?? 20, 1), 100), path)
          : [];
      return { ref: selectedRef, path, commits: commits.map(toCommitSummary) };
    } catch {
      return { ref: selectedRef, path, commits: [] };
    }
  }

  async getCommitDetail(input: BrowseInput & { oid: string }): Promise<RepositoryCommitDetail> {
    const commit = this.graph.readCommit(input.oid);
    const comparison = await diffCommitTrees({
      graph: this.graph,
      previousOid: commit.commit.parent[0] ?? null,
      nextOid: input.oid
    });
    return { commit: toCommitSummary(commit), ...comparison };
  }
}
