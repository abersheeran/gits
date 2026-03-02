PRAGMA foreign_keys = ON;

CREATE TABLE repository_counters (
  repository_id TEXT PRIMARY KEY,
  issue_number_seq INTEGER NOT NULL DEFAULT 0,
  pull_number_seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ("open", "closed")),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(repository_id, number)
);

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ("open", "closed", "merged")),
  base_ref TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  base_oid TEXT NOT NULL,
  head_oid TEXT NOT NULL,
  merge_commit_oid TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  merged_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(repository_id, number)
);

CREATE INDEX idx_issues_repository_state_updated
  ON issues(repository_id, state, updated_at DESC);
CREATE INDEX idx_issues_repository_created
  ON issues(repository_id, created_at DESC);
CREATE INDEX idx_pull_requests_repository_state_updated
  ON pull_requests(repository_id, state, updated_at DESC);
CREATE INDEX idx_pull_requests_repository_created
  ON pull_requests(repository_id, created_at DESC);
