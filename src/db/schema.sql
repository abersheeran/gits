PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS repository_collaborators (
  repository_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ("read", "write", "admin")),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, user_id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repositories_owner ON repositories(owner_id);
CREATE INDEX IF NOT EXISTS idx_repositories_visibility ON repositories(is_private, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user ON access_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_tokens_prefix ON access_tokens(token_prefix);
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
  visibility_override INTEGER CHECK (visibility_override IN (0, 1)),
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
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT NOT NULL,
  ip_address TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, created_at DESC, id DESC);
CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE github_oauth_states (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_github_oauth_states_expiry ON github_oauth_states(expires_at);
CREATE INDEX idx_github_oauth_states_session ON github_oauth_states(session_id);
