PRAGMA foreign_keys = OFF;

CREATE TABLE issues_next (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ("open", "closed")),
  task_status TEXT NOT NULL DEFAULT 'open' CHECK (task_status IN ('open', 'agent-working', 'waiting-human', 'done')),
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(repository_id, number)
);

INSERT INTO issues_next (
  id,
  repository_id,
  number,
  author_id,
  title,
  body,
  state,
  task_status,
  acceptance_criteria,
  created_at,
  updated_at,
  closed_at
)
SELECT
  id,
  repository_id,
  number,
  author_id,
  title,
  body,
  state,
  task_status,
  acceptance_criteria,
  created_at,
  updated_at,
  closed_at
FROM issues;

DROP TABLE issues;
ALTER TABLE issues_next RENAME TO issues;

CREATE TABLE pull_requests_next (
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
  draft INTEGER NOT NULL DEFAULT 0,
  merge_commit_oid TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  merged_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(repository_id, number)
);

INSERT INTO pull_requests_next (
  id,
  repository_id,
  number,
  author_id,
  title,
  body,
  state,
  base_ref,
  head_ref,
  base_oid,
  head_oid,
  draft,
  merge_commit_oid,
  created_at,
  updated_at,
  closed_at,
  merged_at
)
SELECT
  id,
  repository_id,
  number,
  author_id,
  title,
  body,
  state,
  base_ref,
  head_ref,
  base_oid,
  head_oid,
  draft,
  merge_commit_oid,
  created_at,
  updated_at,
  closed_at,
  merged_at
FROM pull_requests;

DROP TABLE pull_requests;
ALTER TABLE pull_requests_next RENAME TO pull_requests;

DROP TABLE IF EXISTS issue_labels;
DROP TABLE IF EXISTS pull_request_labels;
DROP TABLE IF EXISTS repository_labels;
DROP TABLE IF EXISTS repository_milestones;

CREATE INDEX IF NOT EXISTS idx_issues_repository_state_updated
  ON issues(repository_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_repository_created
  ON issues(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repository_state_updated
  ON pull_requests(repository_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repository_created
  ON pull_requests(repository_id, created_at DESC);

PRAGMA foreign_keys = ON;
