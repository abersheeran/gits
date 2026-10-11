import { requestJson } from "./api-request";
import type { RepositoryMirror } from "./github-api";
export { ApiError, formatApiError } from "./api-error";

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
  is_mirror: 0 | 1;
  created_at: number;
};

export type RepositoryDetailResponse = {
  mirror: RepositoryMirror | null;
  repository: RepositoryRecord;
  viewerPermission: "owner" | CollaboratorPermission | null;
  defaultBranch: string | null;
  selectedRef: string | null;
  headOid: string | null;
  branches: Array<{ name: string; oid: string }>;
  readme: { path: string; content: string } | null;
};

export type RepositoryBranchMutationResponse = {
  defaultBranch: string | null;
  branches: Array<{ name: string; oid: string }>;
};

export type CommitHistoryResponse = {
  ref: string | null;
  commits: CommitSummary[];
  pagination: PaginationMetadata;
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

export type RepositoryTreeEntry = {
  name: string;
  path: string;
  oid: string;
  mode: string;
  type: "tree" | "blob" | "commit";
  latestCommit: CommitSummary | null;
};

export type RepositoryFilePreview = {
  path: string;
  oid: string;
  mode: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
  content: string | null;
  latestCommit: CommitSummary | null;
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

export type RepositoryPathHistoryResponse = {
  ref: string | null;
  path: string;
  commits: CommitSummary[];
};

export type RepositoryCommitChange = {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "deleted";
  mode: string | null;
  previousMode: string | null;
  oid: string | null;
  previousOid: string | null;
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch: string | null;
  hunks: RepositoryDiffHunk[];
  oldContent: string | null;
  newContent: string | null;
};

export type RepositoryDiffLine = {
  kind: "context" | "add" | "delete" | "meta";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type RepositoryDiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: RepositoryDiffLine[];
};

export type RepositoryCommitDetailResponse = {
  commit: CommitSummary;
  filesChanged: number;
  additions: number;
  deletions: number;
  changes: RepositoryCommitChange[];
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

export type PaginationMetadata = {
  total: number;
  page: number;
  perPage: number;
  hasNextPage: boolean;
};

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

export async function createRepositoryBranch(
  owner: string,
  repo: string,
  input: { branchName: string; sourceOid: string }
): Promise<RepositoryBranchMutationResponse> {
  return requestJson<RepositoryBranchMutationResponse>(`/api/repos/${owner}/${repo}/branches`, {
    method: "POST",
    bodyJson: input
  });
}

export async function updateRepositoryDefaultBranch(
  owner: string,
  repo: string,
  input: { branchName: string }
): Promise<RepositoryBranchMutationResponse> {
  return requestJson<RepositoryBranchMutationResponse>(`/api/repos/${owner}/${repo}/default-branch`, {
    method: "PATCH",
    bodyJson: input
  });
}

export async function deleteRepositoryBranch(
  owner: string,
  repo: string,
  branchName: string
): Promise<RepositoryBranchMutationResponse> {
  return requestJson<RepositoryBranchMutationResponse>(
    `/api/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}`,
    {
      method: "DELETE"
    }
  );
}

export async function getRepositoryCommits(
  owner: string,
  repo: string,
  input?: { ref?: string; limit?: number; page?: number }
): Promise<CommitHistoryResponse> {
  const query = new URLSearchParams();
  if (input?.ref) {
    query.set("ref", input.ref);
  }
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  if (input?.page) {
    query.set("page", String(input.page));
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

export async function getRepositoryCommitDetail(
  owner: string,
  repo: string,
  oid: string
): Promise<RepositoryCommitDetailResponse> {
  return requestJson<RepositoryCommitDetailResponse>(`/api/repos/${owner}/${repo}/commits/${oid}`);
}

export async function getRepositoryPathHistory(
  owner: string,
  repo: string,
  input: { path: string; ref?: string; limit?: number }
): Promise<RepositoryPathHistoryResponse> {
  const query = new URLSearchParams();
  query.set("path", input.path);
  if (input.ref) {
    query.set("ref", input.ref);
  }
  if (input.limit) {
    query.set("limit", String(input.limit));
  }
  return requestJson<RepositoryPathHistoryResponse>(
    `/api/repos/${owner}/${repo}/history?${query.toString()}`
  );
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
