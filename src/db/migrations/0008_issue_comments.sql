PRAGMA foreign_keys = ON;

CREATE TABLE issue_comments (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id, issue_number) REFERENCES issues(repository_id, number) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_issue_comments_lookup
  ON issue_comments(repository_id, issue_number, created_at ASC);
