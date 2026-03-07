ALTER TABLE pull_requests ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS repository_milestones (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE(repository_id, title)
);

ALTER TABLE issues ADD COLUMN milestone_id TEXT REFERENCES repository_milestones(id) ON DELETE SET NULL;
ALTER TABLE pull_requests ADD COLUMN milestone_id TEXT REFERENCES repository_milestones(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS repository_labels (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE(repository_id, name)
);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issue_id, label_id),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES repository_labels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_request_labels (
  pull_request_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pull_request_id, label_id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES repository_labels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issue_assignees (
  issue_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issue_id, user_id),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_request_assignees (
  pull_request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pull_request_id, user_id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pull_request_review_requests (
  pull_request_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pull_request_id, reviewer_id),
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repository_labels_lookup
  ON repository_labels(repository_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_repository_milestones_lookup
  ON repository_milestones(repository_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_labels_lookup
  ON issue_labels(issue_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_pull_request_labels_lookup
  ON pull_request_labels(pull_request_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_issue_assignees_lookup
  ON issue_assignees(issue_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_pull_request_assignees_lookup
  ON pull_request_assignees(pull_request_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_pull_request_review_requests_lookup
  ON pull_request_review_requests(pull_request_id, created_at ASC);
