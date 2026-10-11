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

export type GithubSourceStatus = "ok" | "failed" | "paused" | "suspended";

export type GithubSourceSettings = {
  namePrefix: string;
  includeForks: boolean;
  includeArchived: boolean;
  visibilityPolicy: "follow" | "private";
  paused: boolean;
};

export type GithubSourceSummary = {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: "user" | "organization";
  avatarUrl: string | null;
  repositorySelection: "all" | "selected";
  manageUrl: string;
  status: GithubSourceStatus;
  lastError: string | null;
  lastDiscoveredAt: number | null;
  repositoryCount: number;
  syncedCount: number;
  attentionCount: number;
};

export type GithubSource = GithubSourceSummary &
  GithubSourceSettings & {
    linkedBy: string;
    counts: Record<GithubRepositoryState, number>;
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
const sourcePath = (id: string) => `/api/github/sources/${segment(id)}`;
const mirrorPath = (owner: string, repo: string) =>
  `/api/repos/${segment(owner)}/${segment(repo)}/mirror`;
export type GithubSourcesResponse = {
  configured: boolean;
  installUrl: string | null;
  sources: GithubSourceSummary[];
};
export const listGithubSources = () => requestJson<GithubSourcesResponse>("/api/github/sources");
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
