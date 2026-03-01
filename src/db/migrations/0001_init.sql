PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(owner_id, name)
);

CREATE TABLE repository_collaborators (
  repository_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ("read", "write", "admin")),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, user_id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE access_tokens (
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

CREATE INDEX idx_repositories_owner ON repositories(owner_id);
CREATE INDEX idx_repositories_visibility ON repositories(is_private, created_at DESC);
CREATE INDEX idx_access_tokens_user ON access_tokens(user_id, created_at DESC);
CREATE INDEX idx_access_tokens_prefix ON access_tokens(token_prefix);
