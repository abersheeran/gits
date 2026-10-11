import { requestJson } from "./api-request";

export type GithubRepositoryState =
  | "excluded"
  | "queued"
  | "syncing"
  | "synced"
  | "failed"
  | "too_large"
  | "name_conflict"
  | "missing";

export type GithubSourceStatus = "ok" | "sso_required" | "failed" | "paused";

export type GithubSourceSettings = {
  namePrefix: string;
  includeForks: boolean;
  includeArchived: boolean;
  visibilityPolicy: "follow" | "private";
  intervalMinutes: 15 | 60 | 360 | 1440;
  paused: boolean;
};

export type GithubSourceSummary = {
  id: string;
  connectionId: string;
  ownerLogin: string;
  ownerType: "user" | "organization";
  avatarUrl: string | null;
  status: GithubSourceStatus;
  lastError: string | null;
  lastDiscoveredAt: number | null;
  repositoryCount: number;
  syncedCount: number;
  attentionCount: number;
};

export type GithubSource = GithubSourceSummary &
  GithubSourceSettings & {
    counts: Record<GithubRepositoryState, number>;
  };

export type GithubConnection = {
  id: string;
  githubLogin: string;
  githubUserId: number;
  avatarUrl: string | null;
  tokenKind: "classic" | "fine_grained";
  status: "active" | "invalid";
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  sources: GithubSourceSummary[];
};

export type GithubOwner = {
  login: string;
  type: "user" | "organization";
  githubId: number;
  avatarUrl: string | null;
  sourceId: string | null;
};

export type GithubRemoteRepository = {
  githubRepoId: number;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  sizeKb: number;
  selection: "auto" | "include" | "exclude";
  localName: string | null;
  repository: { owner: string; name: string } | null;
  state: GithubRepositoryState;
  lastError: string | null;
  lastSyncedAt: number | null;
};

export type RepositoryMirror = {
  sourceId: string;
  fullName: string;
  htmlUrl: string;
  state: GithubRepositoryState;
  lastSyncedAt: number | null;
  lastError: string | null;
};

export type GithubRepositoryFilter = "all" | "synced" | "attention" | "excluded";
export type GithubRepositoryPage = {
  items: GithubRemoteRepository[];
  page: number;
  perPage: 50;
  total: number;
  hasNextPage: boolean;
};
const segment = encodeURIComponent;
const connectionPath = (id: string) => `/api/github/connections/${segment(id)}`;
const sourcePath = (id: string) => `/api/github/sources/${segment(id)}`;
const mirrorPath = (owner: string, repo: string) =>
  `/api/repos/${segment(owner)}/${segment(repo)}/mirror`;
export const listGithubConnections = () =>
  requestJson<{ configured: boolean; connections: GithubConnection[] }>("/api/github/connections");
export const createGithubConnection = (token: string) =>
  requestJson<{ connection: GithubConnection }>("/api/github/connections", {
    method: "POST",
    bodyJson: { token }
  });
export const replaceGithubToken = (id: string, token: string) =>
  requestJson<{ connection: GithubConnection }>(connectionPath(id), {
    method: "PATCH",
    bodyJson: { token }
  });
export const deleteGithubConnection = (id: string) =>
  requestJson<{ ok: true }>(connectionPath(id), { method: "DELETE" });
export const listGithubOwners = (id: string) =>
  requestJson<{ owners: GithubOwner[] }>(`${connectionPath(id)}/owners`);
export const createGithubSource = (
  input: {
    connectionId: string;
    ownerLogin: string;
  } & Partial<GithubSourceSettings>
) =>
  requestJson<{ source: GithubSource }>("/api/github/sources", {
    method: "POST",
    bodyJson: input
  });
export const getGithubSource = (id: string) =>
  requestJson<{ source: GithubSource }>(sourcePath(id));
export const updateGithubSource = (id: string, input: Partial<GithubSourceSettings>) =>
  requestJson<{ source: GithubSource }>(sourcePath(id), {
    method: "PATCH",
    bodyJson: input
  });
export const deleteGithubSource = (id: string) =>
  requestJson<{ ok: true }>(sourcePath(id), { method: "DELETE" });
export const syncGithubSource = (id: string) =>
  requestJson<{ source: GithubSource }>(`${sourcePath(id)}/sync`, {
    method: "POST"
  });
export const listGithubRepositories = (id: string, status: GithubRepositoryFilter, page: number) =>
  requestJson<GithubRepositoryPage>(
    `${sourcePath(id)}/repositories?${new URLSearchParams({ status, page: String(page) })}`
  );
export const updateGithubRepository = (
  id: string,
  githubRepoId: number,
  input: {
    selection?: "auto" | "include" | "exclude";
    localName?: string | null;
  }
) =>
  requestJson<{ repository: GithubRemoteRepository }>(
    `${sourcePath(id)}/repositories/${githubRepoId}`,
    { method: "PATCH", bodyJson: input }
  );
export const syncRepositoryMirror = (owner: string, repo: string) =>
  requestJson<{ mirror: RepositoryMirror }>(`${mirrorPath(owner, repo)}/sync`, {
    method: "POST"
  });
export const stopRepositoryMirror = (owner: string, repo: string) =>
  requestJson<{ ok: true }>(mirrorPath(owner, repo), { method: "DELETE" });
export function defaultGithubSourceSettings(
  login: string,
  type: "user" | "organization"
): GithubSourceSettings {
  return {
    namePrefix: type === "organization" ? `${login}.` : "",
    includeForks: false,
    includeArchived: true,
    visibilityPolicy: "follow",
    intervalMinutes: 60,
    paused: false
  };
}
