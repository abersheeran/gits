import { HTTPException } from "hono/http-exception";
import type {
  CommitSummary,
  LoadedRepositoryContext,
  RepositoryBrowseResult,
  RepositoryCompareResult,
  RepositoryCommitDetail,
  RepositoryDetail,
  RepositoryPathHistoryResult
} from "./repository-browser-service";
import {
  buildLoadedRepositoryContext,
  RepositoryBrowserService,
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError
} from "./repository-browser-service";
import { GitService } from "./git-service";
import {
  PullRequestMergeBranchNotFoundError,
  PullRequestMergeConflictError,
  PullRequestMergeNotSupportedError,
  PullRequestMergeService,
  type PullRequestSquashMergeResult
} from "./pull-request-merge-service";
import { StorageService } from "./storage-service";
import type { AuthUser, GitServiceName, PullRequestRecord } from "../types";
import type { RepositoryComparisonReader } from "./pull-request-review-thread-anchor-service";
import type { AppBindings } from "../types";

type RepositoryObjectJsonOperation =
  | "browse-repository-contents"
  | "compare-refs"
  | "delete-repository"
  | "get-commit-detail"
  | "get-repository-detail"
  | "initialize-repository"
  | "list-commit-history"
  | "list-head-refs"
  | "list-path-history"
  | "rename-repository"
  | "resolve-default-branch-target"
  | "squash-merge-pull-request";

type RepositoryObjectJsonRequest = {
  operation: RepositoryObjectJsonOperation;
  payload: Record<string, unknown>;
};

type RepositoryHeadRef = { name: string; oid: string };

type RepositoryDefaultBranchTarget = {
  ref: string | null;
  sha: string | null;
};

type ReceivePackResponse = {
  repositoryUpdated: boolean;
  response: Response;
  updatedRefs: RepositoryHeadRef[];
};

type RepositoryObjectErrorCode =
  | "bad_request"
  | "git_service_invalid"
  | "merge_branch_not_found"
  | "merge_conflict"
  | "merge_not_supported"
  | "path_invalid"
  | "path_not_found";

type RepositoryObjectErrorPayload = {
  error: RepositoryObjectErrorCode;
  message: string;
};

const UPDATED_REFS_HEADER = "x-gits-updated-refs";
const REPOSITORY_UPDATED_HEADER = "x-gits-repository-updated";

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

