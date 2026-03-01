export type AuthUser = {
  id: string;
  username: string;
};

export type CollaboratorPermission = "read" | "write" | "admin";

export type RepositoryRecord = {
  id: string;
  owner_id: string;
  owner_username: string;
  name: string;
  description: string | null;
  is_private: number;
  created_at: number;
};

export type RepositoryDetailResponse = {
  repository: RepositoryRecord;
  defaultBranch: string | null;
  selectedRef: string | null;
  headOid: string | null;
  branches: Array<{ name: string; oid: string }>;
  readme: { path: string; content: string } | null;
};

export type CommitHistoryResponse = {
  ref: string | null;
  commits: Array<{
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
  }>;
};

export type RepositoryTreeEntry = {
  name: string;
  path: string;
  oid: string;
  mode: string;
  type: "tree" | "blob" | "commit";
};

export type RepositoryFilePreview = {
  path: string;
  oid: string;
  mode: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
  content: string | null;
};

export type RepositoryContentsResponse = {
  defaultBranch: string | null;
  selectedRef: string | null;
  headOid: string | null;
  path: string;
  kind: "tree" | "blob";
  entries: RepositoryTreeEntry[];
  file: RepositoryFilePreview | null;
  readme: { path: string; content: string } | null;
};

export type AccessTokenMetadata = {
  id: string;
  token_prefix: string;
  name: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type CollaboratorRecord = {
  user_id: string;
  username: string;
  permission: CollaboratorPermission;
  created_at: number;
};

type ApiRequestInit = RequestInit & {
  bodyJson?: unknown;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const json = (await response.json()) as
        | { message?: string; error?: { message?: string } }
        | null;
      if (json?.message && typeof json.message === "string") {
        return json.message;
      }
      if (json?.error?.message && typeof json.error.message === "string") {
        return json.error.message;
      }
    } catch {
      // fall back to text
    }
  }

  const text = await response.text();
  return text || response.statusText || "Request failed";
}

async function requestJson<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (init.bodyJson !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
    body: init.bodyJson !== undefined ? JSON.stringify(init.bodyJson) : init.body
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return (await response.json()) as T;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await requestJson<{ user: AuthUser | null }>("/api/me");
  return response.user;
}

export async function login(input: {
  usernameOrEmail: string;
  password: string;
}): Promise<AuthUser> {
  const response = await requestJson<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    bodyJson: input
  });
  return response.user;
}

export async function register(input: {
  username: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const response = await requestJson<{ user: AuthUser }>("/api/auth/register", {
    method: "POST",
    bodyJson: input
  });
  return response.user;
}

export async function logout(): Promise<void> {
  await requestJson<{ ok: boolean }>("/api/auth/logout", {
    method: "POST"
  });
}

export async function listPublicRepositories(limit = 50): Promise<RepositoryRecord[]> {
  const response = await requestJson<{ repositories: RepositoryRecord[] }>(
    `/api/public/repos?limit=${limit}`
  );
  return response.repositories;
}

export async function listMyRepositories(): Promise<RepositoryRecord[]> {
  const response = await requestJson<{ repositories: RepositoryRecord[] }>("/api/repos");
  return response.repositories;
}

export async function createRepository(input: {
  name: string;
  description?: string;
  isPrivate: boolean;
}): Promise<void> {
  await requestJson<{ ok: boolean }>("/api/repos", {
    method: "POST",
    bodyJson: input
  });
}

export async function updateRepository(
  owner: string,
  repo: string,
  input: {
    name?: string;
    description?: string | null;
    isPrivate?: boolean;
  }
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}`, {
    method: "PATCH",
    bodyJson: input
  });
}

export async function deleteRepository(owner: string, repo: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}`, {
    method: "DELETE"
  });
}

export async function getRepositoryDetail(
  owner: string,
  repo: string,
  ref?: string
): Promise<RepositoryDetailResponse> {
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return requestJson<RepositoryDetailResponse>(`/api/repos/${owner}/${repo}${suffix}`);
}

export async function getRepositoryCommits(
  owner: string,
  repo: string,
  input?: { ref?: string; limit?: number }
): Promise<CommitHistoryResponse> {
  const query = new URLSearchParams();
  if (input?.ref) {
    query.set("ref", input.ref);
  }
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson<CommitHistoryResponse>(`/api/repos/${owner}/${repo}/commits${suffix}`);
}

export async function getRepositoryContents(
  owner: string,
  repo: string,
  input?: { ref?: string; path?: string }
): Promise<RepositoryContentsResponse> {
  const query = new URLSearchParams();
  if (input?.ref) {
    query.set("ref", input.ref);
  }
  if (input?.path) {
    query.set("path", input.path);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson<RepositoryContentsResponse>(`/api/repos/${owner}/${repo}/contents${suffix}`);
}

export async function listCollaborators(
  owner: string,
  repo: string
): Promise<CollaboratorRecord[]> {
  const response = await requestJson<{ collaborators: CollaboratorRecord[] }>(
    `/api/repos/${owner}/${repo}/collaborators`
  );
  return response.collaborators;
}

export async function upsertCollaborator(
  owner: string,
  repo: string,
  input: { username: string; permission: CollaboratorPermission }
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}/collaborators`, {
    method: "PUT",
    bodyJson: input
  });
}

export async function removeCollaborator(
  owner: string,
  repo: string,
  username: string
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}/collaborators/${username}`, {
    method: "DELETE"
  });
}

export async function listAccessTokens(): Promise<AccessTokenMetadata[]> {
  const response = await requestJson<{ tokens: AccessTokenMetadata[] }>("/api/auth/tokens");
  return response.tokens;
}

export async function createAccessToken(input: {
  name: string;
  expiresAt?: number;
}): Promise<{ tokenId: string; token: string }> {
  return requestJson<{ tokenId: string; token: string }>("/api/auth/tokens", {
    method: "POST",
    bodyJson: input
  });
}

export async function revokeAccessToken(tokenId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/auth/tokens/${tokenId}`, {
    method: "DELETE"
  });
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "未登录或登录已过期。";
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}
