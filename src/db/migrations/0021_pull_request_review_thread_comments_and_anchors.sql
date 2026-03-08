ALTER TABLE pull_request_review_threads ADD COLUMN base_oid TEXT;
ALTER TABLE pull_request_review_threads ADD COLUMN head_oid TEXT;
ALTER TABLE pull_request_review_threads ADD COLUMN start_side TEXT CHECK (start_side IN ('base', 'head'));
ALTER TABLE pull_request_review_threads ADD COLUMN start_line INTEGER;
ALTER TABLE pull_request_review_threads ADD COLUMN end_side TEXT CHECK (end_side IN ('base', 'head'));
ALTER TABLE pull_request_review_threads ADD COLUMN end_line INTEGER;
ALTER TABLE pull_request_review_threads ADD COLUMN hunk_header TEXT;

UPDATE pull_request_review_threads
SET start_side = side,
    start_line = line,
    end_side = side,
    end_line = line
WHERE start_side IS NULL
   OR start_line IS NULL
   OR end_side IS NULL
   OR end_line IS NULL;

CREATE TABLE IF NOT EXISTS pull_request_review_thread_comments (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  pull_request_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  thread_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  suggested_start_line INTEGER,
  suggested_end_line INTEGER,
  suggested_side TEXT CHECK (suggested_side IN ('base', 'head')),
  suggested_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id, pull_request_number) REFERENCES pull_requests(repository_id, number) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES pull_request_review_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pull_request_review_thread_comments_lookup
  ON pull_request_review_thread_comments(repository_id, pull_request_number, thread_id, created_at ASC);
