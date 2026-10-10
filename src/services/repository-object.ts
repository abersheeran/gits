import { HTTPException } from "hono/http-exception";
import type { LoadedRepositoryContext } from "./repository-browser-service";
import {
  buildLoadedRepositoryContext,
  RepositoryBrowserService,
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError
} from "./repository-browser-service";
import {
  clearRepositorySnapshot,
  listRepositoryRefsFromFs,
  persistRepositoryToStorage,
  syncLoadedRepositoryHeadState,
  type MutableGitFs,
  type RepositorySnapshotStorage
} from "./git-repo-loader";
import { GitService } from "./git-service";
import * as git from "isomorphic-git";
import { StorageService } from "./storage-service";
import type { GitServiceName } from "../types";
import type { AppBindings } from "../types";
import type {
  RepositoryObjectJsonRequest,
  RepositoryBranchMutationResult,
  RepositoryObjectErrorCode,
  RepositoryObjectErrorPayload
} from "./repository-object-protocol";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function errorResponse(
  status: number,
  error: RepositoryObjectErrorCode,
  message: string
): Response {
  return jsonResponse({ error, message } satisfies RepositoryObjectErrorPayload, status);
}

function isGitServiceName(value: string | null): value is GitServiceName {
  return value === "git-upload-pack" || value === "git-receive-pack";
}

function selectDefaultBranchRef(
  context: Pick<LoadedRepositoryContext, "head" | "headRefs">
): string | null {
  if (context.headRefs.length === 0) {
    return null;
  }
  const headRef = context.head?.startsWith("ref: ")
    ? context.head.slice("ref: ".length).trim()
    : null;
  const selected =
    (headRef ? context.headRefs.find((item) => item.name === headRef) : undefined) ??
    context.headRefs.find((item) => item.name === "refs/heads/main") ??
    context.headRefs[0];
  return selected?.name ?? null;
}

function isValidBranchName(value: string): boolean {
  if (!value.length || value.startsWith("/") || value.endsWith("/")) {
    return false;
  }
  if (value.includes("..") || value.includes("\\") || value.includes("@{") || value.includes("//")) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.startsWith(".") &&
      !segment.endsWith(".") &&
      !segment.endsWith(".lock") &&
      !/[\u0000-\u001f\u007f ~^:?*\[]/.test(segment)
  );
}

