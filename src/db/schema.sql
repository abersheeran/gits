PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_private INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS repository_collaborators (
  repository_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ("read", "write", "admin")),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, user_id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  display_as_actions INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repository_counters (
  repository_id TEXT PRIMARY KEY,
  issue_number_seq INTEGER NOT NULL DEFAULT 0,
  pull_number_seq INTEGER NOT NULL DEFAULT 0,
  action_run_seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issues (
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

CREATE TABLE IF NOT EXISTS issue_comments (
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

CREATE TABLE IF NOT EXISTS pull_requests (
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

CREATE TABLE IF NOT EXISTS pull_request_reviews (
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

CREATE TABLE IF NOT EXISTS pull_request_closing_issues (
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

CREATE TABLE IF NOT EXISTS global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS action_workflows (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('issue_created', 'pull_request_created', 'mention_actions', 'push')),
  command TEXT NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'codex' CHECK (agent_type IN ('codex', 'claude_code')),
  prompt TEXT NOT NULL,
  push_branch_regex TEXT,
  push_tag_regex TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(repository_id, name)
);

CREATE TABLE IF NOT EXISTS action_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  run_number INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('issue_created', 'pull_request_created', 'mention_actions', 'push')),
  trigger_ref TEXT,
  trigger_sha TEXT,
  trigger_source_type TEXT CHECK (trigger_source_type IN ('issue', 'pull_request')),
  trigger_source_number INTEGER,
  trigger_source_comment_id TEXT,
  triggered_by TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  command TEXT NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'codex' CHECK (agent_type IN ('codex', 'claude_code')),
  prompt TEXT NOT NULL,
  logs TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  container_instance TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES action_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(repository_id, run_number)
);

CREATE INDEX IF NOT EXISTS idx_repositories_owner ON repositories(owner_id);
CREATE INDEX IF NOT EXISTS idx_repositories_visibility ON repositories(is_private, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user ON access_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_tokens_prefix ON access_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_issues_repository_state_updated
  ON issues(repository_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_repository_created
  ON issues(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_comments_lookup
  ON issue_comments(repository_id, issue_number, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repository_state_updated
  ON pull_requests(repository_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repository_created
  ON pull_requests(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_request_reviews_lookup
  ON pull_request_reviews(repository_id, pull_request_number, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_pull_request_reviews_reviewer
  ON pull_request_reviews(repository_id, reviewer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_request_closing_issues_lookup
  ON pull_request_closing_issues(repository_id, pull_request_number, issue_number ASC);
CREATE INDEX IF NOT EXISTS idx_action_workflows_lookup
  ON action_workflows(repository_id, enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_runs_lookup
  ON action_runs(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_runs_workflow
  ON action_runs(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_runs_source_lookup
  ON action_runs(repository_id, trigger_source_type, trigger_source_number, run_number DESC);
CREATE INDEX IF NOT EXISTS idx_action_runs_source_comment_lookup
  ON action_runs(repository_id, trigger_source_comment_id, run_number DESC);
