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
  milestone_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id) REFERENCES repository_milestones(id) ON DELETE SET NULL,
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
  milestone_id TEXT,
  merge_commit_oid TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  merged_at INTEGER,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id) REFERENCES repository_milestones(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS repository_actions_configs (
  repository_id TEXT PRIMARY KEY,
  instance_type TEXT CHECK (instance_type IN ('lite', 'basic', 'standard-1', 'standard-2', 'standard-3', 'standard-4')),
  codex_config_file_content TEXT,
  claude_code_config_file_content TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);


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
  instance_type TEXT NOT NULL DEFAULT 'lite' CHECK (instance_type IN ('lite', 'basic', 'standard-1', 'standard-2', 'standard-3', 'standard-4')),
  prompt TEXT NOT NULL,
  logs TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  container_instance TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES action_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(repository_id, run_number)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
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
  prompt TEXT NOT NULL,
  branch_ref TEXT,
  trigger_ref TEXT,
  trigger_sha TEXT,
  workflow_id TEXT,
  linked_run_id TEXT UNIQUE,
  created_by TEXT,
  delegated_from_user_id TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES action_workflows(id) ON DELETE SET NULL,
  FOREIGN KEY (linked_run_id) REFERENCES action_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (delegated_from_user_id) REFERENCES users(id) ON DELETE SET NULL
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
CREATE INDEX IF NOT EXISTS idx_agent_sessions_lookup
  ON agent_sessions(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_source_lookup
  ON agent_sessions(repository_id, source_type, source_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_linked_run_lookup
  ON agent_sessions(repository_id, linked_run_id);
CREATE INDEX IF NOT EXISTS idx_reactions_subject_lookup
  ON reactions(repository_id, subject_type, subject_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_reactions_user_lookup
  ON reactions(repository_id, user_id, created_at DESC);