function resolveBranchRefName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string` });
  }
  const branch = value.trim();
  if (!branch) {
    throw new HTTPException(400, { message: `Field '${field}' is required` });
  }
  if (branch.startsWith("refs/heads/")) {
    const name = branch.slice("refs/heads/".length);
    if (!isValidBranchName(name)) {
      throw new HTTPException(400, { message: `Field '${field}' must be a valid branch name` });
    }
    return `refs/heads/${name}`;
  }
  if (branch.startsWith("refs/")) {
    throw new HTTPException(400, {
      message: `Field '${field}' must be a branch name or refs/heads/*`
    });
  }
  if (!isValidBranchName(branch)) {
    throw new HTTPException(400, { message: `Field '${field}' must be a valid branch name` });
  }
  return `refs/heads/${branch}`;
}

function normalizeCommitOid(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string` });
  }
  const oid = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(oid)) {
    throw new HTTPException(400, { message: `Field '${field}' must be a 40-character commit oid` });
  }
  return oid;
}

export class RepositoryObject {
  private readonly storage: StorageService;

  private readonly snapshotStorage?: RepositorySnapshotStorage;

  private readonly browserService: RepositoryBrowserService;

  private readonly gitService: GitService;

  private cachedContext: LoadedRepositoryContext | null = null;

  private cachedOwner: string | null = null;

  private cachedRepo: string | null = null;

  private hydratePromise: Promise<LoadedRepositoryContext> | null = null;

  private hydrateOwner: string | null = null;

  private hydrateRepo: string | null = null;

  constructor(
    state: DurableObjectState<unknown>,
    env: AppBindings
  ) {
    this.snapshotStorage = state.storage as RepositorySnapshotStorage;
    this.storage = new StorageService(env.GIT_BUCKET);
    this.browserService = new RepositoryBrowserService(this.storage, this.snapshotStorage);
    this.gitService = new GitService({} as never, this.storage, this.snapshotStorage);
  }

  private rememberContext(
    owner: string,
    repo: string,
    context: LoadedRepositoryContext
  ): LoadedRepositoryContext {
    this.cachedOwner = owner;
    this.cachedRepo = repo;
    this.cachedContext = context;
    return context;
  }

  private clearCachedContext(owner?: string, repo?: string): void {
    if (
      owner !== undefined &&
      repo !== undefined &&
      (this.cachedOwner !== owner || this.cachedRepo !== repo)
    ) {
      return;
    }
    this.cachedOwner = null;
    this.cachedRepo = null;
    this.cachedContext = null;
  }

  private async ensureLoadedContext(owner: string, repo: string): Promise<LoadedRepositoryContext> {
    if (this.cachedContext && this.cachedOwner === owner && this.cachedRepo === repo) {
      return this.cachedContext;
    }
    if (this.hydratePromise && this.hydrateOwner === owner && this.hydrateRepo === repo) {
      return this.hydratePromise;
    }

    const hydratePromise = this.browserService.loadRepositoryContext(owner, repo).then((context) =>
      this.rememberContext(owner, repo, context)
    );

    this.hydratePromise = hydratePromise;
    this.hydrateOwner = owner;
    this.hydrateRepo = repo;

    try {
      return await hydratePromise;
    } finally {
      if (this.hydratePromise === hydratePromise) {
        this.hydratePromise = null;
        this.hydrateOwner = null;
        this.hydrateRepo = null;
      }
    }
  }

  private refreshContext(owner: string, repo: string, context: LoadedRepositoryContext): void {
    this.rememberContext(owner, repo, buildLoadedRepositoryContext(context));
  }

  private async persistMutatedRepository(args: {
    owner: string;
    repo: string;
    context: LoadedRepositoryContext;
  }): Promise<RepositoryBranchMutationResult> {
    await persistRepositoryToStorage({
      storage: this.storage,
      fs: args.context.fs as MutableGitFs,
      gitdir: args.context.gitdir,
      owner: args.owner,
      repo: args.repo,
      ...(this.snapshotStorage ? { snapshotStorage: this.snapshotStorage } : {})
    });
    await syncLoadedRepositoryHeadState(args.context);
    this.refreshContext(args.owner, args.repo, args.context);
    const updatedRefs = await listRepositoryRefsFromFs({
      fs: args.context.fs as MutableGitFs,
      gitdir: args.context.gitdir,
      prefix: "refs/heads"
    });
    return {
      defaultBranch: buildLoadedRepositoryContext(args.context).defaultBranch,
      branches: updatedRefs
    };
  }

  private async createBranch(args: {
    owner: string;
    repo: string;
    branchRef: string;
    sourceOid: string;
  }): Promise<RepositoryBranchMutationResult> {
    const context = await this.ensureLoadedContext(args.owner, args.repo);
    const branchExists = context.headRefs.some((item) => item.name === args.branchRef);
    if (branchExists) {
      throw new HTTPException(409, { message: "Branch already exists" });
    }
    const hasPrefixConflict = context.headRefs.some(
      (item) => item.name.startsWith(`${args.branchRef}/`) || args.branchRef.startsWith(`${item.name}/`)
    );
    if (hasPrefixConflict) {
      throw new HTTPException(409, { message: "Branch name conflicts with an existing branch path" });
    }
    try {
      const object = await git.readObject({
        fs: context.fs as never,
        dir: context.dir,
        gitdir: context.gitdir,
        oid: args.sourceOid
      });
      if (object.type !== "commit") {
        throw new HTTPException(400, { message: "Source revision must point to a commit" });
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(404, { message: "Source commit not found" });
    }

    const fs = context.fs as MutableGitFs;
    const branchRefDir = args.branchRef.split("/").slice(0, -1).join("/");
    await fs.promises.mkdir(`${context.gitdir}/${branchRefDir}`, { recursive: true });
    await git.writeRef({
      fs: context.fs as never,
      dir: context.dir,
      gitdir: context.gitdir,
      ref: args.branchRef,
      value: args.sourceOid,
      force: false
    });

    return this.persistMutatedRepository({
      owner: args.owner,
      repo: args.repo,
      context
    });
  }

  private async setDefaultBranch(args: {
    owner: string;
    repo: string;
    branchRef: string;
  }): Promise<RepositoryBranchMutationResult> {
    const context = await this.ensureLoadedContext(args.owner, args.repo);
    const branchExists = context.headRefs.some((item) => item.name === args.branchRef);
    if (!branchExists) {
      throw new HTTPException(404, { message: "Branch not found" });
    }
    const fs = context.fs as MutableGitFs;
    await fs.promises.writeFile(`${context.gitdir}/HEAD`, `ref: ${args.branchRef}\n`);
    return this.persistMutatedRepository({
      owner: args.owner,
      repo: args.repo,
      context
    });
  }

  private async deleteBranch(args: {
    owner: string;
    repo: string;
    branchRef: string;
  }): Promise<RepositoryBranchMutationResult> {
    const context = await this.ensureLoadedContext(args.owner, args.repo);
    const branch = context.headRefs.find((item) => item.name === args.branchRef);
    if (!branch) {
      throw new HTTPException(404, { message: "Branch not found" });
    }
    const defaultRef = selectDefaultBranchRef(context);
    if (defaultRef === args.branchRef) {
      throw new HTTPException(409, { message: "Default branch cannot be deleted" });
    }
    if (context.headRefs.length <= 1) {
      throw new HTTPException(409, { message: "Repository must keep at least one branch" });
    }

    const fs = context.fs as MutableGitFs;
    await fs.promises.rm(`${context.gitdir}/${args.branchRef}`, { force: true });
    return this.persistMutatedRepository({
      owner: args.owner,
      repo: args.repo,
      context
    });
  }

  private async handleJsonRequest(request: Request): Promise<Response> {
    let jsonRequest: RepositoryObjectJsonRequest;
    try {
      jsonRequest = (await request.json()) as RepositoryObjectJsonRequest;
    } catch {
      return errorResponse(400, "bad_request", "Invalid JSON payload");
    }

    const payload = jsonRequest.payload ?? {};
    try {
      switch (jsonRequest.operation) {
        case "list-head-refs": {
          const context = await this.ensureLoadedContext(
            String(payload.owner ?? ""),
            String(payload.repo ?? "")
          );
          return jsonResponse({ branches: context.headRefs });
        }
        case "create-branch": {
          return jsonResponse(
            await this.createBranch({
              owner: String(payload.owner ?? ""),
              repo: String(payload.repo ?? ""),
              branchRef: resolveBranchRefName(payload.branchName, "branchName"),
              sourceOid: normalizeCommitOid(payload.sourceOid, "sourceOid")
            }),
            201
          );
        }
        case "set-default-branch": {
          return jsonResponse(
            await this.setDefaultBranch({
              owner: String(payload.owner ?? ""),
              repo: String(payload.repo ?? ""),
              branchRef: resolveBranchRefName(payload.branchName, "branchName")
            })
          );
        }
        case "delete-branch": {
          return jsonResponse(
            await this.deleteBranch({
              owner: String(payload.owner ?? ""),
              repo: String(payload.repo ?? ""),
              branchRef: resolveBranchRefName(payload.branchName, "branchName")
            })
          );
        }
        case "get-repository-detail": {
          const result = await this.browserService.getRepositoryDetail(
            {
              owner: String(payload.owner ?? ""),
              repo: String(payload.repo ?? ""),
              ...(typeof payload.ref === "string" ? { ref: payload.ref } : {})
            },
            await this.ensureLoadedContext(String(payload.owner ?? ""), String(payload.repo ?? ""))
          );
          return jsonResponse(result);
        }
        case "browse-repository-contents": {
          const owner = String(payload.owner ?? "");
          const repo = String(payload.repo ?? "");
          const result = await this.browserService.browseRepositoryContents(
            {
              owner,
              repo,
              ...(typeof payload.ref === "string" ? { ref: payload.ref } : {}),
              ...(typeof payload.path === "string" ? { path: payload.path } : {})
            },
            await this.ensureLoadedContext(owner, repo)
          );
          return jsonResponse(result);
        }
        case "list-commit-history": {
          const owner = String(payload.owner ?? "");
          const repo = String(payload.repo ?? "");
          const result = await this.browserService.listCommitHistory(
            {
              owner,
              repo,
              ...(typeof payload.ref === "string" ? { ref: payload.ref } : {}),
              ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
              ...(typeof payload.page === "number" ? { page: payload.page } : {})
            },
            await this.ensureLoadedContext(owner, repo)
          );
          return jsonResponse(result);
        }
        case "list-path-history": {
          const owner = String(payload.owner ?? "");
          const repo = String(payload.repo ?? "");
          const result = await this.browserService.listPathHistory(
            {
              owner,
              repo,
              path: String(payload.path ?? ""),
              ...(typeof payload.ref === "string" ? { ref: payload.ref } : {}),
              ...(typeof payload.limit === "number" ? { limit: payload.limit } : {})
            },
            await this.ensureLoadedContext(owner, repo)
          );
          return jsonResponse(result);
        }
        case "get-commit-detail": {
          const owner = String(payload.owner ?? "");
          const repo = String(payload.repo ?? "");
          const result = await this.browserService.getCommitDetail(
            {
              owner,
              repo,
              oid: String(payload.oid ?? "")
            },
            await this.ensureLoadedContext(owner, repo)
          );
          return jsonResponse(result);
        }
        case "initialize-repository": {
          await this.storage.initializeRepository(
            String(payload.owner ?? ""),
            String(payload.repo ?? ""),
            typeof payload.defaultBranch === "string" ? payload.defaultBranch : undefined
          );
          this.clearCachedContext();
          if (this.snapshotStorage) {
            await clearRepositorySnapshot(this.snapshotStorage);
          }
          return jsonResponse({ ok: true }, 201);
        }
        case "rename-repository": {
          const owner = String(payload.owner ?? "");
          const repo = String(payload.repo ?? "");
          const nextRepo = String(payload.nextRepo ?? "");
          await this.storage.renameRepository(owner, repo, nextRepo);
          if (this.cachedContext && this.cachedOwner === owner && this.cachedRepo === repo) {
            this.cachedRepo = nextRepo;
          }
          return jsonResponse({ ok: true });
        }
        case "delete-repository": {
          const owner = String(payload.owner ?? "");
          const repo = String(payload.repo ?? "");
          await this.storage.deleteRepository(owner, repo);
          this.clearCachedContext(owner, repo);
          if (this.snapshotStorage) {
            await clearRepositorySnapshot(this.snapshotStorage);
          }
          return jsonResponse({ ok: true });
        }
        default:
          return errorResponse(400, "bad_request", "Unsupported repository object operation");
      }
    } catch (error) {
      if (error instanceof RepositoryBrowseInvalidPathError) {
        return errorResponse(400, "path_invalid", error.message);
      }
      if (error instanceof RepositoryBrowsePathNotFoundError) {
        return errorResponse(404, "path_not_found", error.message);
      }
      throw error;
    }
  }

  private async handleInfoRefs(url: URL): Promise<Response> {
    const service = url.searchParams.get("service");
    if (!isGitServiceName(service)) {
      return errorResponse(400, "git_service_invalid", "Invalid git service");
    }
    const owner = url.searchParams.get("owner") ?? "";
    const repo = url.searchParams.get("repo") ?? "";
    return this.gitService.handleInfoRefsWithLoaded({
      loaded: await this.ensureLoadedContext(owner, repo),
      service
    });
  }

  private async handleUploadPack(request: Request, url: URL): Promise<Response> {
    const owner = url.searchParams.get("owner") ?? "";
    const repo = url.searchParams.get("repo") ?? "";
    return this.gitService.handleUploadPackWithLoaded({
      body: await request.arrayBuffer(),
      loaded: await this.ensureLoadedContext(owner, repo)
    });
  }

  private async handleReceivePack(request: Request, url: URL): Promise<Response> {
    const owner = url.searchParams.get("owner") ?? "";
    const repo = url.searchParams.get("repo") ?? "";
    const context = await this.ensureLoadedContext(owner, repo);
    const result = await this.gitService.handleReceivePackWithLoaded({
      owner,
      repo,
      body: await request.arrayBuffer(),
      loaded: context
    });
    if (result.repositoryUpdated) {
      this.refreshContext(owner, repo, context);
    }
    return result.response;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/json") {
        return await this.handleJsonRequest(request);
      }
      if (request.method === "GET" && url.pathname === "/git/info/refs") {
        return await this.handleInfoRefs(url);
      }
      if (request.method === "POST" && url.pathname === "/git/upload-pack") {
        return await this.handleUploadPack(request, url);
      }
      if (request.method === "POST" && url.pathname === "/git/receive-pack") {
        return await this.handleReceivePack(request, url);
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof HTTPException) {
        return error.getResponse();
      }
      throw error;
    }
  }
}
