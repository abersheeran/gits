export type RepositoryState =
  | "excluded" | "queued" | "syncing" | "synced" | "failed"
  | "too_large" | "name_conflict" | "missing";

export type SourceRow = {
  id: string;
  installation_id: number;
  user_id: string;
  account_id: number;
  account_login: string;
  account_type: "user" | "organization";
  avatar_url: string | null;
  repository_selection: "all" | "selected";
  linked_by_github_id: number;
  linked_by_login: string;
  name_prefix: string;
  include_forks: number;
  include_archived: number;
  visibility_policy: "follow" | "private";
  paused: number;
  suspended: number;
  status: "ok" | "failed" | "paused" | "suspended";
  last_error: string | null;
  next_discovery_at: number;
  rate_limit_until: number | null;
  last_discovered_at: number | null;
  lease_until: number | null;
  claim_id: string | null;
  created_at: number;
  updated_at: number;
};

export type GithubOwner = {
  id: number;
  login: string;
  avatar_url: string | null;
  type: "User" | "Organization";
};

export type GithubInstallation = {
  id: number;
  app_id: number;
  account: GithubOwner;
  repository_selection: "all" | "selected";
  suspended_at: string | null;
};

export type RemoteRow = {
  id: string;
  source_id: string;
  user_id: string;
  github_repo_id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  is_private: number;
  is_fork: number;
  is_archived: number;
  size_kb: number;
  default_branch: string | null;
  pushed_at: string | null;
  last_seen_at: number;
  missing_since: number | null;
  selection: "auto" | "include" | "exclude";
  included: number;
  local_name: string | null;
  repository_id: string | null;
  state: RepositoryState;
  last_error: string | null;
  attempts: number;
  last_synced_pushed_at: string | null;
  last_synced_at: number | null;
  next_sync_at: number;
  lease_until: number | null;
  claim_id: string | null;
  claimed_pushed_at: string | null;
  sync_requested_at: number;
  claimed_at: number | null;
};

export type MirrorTask = {
  repositoryId: string;
  remoteId: string;
  claimId: string;
};

export type GithubHttpOptions = {
  fetch?: typeof fetch;
  apiBaseUrl?: string;
  gitBaseUrl?: string;
  webBaseUrl?: string;
};

export const MAX_MIRROR_BYTES = 10 * 1024 * 1024 * 1024;
export const LEASE_MS = 20 * 60 * 1000;

export const DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;
