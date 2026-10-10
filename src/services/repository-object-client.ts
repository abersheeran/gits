import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppBindings, GitServiceName } from "../types";
import {
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError,
  type RepositoryBrowseResult,
  type RepositoryCommitHistoryResult,
  type RepositoryCommitDetail,
  type RepositoryDetail,
  type RepositoryPathHistoryResult
} from "./repository-browser-service";
import type {
  RepositoryObjectJsonOperation,
  RepositoryObjectJsonRequest,
  RepositoryHeadRef,
  RepositoryBranchMutationResult,
  RepositoryObjectErrorPayload
} from "./repository-object-protocol";

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

function toContentfulStatusCode(status: number): ContentfulStatusCode {
  if (status === 101 || status === 204 || status === 205 || status === 304) {
    return 500;
  }
  return status as ContentfulStatusCode;
}

export class RepositoryObjectClient {
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
        default:
          throw new HTTPException(toContentfulStatusCode(response.status), { message: error.message });
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

  async createBranch(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    branchName: string;
    sourceOid: string;
  }): Promise<RepositoryBranchMutationResult> {
    return this.sendJsonRequest<RepositoryBranchMutationResult>({
      repositoryId: args.repositoryId,
      operation: "create-branch",
      payload: {
        owner: args.owner,
        repo: args.repo,
        branchName: args.branchName,
        sourceOid: args.sourceOid
      }
    });
  }

  async setDefaultBranch(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    branchName: string;
  }): Promise<RepositoryBranchMutationResult> {
    return this.sendJsonRequest<RepositoryBranchMutationResult>({
      repositoryId: args.repositoryId,
      operation: "set-default-branch",
      payload: {
        owner: args.owner,
        repo: args.repo,
        branchName: args.branchName
      }
    });
  }

  async deleteBranch(args: {
    repositoryId: string;
    owner: string;
    repo: string;
    branchName: string;
  }): Promise<RepositoryBranchMutationResult> {
    return this.sendJsonRequest<RepositoryBranchMutationResult>({
      repositoryId: args.repositoryId,
      operation: "delete-branch",
      payload: {
        owner: args.owner,
        repo: args.repo,
        branchName: args.branchName
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
    page?: number;
  }): Promise<RepositoryCommitHistoryResult> {
    return this.sendJsonRequest<RepositoryCommitHistoryResult>({
      repositoryId: args.repositoryId,
      operation: "list-commit-history",
      payload: {
        owner: args.owner,
        repo: args.repo,
        ...(args.ref ? { ref: args.ref } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.page !== undefined ? { page: args.page } : {})
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
  }): Promise<Response> {
    return this.getStub(args.repositoryId).fetch(
      `https://repository-object/git/receive-pack?owner=${encodeURIComponent(args.owner)}&repo=${encodeURIComponent(args.repo)}`,
      {
        method: "POST",
        body: args.body
      }
    );
  }
}

export function createRepositoryObjectClient(
  env: Pick<AppBindings, "REPOSITORY_OBJECTS">
): RepositoryObjectClient {
  return new RepositoryObjectClient(env.REPOSITORY_OBJECTS);
}
