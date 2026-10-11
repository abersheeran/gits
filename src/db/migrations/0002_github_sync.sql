CREATE TABLE github_installations (
  id TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('user', 'organization')),
  avatar_url TEXT,
  repository_selection TEXT NOT NULL CHECK (repository_selection IN ('all', 'selected')),
  linked_by_github_id INTEGER NOT NULL,
  linked_by_login TEXT NOT NULL,
  name_prefix TEXT NOT NULL DEFAULT '',
  include_forks INTEGER NOT NULL DEFAULT 0,
  include_archived INTEGER NOT NULL DEFAULT 1,
  visibility_policy TEXT NOT NULL DEFAULT 'follow'
    CHECK (visibility_policy IN ('follow', 'private')),
  paused INTEGER NOT NULL DEFAULT 0,
  suspended INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'failed', 'paused', 'suspended')),
  last_error TEXT,
  next_discovery_at INTEGER NOT NULL,
  rate_limit_until INTEGER,
  last_discovered_at INTEGER,
  lease_until INTEGER,
  claim_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE github_repositories (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES github_installations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_repo_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  html_url TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL,
  is_fork INTEGER NOT NULL,
  is_archived INTEGER NOT NULL,
  size_kb INTEGER NOT NULL,
  default_branch TEXT,
  pushed_at TEXT,
  last_seen_at INTEGER NOT NULL,
  discovery_id TEXT,
  missing_since INTEGER,
  selection TEXT NOT NULL DEFAULT 'auto' CHECK (selection IN ('auto', 'include', 'exclude')),
  included INTEGER NOT NULL DEFAULT 0,
  local_name TEXT,
  repository_id TEXT UNIQUE REFERENCES repositories(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'excluded'
    CHECK (state IN ('excluded', 'queued', 'syncing', 'synced', 'failed',
                    'too_large', 'name_conflict', 'missing')),
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_synced_pushed_at TEXT,
  last_synced_at INTEGER,
  next_sync_at INTEGER NOT NULL,
  lease_until INTEGER,
  claim_id TEXT,
  claimed_pushed_at TEXT,
  sync_requested_at INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  UNIQUE(user_id, github_repo_id)
);

CREATE INDEX idx_github_installations_user ON github_installations(user_id, created_at);
CREATE INDEX idx_github_installations_due
  ON github_installations(next_discovery_at, lease_until);
CREATE INDEX idx_github_repositories_due
  ON github_repositories(included, next_sync_at, lease_until);
CREATE INDEX idx_github_repositories_source
  ON github_repositories(source_id, state, full_name);
CREATE INDEX idx_github_repositories_names ON github_repositories(source_id, full_name);
