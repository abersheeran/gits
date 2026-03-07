CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('issue', 'issue_comment', 'pull_request', 'pull_request_review')),
  subject_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK (content IN ('+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(subject_type, subject_id, user_id, content)
);

CREATE INDEX IF NOT EXISTS idx_reactions_subject_lookup
  ON reactions(repository_id, subject_type, subject_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_reactions_user_lookup
  ON reactions(repository_id, user_id, created_at DESC);
