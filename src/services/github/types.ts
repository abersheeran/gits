export type RepositoryState =
  | "excluded" | "queued" | "syncing" | "synced" | "failed"
  | "too_large" | "name_conflict" | "missing";

export type ConnectionRow = {
  id: string;
  user_id: string;
  github_user_id: number;
  github_login: string;
  avatar_url: string | null;
  token_kind: "classic" | "fine_grained";
  token_ciphertext: string;
  scopes: string;
  status: "active" | "invalid";
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type SourceRow = {
  id: string;
  connection_id: string;
  user_id: string;
  owner_github_id: number;
  owner_login: string;
  owner_type: "user" | "organization";
  avatar_url: string | null;
  name_prefix: string;
  include_forks: number;
  include_archived: number;
  visibility_policy: "follow" | "private";
  interval_minutes: number;
  paused: number;
  status: "ok" | "sso_required" | "failed" | "paused";
  last_error: string | null;
  next_discovery_at: number;
  last_discovered_at: number | null;
  lease_until: number | null;
  claim_id: string | null;
  created_at: number;
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
};

export const MAX_MIRROR_BYTES = 10 * 1024 * 1024 * 1024;
export const LEASE_MS = 20 * 60 * 1000;
