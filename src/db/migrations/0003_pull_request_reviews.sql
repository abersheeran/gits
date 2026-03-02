PRAGMA foreign_keys = ON;

CREATE TABLE pull_request_reviews (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  pull_request_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  reviewer_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('comment', 'approve', 'request_changes')),
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_pull_request_reviews_lookup
  ON pull_request_reviews(repository_id, pull_request_number, created_at ASC);
CREATE INDEX idx_pull_request_reviews_reviewer
  ON pull_request_reviews(repository_id, reviewer_id, created_at DESC);
