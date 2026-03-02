PRAGMA foreign_keys = ON;

CREATE TABLE pull_request_closing_issues (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  pull_request_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  issue_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id, issue_number) REFERENCES issues(repository_id, number) ON DELETE CASCADE,
  UNIQUE(repository_id, pull_request_id, issue_number)
);

CREATE INDEX idx_pull_request_closing_issues_lookup
  ON pull_request_closing_issues(repository_id, pull_request_number, issue_number ASC);
