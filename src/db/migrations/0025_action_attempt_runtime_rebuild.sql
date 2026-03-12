DROP INDEX IF EXISTS idx_agent_session_attempt_artifacts_lookup;
DROP INDEX IF EXISTS idx_agent_session_attempt_events_lookup;
DROP INDEX IF EXISTS idx_agent_session_attempts_status_lookup;
DROP INDEX IF EXISTS idx_agent_session_attempts_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_latest_attempt_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_active_attempt_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_parent_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_source_comment_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_source_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_number_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_lookup;
DROP INDEX IF EXISTS idx_agent_session_interventions_lookup;
DROP INDEX IF EXISTS idx_agent_session_usage_lookup;
DROP INDEX IF EXISTS idx_agent_session_artifacts_lookup;
DROP INDEX IF EXISTS idx_agent_session_steps_lookup;

DROP TABLE IF EXISTS agent_session_attempt_artifacts;
DROP TABLE IF EXISTS agent_session_attempt_events;
DROP TABLE IF EXISTS agent_session_attempts;
DROP TABLE IF EXISTS agent_session_interventions;
DROP TABLE IF EXISTS agent_session_usage_records;
DROP TABLE IF EXISTS agent_session_artifacts;
DROP TABLE IF EXISTS agent_session_steps;
DROP TABLE IF EXISTS agent_sessions;

CREATE TABLE agent_sessions (
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
  logs TEXT NOT NULL DEFAULT '',
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

CREATE TABLE agent_session_attempts (
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

CREATE TABLE agent_session_attempt_events (
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

CREATE TABLE agent_session_attempt_artifacts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('session_logs', 'stdout', 'stderr')),
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

CREATE INDEX idx_agent_sessions_lookup
  ON agent_sessions(repository_id, created_at DESC);
CREATE INDEX idx_agent_sessions_number_lookup
  ON agent_sessions(repository_id, session_number DESC);
CREATE INDEX idx_agent_sessions_source_lookup
  ON agent_sessions(repository_id, source_type, source_number, created_at DESC);
CREATE INDEX idx_agent_sessions_source_comment_lookup
  ON agent_sessions(repository_id, source_comment_id, created_at DESC);
CREATE INDEX idx_agent_sessions_parent_lookup
  ON agent_sessions(repository_id, parent_session_id);
CREATE INDEX idx_agent_sessions_active_attempt_lookup
  ON agent_sessions(repository_id, active_attempt_id);
CREATE INDEX idx_agent_sessions_latest_attempt_lookup
  ON agent_sessions(repository_id, latest_attempt_id);
CREATE INDEX idx_agent_session_attempts_lookup
  ON agent_session_attempts(repository_id, session_id, attempt_number DESC);
CREATE INDEX idx_agent_session_attempts_status_lookup
  ON agent_session_attempts(repository_id, status, updated_at DESC);
CREATE INDEX idx_agent_session_attempt_events_lookup
  ON agent_session_attempt_events(repository_id, session_id, attempt_id, id ASC);
CREATE INDEX idx_agent_session_attempt_artifacts_lookup
  ON agent_session_attempt_artifacts(repository_id, session_id, attempt_id, updated_at DESC);
