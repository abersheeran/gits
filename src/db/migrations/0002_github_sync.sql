CREATE TABLE github_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_user_id INTEGER NOT NULL,
  github_login TEXT NOT NULL,
  avatar_url TEXT,
  token_kind TEXT NOT NULL CHECK (token_kind IN ('classic', 'fine_grained')),
  token_ciphertext TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid')),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE github_sync_sources (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES github_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_github_id INTEGER NOT NULL,
  owner_login TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'organization')),
  avatar_url TEXT,
  name_prefix TEXT NOT NULL DEFAULT '',
  include_forks INTEGER NOT NULL DEFAULT 0,
  include_archived INTEGER NOT NULL DEFAULT 1,
  visibility_policy TEXT NOT NULL DEFAULT 'follow'
    CHECK (visibility_policy IN ('follow', 'private')),
  interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (interval_minutes IN (15, 60, 360, 1440)),
  paused INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'sso_required', 'failed', 'paused')),
  last_error TEXT,
  next_discovery_at INTEGER NOT NULL,
  last_discovered_at INTEGER,
  lease_until INTEGER,
  claim_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, owner_github_id)
);

CREATE TABLE github_repositories (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES github_sync_sources(id) ON DELETE CASCADE,
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
  UNIQUE(user_id, github_repo_id)
);

CREATE INDEX idx_github_connections_user ON github_connections(user_id, created_at);
CREATE INDEX idx_github_sources_due ON github_sync_sources(next_discovery_at, lease_until);
CREATE INDEX idx_github_sources_connection ON github_sync_sources(connection_id);
CREATE INDEX idx_github_repositories_due
  ON github_repositories(included, next_sync_at, lease_until);
CREATE INDEX idx_github_repositories_source
  ON github_repositories(source_id, state, full_name);
CREATE INDEX idx_github_repositories_names ON github_repositories(source_id, full_name);
