CREATE TABLE IF NOT EXISTS pull_request_review_threads (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  pull_request_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('base', 'head')),
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  resolved_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id, pull_request_number) REFERENCES pull_requests(repository_id, number) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pull_request_review_threads_lookup
  ON pull_request_review_threads(repository_id, pull_request_number, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_pull_request_review_threads_status
  ON pull_request_review_threads(repository_id, pull_request_number, status, updated_at DESC);
