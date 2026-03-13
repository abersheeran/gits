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
  session_number_seq INTEGER NOT NULL DEFAULT 0,
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
  task_status TEXT NOT NULL DEFAULT 'open' CHECK (task_status IN ('open', 'agent-working', 'waiting-human', 'done')),
  acceptance_criteria TEXT NOT NULL DEFAULT '',
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
  base_oid TEXT,
  head_oid TEXT,
  start_side TEXT CHECK (start_side IN ('base', 'head')),
  start_line INTEGER,
  end_side TEXT CHECK (end_side IN ('base', 'head')),
  end_line INTEGER,
  hunk_header TEXT,
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

CREATE TABLE IF NOT EXISTS repository_actions_configs (
  repository_id TEXT PRIMARY KEY,
  instance_type TEXT CHECK (instance_type IN ('lite', 'basic', 'standard-1', 'standard-2', 'standard-3', 'standard-4')),
  codex_config_file_content TEXT,
  claude_code_config_file_content TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_workflows (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('issue_created', 'pull_request_created', 'mention_actions', 'push')),
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

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('issue', 'pull_request', 'manual')),
  source_number INTEGER,
  source_comment_id TEXT,
  origin TEXT NOT NULL CHECK (
    origin IN (
      'workflow',
      'mention',
      'manual',
      'rerun',
      'dispatch',
      'issue_assign',
      'issue_resume',
      'pull_request_resume'
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  agent_type TEXT NOT NULL CHECK (agent_type IN ('codex', 'claude_code')),
  instance_type TEXT NOT NULL DEFAULT 'lite' CHECK (instance_type IN ('lite', 'basic', 'standard-1', 'standard-2', 'standard-3', 'standard-4')),
  prompt TEXT NOT NULL,
  branch_ref TEXT,
  trigger_ref TEXT,
  trigger_sha TEXT,
  workflow_id TEXT,
  parent_session_id TEXT,
  created_by TEXT,
  delegated_from_user_id TEXT,
  exit_code INTEGER,
  container_instance TEXT,
  active_attempt_id TEXT,
  latest_attempt_id TEXT,
  failure_reason TEXT CHECK (
    failure_reason IS NULL OR
    failure_reason IN (
      'boot_timeout',
      'container_error',
      'dockerd_bootstrap_failed',
      'stream_disconnected',
      'missing_result',
      'workspace_preparation_failed',
      'git_clone_failed',
      'git_checkout_failed',
      'agent_exit_non_zero',
      'storage_write_failed',
      'cancel_requested',
      'unknown_infra_failure',
      'unknown_task_failure'
    )
  ),
  failure_stage TEXT CHECK (
    failure_stage IS NULL OR
    failure_stage IN ('boot', 'workspace', 'runtime', 'result', 'logs', 'side_effects', 'unknown')
  ),
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES action_workflows(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (delegated_from_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(repository_id, session_number)
);

CREATE TABLE IF NOT EXISTS agent_session_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'booting',
      'running',
      'retryable_failed',
      'failed',
      'success',
      'cancelled'
    )
  ),
  instance_type TEXT NOT NULL CHECK (instance_type IN ('lite', 'basic', 'standard-1', 'standard-2', 'standard-3', 'standard-4')),
  promoted_from_instance_type TEXT CHECK (
    promoted_from_instance_type IS NULL OR
    promoted_from_instance_type IN ('lite', 'basic', 'standard-1', 'standard-2', 'standard-3', 'standard-4')
  ),
  container_instance TEXT,
  exit_code INTEGER,
  failure_reason TEXT CHECK (
    failure_reason IS NULL OR
    failure_reason IN (
      'boot_timeout',
      'container_error',
      'dockerd_bootstrap_failed',
      'stream_disconnected',
      'missing_result',
      'workspace_preparation_failed',
      'git_clone_failed',
      'git_checkout_failed',
      'agent_exit_non_zero',
      'storage_write_failed',
      'cancel_requested',
      'unknown_infra_failure',
      'unknown_task_failure'
    )
  ),
  failure_stage TEXT CHECK (
    failure_stage IS NULL OR
    failure_stage IN ('boot', 'workspace', 'runtime', 'result', 'logs', 'side_effects', 'unknown')
  ),
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE(session_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS agent_session_attempt_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN (
      'attempt_created',
      'attempt_claimed',
      'attempt_started',
      'stdout_chunk',
      'stderr_chunk',
      'heartbeat',
      'warning',
      'result_reported',
      'retry_scheduled',
      'attempt_completed'
    )
  ),
  stream TEXT NOT NULL CHECK (stream IN ('system', 'stdout', 'stderr', 'error')),
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES agent_session_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_session_attempt_artifacts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'session_logs',
      'stdout',
      'stderr'
    )
  ),
  title TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES agent_session_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE(attempt_id, kind)
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
CREATE INDEX IF NOT EXISTS idx_pull_request_review_threads_lookup
  ON pull_request_review_threads(repository_id, pull_request_number, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_pull_request_review_threads_status
  ON pull_request_review_threads(repository_id, pull_request_number, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_request_review_thread_comments_lookup
  ON pull_request_review_thread_comments(repository_id, pull_request_number, thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_pull_request_closing_issues_lookup
  ON pull_request_closing_issues(repository_id, pull_request_number, issue_number ASC);
CREATE INDEX IF NOT EXISTS idx_action_workflows_lookup
  ON action_workflows(repository_id, enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_lookup
  ON agent_sessions(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_number_lookup
  ON agent_sessions(repository_id, session_number DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_source_lookup
  ON agent_sessions(repository_id, source_type, source_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_source_comment_lookup
  ON agent_sessions(repository_id, source_comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_parent_lookup
  ON agent_sessions(repository_id, parent_session_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_active_attempt_lookup
  ON agent_sessions(repository_id, active_attempt_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_latest_attempt_lookup
  ON agent_sessions(repository_id, latest_attempt_id);
CREATE INDEX IF NOT EXISTS idx_agent_session_attempts_lookup
  ON agent_session_attempts(repository_id, session_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_agent_session_attempts_status_lookup
  ON agent_session_attempts(repository_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_session_attempt_events_lookup
  ON agent_session_attempt_events(repository_id, session_id, attempt_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_agent_session_attempt_artifacts_lookup
  ON agent_session_attempt_artifacts(repository_id, session_id, attempt_id, updated_at DESC);
