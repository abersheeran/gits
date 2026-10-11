import { removeGithubSource } from "./github/removal";
import { executeMirrorTask, MIRROR_TASK_KEY } from "./github/mirror-alarm";
import { dispatchMirrorTasks } from "./github/scheduler";
import type { MirrorTask } from "./github/types";
import { HTTPException } from "hono/http-exception";
import type { AppBindings } from "../types";
import { GitService } from "./git-service";
import { importLegacyRepository } from "./git-store/legacy-import";
import { ObjectStore } from "./git-store/object-store";
import { RefStore } from "./git-store/ref-store";
import { ensureGitStoreSchema } from "./git-store/schema";
import { RepositoryBranches, branchRef } from "./repository-branches";
import {
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError,
  RepositoryBrowserService
} from "./repository-browser-service";
import type {
  RepositoryObjectErrorCode,
  RepositoryObjectJsonRequest
} from "./repository-object-protocol";
import { StorageService } from "./storage-service";

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function errorResponse(status: number, error: RepositoryObjectErrorCode, message: string) {
  return json({ error, message }, status);
}

export class RepositoryObject {
  private store!: ObjectStore;
  private refs!: RefStore;
  private browser!: RepositoryBrowserService;
  private git!: GitService;
  private branches!: RepositoryBranches;
  private readonly source: StorageService;
  private readyPromise: Promise<void> | null = null;
  private writeTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ctx: DurableObjectState<unknown>,
    private readonly env: AppBindings
  ) {
    this.source = new StorageService(env.GIT_BUCKET);
    this.resetStore();
  }

  private resetStore(): void {
    ensureGitStoreSchema(this.ctx.storage.sql);
    this.store = new ObjectStore(this.ctx.storage.sql);
    this.refs = new RefStore(this.ctx.storage);
    this.browser = new RepositoryBrowserService(this.store, this.refs);
    this.git = new GitService(this.store, this.refs);
    this.branches = new RepositoryBranches(this.store, this.refs);
  }

  private async ready(owner: string, repo: string): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }
    const metadata = new Map(
      this.ctx.storage.sql
        .exec<{ key: string; value: string }>(
          "SELECT key, value FROM meta WHERE key IN ('initialized', 'legacy_cleanup')"
        )
        .toArray()
        .map((row) => [row.key, row.value])
    );
    const initialized = metadata.get("initialized") === "1";
    if (initialized && metadata.get("legacy_cleanup") !== "1") {
      return;
    }
    this.readyPromise = (async () => {
      if (!initialized) {
        const result = await importLegacyRepository({
          storage: this.ctx.storage,
          store: this.store,
          source: this.source,
          owner,
          repo,
          cleanupPending: true
        });
        if (result.skippedRefs.length) {
          console.warn("Skipped legacy repository references", {
            owner,
            repo,
            refs: result.skippedRefs
          });
        }
      }
      await this.source.deleteRepository(owner, repo);
      for (;;) {
        const snapshot = await this.ctx.storage.list({
          prefix: "repository-snapshot/",
          limit: 128
        });
        const keys = [...snapshot.keys()];
        if (!keys.length) {
          break;
        }
        await this.ctx.storage.delete(keys);
      }
      this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = 'legacy_cleanup'").toArray();
    })();
    try {
      await this.readyPromise;
    } finally {
      this.readyPromise = null;
    }
  }

  private write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(async () => {
      await this.readyPromise?.catch(() => {
      });
      return operation();
    });
    this.writeTail = result.catch(() => {
    });
    return result;
  }

  async alarm(): Promise<void> {
    let processed = false;
    let removedSource: string | undefined;
    try {
      await this.write(async () => {
        const task = await this.ctx.storage.get<MirrorTask>(MIRROR_TASK_KEY);
        if (!task) {
          return;
        }
        processed = true;
        try {
          removedSource = await executeMirrorTask({
            env: this.env, task, store: this.store, refs: this.refs,
            ready: (owner, repo) => this.ready(owner, repo)
          });
        } finally {
          await this.ctx.storage.delete(MIRROR_TASK_KEY);
        }
      });
    } catch {
      console.error("Mirror alarm failed; the scheduler will recover expired leases");
    }
    if (processed) {
      try {
        if (removedSource) {
          await removeGithubSource(this.env, removedSource);
        }
        await dispatchMirrorTasks(this.env);
      } catch {
        console.error("Mirror dispatch failed; the scheduler will retry");
      }
    }
  }

  private async handleJson(request: Request): Promise<Response> {
    let input: RepositoryObjectJsonRequest;
    try {
      input = await request.json();
    } catch {
      return errorResponse(400, "bad_request", "Invalid JSON payload");
    }
    const payload = input.payload ?? {};
    const owner = String(payload.owner ?? "");
    const repo = String(payload.repo ?? "");
    const operation = async () => {
      if (input.operation === "schedule-mirror-sync") {
        const task: MirrorTask = {
          repositoryId: String(payload.repositoryId),
          remoteId: String(payload.remoteId),
          claimId: String(payload.claimId)
        };
        await this.ctx.storage.put(MIRROR_TASK_KEY, task);
        await this.ctx.storage.setAlarm(Date.now());
        return json({ ok: true });
      }
      if (input.operation === "cancel-mirror-sync") {
        await this.ctx.storage.delete(MIRROR_TASK_KEY);
        await this.ctx.storage.deleteAlarm();
        return json({ ok: true });
      }
      if (input.operation === "initialize-repository") {
        const head = branchRef(payload.defaultBranch ?? "main", "defaultBranch");
        this.refs.updateRefs([], { head: `ref: ${head}`, meta: { initialized: "1" } });
        return json({ ok: true }, 201);
      }
      if (input.operation === "delete-repository") {
        await this.ctx.storage.deleteAll();
        try {
          await this.source.deleteRepository(owner, repo);
        } finally {
          this.resetStore();
        }
        return json({ ok: true });
      }
      await this.ready(owner, repo);
      const common = {
        owner,
        repo,
        ...(typeof payload.ref === "string" ? { ref: payload.ref } : {})
      };
      switch (input.operation) {
        case "list-head-refs":
          return json({ branches: this.refs.listRefs("refs/heads/") });
        case "create-branch":
          return json(this.branches.create(payload.branchName, payload.sourceOid), 201);
        case "delete-branch":
          return json(this.branches.delete(payload.branchName));
        case "set-default-branch":
          return json(this.branches.setDefault(payload.branchName));
        case "rename-repository":
          return json({ ok: true });
        case "get-repository-detail":
          return json(await this.browser.getRepositoryDetail(common));
        case "browse-repository-contents":
          return json(
            await this.browser.browseRepositoryContents({
              ...common,
              ...(typeof payload.path === "string" ? { path: payload.path } : {})
            })
          );
        case "list-commit-history":
          return json(
            await this.browser.listCommitHistory({
              ...common,
              ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
              ...(typeof payload.page === "number" ? { page: payload.page } : {})
            })
          );
        case "list-path-history":
          return json(
            await this.browser.listPathHistory({
              ...common,
              path: String(payload.path ?? ""),
              ...(typeof payload.limit === "number" ? { limit: payload.limit } : {})
            })
          );
        case "get-commit-detail":
          return json(
            await this.browser.getCommitDetail({
              ...common,
              oid: String(payload.oid ?? "")
            })
          );
        default:
          return errorResponse(400, "bad_request", "Unsupported repository object operation");
      }
    };
    const writes = [
      "schedule-mirror-sync",
      "cancel-mirror-sync",
      "initialize-repository",
      "delete-repository",
      "create-branch",
      "delete-branch",
      "set-default-branch"
    ];
    return writes.includes(input.operation) ? this.write(operation) : operation();
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/json") {
        return await this.handleJson(request);
      }
      const owner = url.searchParams.get("owner") ?? "";
      const repo = url.searchParams.get("repo") ?? "";
      if (url.pathname === "/git/receive-pack" && request.method === "POST") {
        return await this.write(async () => {
          await this.ready(owner, repo);
          return this.git.handleReceivePack({
            owner,
            repo,
            body: request.body ?? new Response("").body!
          });
        });
      }
      if (url.pathname === "/git/info/refs" && request.method === "GET") {
        const service = url.searchParams.get("service");
        if (service !== "git-upload-pack" && service !== "git-receive-pack") {
          return errorResponse(400, "git_service_invalid", "Invalid git service");
        }
        await this.ready(owner, repo);
        return await this.git.handleInfoRefs({ owner, repo, service });
      }
      if (url.pathname === "/git/upload-pack" && request.method === "POST") {
        await this.ready(owner, repo);
        return await this.git.handleUploadPack({ owner, repo, body: await request.arrayBuffer() });
      }
      return errorResponse(404, "bad_request", "Not found");
    } catch (error) {
      if (error instanceof RepositoryBrowseInvalidPathError) {
        return errorResponse(400, "path_invalid", error.message);
      }
      if (error instanceof RepositoryBrowsePathNotFoundError) {
        return errorResponse(404, "path_not_found", error.message);
      }
      if (error instanceof HTTPException) {
        return errorResponse(error.status, "bad_request", error.message);
      }
      console.error("Repository object request failed", error);
      return errorResponse(500, "bad_request", "Repository operation failed");
    }
  }
}