function cloneResponseWithoutHeaders(response: Response, headerNames: string[]): Response {
  const headers = new Headers(response.headers);
  for (const headerName of headerNames) {
    headers.delete(headerName);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeUpdatedRefsHeader(refs: RepositoryHeadRef[]): string {
  return encodeBase64Utf8(JSON.stringify(refs));
}

function decodeUpdatedRefsHeader(value: string | null): RepositoryHeadRef[] {
  if (!value) {
    return [];
  }
  try {
    const decoded = decodeBase64Utf8(value);
    const parsed = JSON.parse(decoded) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((item) => {
      if (
        item &&
        typeof item === "object" &&
        typeof item.name === "string" &&
        typeof item.oid === "string"
      ) {
        return [{ name: item.name, oid: item.oid }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function isGitServiceName(value: string | null): value is GitServiceName {
  return value === "git-upload-pack" || value === "git-receive-pack";
}

function selectDefaultBranchTarget(
  context: Pick<LoadedRepositoryContext, "head" | "headRefs">
): RepositoryDefaultBranchTarget {
  if (context.headRefs.length === 0) {
    return { ref: null, sha: null };
  }
  const headRef = context.head?.startsWith("ref: ")
    ? context.head.slice("ref: ".length).trim()
    : null;
  const selected =
    (headRef ? context.headRefs.find((item) => item.name === headRef) : undefined) ??
    context.headRefs.find((item) => item.name === "refs/heads/main") ??
    context.headRefs[0];
  return {
    ref: selected?.name ?? null,
    sha: selected?.oid ?? null
  };
}

async function parseRepositoryObjectError(response: Response): Promise<RepositoryObjectErrorPayload> {
  try {
    return (await response.json()) as RepositoryObjectErrorPayload;
  } catch {
    return {
      error: "bad_request",
      message: response.statusText || "Repository object request failed"
    };
  }
}

export class RepositoryObject {
  private readonly storage: StorageService;

  private readonly browserService: RepositoryBrowserService;

  private readonly gitService: GitService;

  private readonly mergeService: PullRequestMergeService;

  private cachedContext: LoadedRepositoryContext | null = null;

  private cachedOwner: string | null = null;

  private cachedRepo: string | null = null;

  private hydratePromise: Promise<LoadedRepositoryContext> | null = null;

  private hydrateOwner: string | null = null;

  private hydrateRepo: string | null = null;

  constructor(
    _state: DurableObjectState<unknown>,
    env: AppBindings
  ) {
    this.storage = new StorageService(env.GIT_BUCKET);
    this.browserService = new RepositoryBrowserService(this.storage);
    this.gitService = new GitService({} as never, this.storage);
    this.mergeService = new PullRequestMergeService(this.storage);
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
        case "resolve-default-branch-target": {
          const context = await this.ensureLoadedContext(
            String(payload.owner ?? ""),
            String(payload.repo ?? "")
          );
          return jsonResponse(selectDefaultBranchTarget(context));
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
              ...(typeof payload.limit === "number" ? { limit: payload.limit } : {})
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
        case "compare-refs": {
          const owner = String(payload.owner ?? "");
          const repo = String(payload.repo ?? "");
          const result = await this.browserService.compareRefs(
            {
              owner,
              repo,
              baseRef: String(payload.baseRef ?? ""),
              headRef: String(payload.headRef ?? "")
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
          return jsonResponse({ ok: true });
        }
        case "squash-merge-pull-request": {
          const owner = String(payload.owner ?? "");
          const repo = String(payload.repo ?? "");
          const context = await this.ensureLoadedContext(owner, repo);
          const result = await this.mergeService.squashMergePullRequestWithLoaded({
            owner,
            repo,
            pullRequest: payload.pullRequest as PullRequestRecord,
            mergedBy: payload.mergedBy as AuthUser,
            loaded: context
          });
          this.refreshContext(owner, repo, context);
          return jsonResponse(result);
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
      if (error instanceof PullRequestMergeConflictError) {
        return errorResponse(409, "merge_conflict", error.message);
      }
      if (error instanceof PullRequestMergeBranchNotFoundError) {
        return errorResponse(409, "merge_branch_not_found", error.message);
      }
      if (error instanceof PullRequestMergeNotSupportedError) {
        return errorResponse(409, "merge_not_supported", error.message);
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
    const headers = new Headers(result.response.headers);
    headers.set(REPOSITORY_UPDATED_HEADER, result.repositoryUpdated ? "1" : "0");
    headers.set(UPDATED_REFS_HEADER, encodeUpdatedRefsHeader(result.updatedRefs));
    return new Response(result.response.body, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers
    });
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

export class RepositoryObjectClient implements RepositoryComparisonReader {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  private getStub(repositoryId: string): DurableObjectStub {
    return this.namespace.getByName(repositoryId);
  }

  private async sendJsonRequest<T>(args: {
    repositoryId: string;
    operation: RepositoryObjectJsonOperation;
    payload: Record<string, unknown>;
  }): Promise<T> {
    const response = await this.getStub(args.repositoryId).fetch("https://repository-object/json", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: args.operation,
        payload: args.payload
      } satisfies RepositoryObjectJsonRequest)
    });

    if (!response.ok) {
      const error = await parseRepositoryObjectError(response);
      switch (error.error) {
        case "path_invalid":
          throw new RepositoryBrowseInvalidPathError();
        case "path_not_found":
          throw new RepositoryBrowsePathNotFoundError(error.message);
        case "merge_conflict":
          throw new PullRequestMergeConflictError();
        case "merge_branch_not_found":
          if (error.message.startsWith("Base branch not found: ")) {
            throw new PullRequestMergeBranchNotFoundError(
              "base",
              error.message.slice("Base branch not found: ".length)
            );
          }
          if (error.message.startsWith("Head branch not found: ")) {
            throw new PullRequestMergeBranchNotFoundError(
              "head",
              error.message.slice("Head branch not found: ".length)
            );
          }
          throw new HTTPException(500, { message: error.message });
        case "merge_not_supported":
          throw new PullRequestMergeNotSupportedError();
        default:
          throw new HTTPException(500, { message: error.message });
      }
    }

    return (await response.json()) as T;
  }

  async listHeadRefs(args: {
    repositoryId: string;
    owner: string;
    repo: string;
  }): Promise<RepositoryHeadRef[]> {
    const result = await this.sendJsonRequest<{ branches: RepositoryHeadRef[] }>({
      repositoryId: args.repositoryId,
      operation: "list-head-refs",
      payload: {
        owner: args.owner,
        repo: args.repo
      }
    });
    return result.branches;
  }

  async resolveDefaultBranchTarget(args: {
    repositoryId: string;
    owner: string;
    repo: string;
  }): Promise<RepositoryDefaultBranchTarget> {
    return this.sendJsonRequest<RepositoryDefaultBranchTarget>({
      repositoryId: args.repositoryId,
      operation: "resolve-default-branch-target",
      payload: {
        owner: args.owner,
        repo: args.repo
      }
    });
  }

  async getRepositoryDetail(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    ref?: string;
  }): Promise<RepositoryDetail> {
    return this.sendJsonRequest<RepositoryDetail>({
      repositoryId: args.repositoryId,
      operation: "get-repository-detail",
      payload: {
        owner: args.owner,
        repo: args.repo,
        ...(args.ref ? { ref: args.ref } : {})
      }
    });
  }

  async browseRepositoryContents(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    ref?: string;
    path?: string;
  }): Promise<RepositoryBrowseResult> {
    return this.sendJsonRequest<RepositoryBrowseResult>({
      repositoryId: args.repositoryId,
      operation: "browse-repository-contents",
      payload: {
        owner: args.owner,
        repo: args.repo,
        ...(args.ref ? { ref: args.ref } : {}),
        ...(args.path ? { path: args.path } : {})
      }
    });
  }

  async listCommitHistory(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    ref?: string;
    limit?: number;
  }): Promise<{ ref: string | null; commits: CommitSummary[] }> {
    return this.sendJsonRequest<{
      ref: string | null;
      commits: CommitSummary[];
    }>({
      repositoryId: args.repositoryId,
      operation: "list-commit-history",
      payload: {
        owner: args.owner,
        repo: args.repo,
        ...(args.ref ? { ref: args.ref } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {})
      }
    });
  }

  async listPathHistory(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    ref?: string;
    path: string;
    limit?: number;
  }): Promise<RepositoryPathHistoryResult> {
    return this.sendJsonRequest<RepositoryPathHistoryResult>({
      repositoryId: args.repositoryId,
      operation: "list-path-history",
      payload: {
        owner: args.owner,
        repo: args.repo,
        path: args.path,
        ...(args.ref ? { ref: args.ref } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {})
      }
    });
  }

  async getCommitDetail(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    oid: string;
  }): Promise<RepositoryCommitDetail> {
    return this.sendJsonRequest<RepositoryCommitDetail>({
      repositoryId: args.repositoryId,
      operation: "get-commit-detail",
      payload: {
        owner: args.owner,
        repo: args.repo,
        oid: args.oid
      }
    });
  }

  async compareRefs(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    baseRef: string;
    headRef: string;
  }): Promise<RepositoryCompareResult> {
    return this.sendJsonRequest<RepositoryCompareResult>({
      repositoryId: args.repositoryId,
      operation: "compare-refs",
      payload: {
        owner: args.owner,
        repo: args.repo,
        baseRef: args.baseRef,
        headRef: args.headRef
      }
    });
  }

  async initializeRepository(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    defaultBranch?: string;
  }): Promise<void> {
    await this.sendJsonRequest<{ ok: true }>({
      repositoryId: args.repositoryId,
      operation: "initialize-repository",
      payload: {
        owner: args.owner,
        repo: args.repo,
        ...(args.defaultBranch ? { defaultBranch: args.defaultBranch } : {})
      }
    });
  }

  async renameRepository(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    nextRepo: string;
  }): Promise<void> {
    await this.sendJsonRequest<{ ok: true }>({
      repositoryId: args.repositoryId,
      operation: "rename-repository",
      payload: {
        owner: args.owner,
        repo: args.repo,
        nextRepo: args.nextRepo
      }
    });
  }

  async deleteRepository(args: {
    repositoryId: string;
    owner: string;
    repo: string;
  }): Promise<void> {
    await this.sendJsonRequest<{ ok: true }>({
      repositoryId: args.repositoryId,
      operation: "delete-repository",
      payload: {
        owner: args.owner,
        repo: args.repo
      }
    });
  }

  async squashMergePullRequest(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    pullRequest: PullRequestRecord;
    mergedBy: AuthUser;
  }): Promise<PullRequestSquashMergeResult> {
    return this.sendJsonRequest<PullRequestSquashMergeResult>({
      repositoryId: args.repositoryId,
      operation: "squash-merge-pull-request",
      payload: {
        owner: args.owner,
        repo: args.repo,
        pullRequest: args.pullRequest,
        mergedBy: args.mergedBy
      }
    });
  }

  async handleInfoRefs(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    service: GitServiceName;
  }): Promise<Response> {
    return this.getStub(args.repositoryId).fetch(
      `https://repository-object/git/info/refs?owner=${encodeURIComponent(args.owner)}&repo=${encodeURIComponent(args.repo)}&service=${encodeURIComponent(args.service)}`
    );
  }

  async handleUploadPack(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    body: ArrayBuffer;
  }): Promise<Response> {
    return this.getStub(args.repositoryId).fetch(
      `https://repository-object/git/upload-pack?owner=${encodeURIComponent(args.owner)}&repo=${encodeURIComponent(args.repo)}`,
      {
        method: "POST",
        body: args.body
      }
    );
  }

  async handleReceivePack(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    body: ArrayBuffer;
  }): Promise<ReceivePackResponse> {
    const response = await this.getStub(args.repositoryId).fetch(
      `https://repository-object/git/receive-pack?owner=${encodeURIComponent(args.owner)}&repo=${encodeURIComponent(args.repo)}`,
      {
        method: "POST",
        body: args.body
      }
    );
    const updatedRefs = decodeUpdatedRefsHeader(response.headers.get(UPDATED_REFS_HEADER));
    const repositoryUpdated = response.headers.get(REPOSITORY_UPDATED_HEADER) === "1";
    return {
      repositoryUpdated,
      updatedRefs,
      response: cloneResponseWithoutHeaders(response, [UPDATED_REFS_HEADER, REPOSITORY_UPDATED_HEADER])
    };
  }
}

export function createRepositoryObjectClient(
  env: Pick<AppBindings, "REPOSITORY_OBJECTS">
): RepositoryObjectClient {
  return new RepositoryObjectClient(env.REPOSITORY_OBJECTS);
}
