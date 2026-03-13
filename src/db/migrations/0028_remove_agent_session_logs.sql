PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_agent_sessions_latest_attempt_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_active_attempt_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_parent_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_source_comment_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_source_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_number_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_lookup;

CREATE TABLE agent_sessions_v2 (
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

INSERT INTO agent_sessions_v2 (
  id,
  repository_id,
  session_number,
  source_type,
  source_number,
  source_comment_id,
  origin,
  status,
  agent_type,
  instance_type,
  prompt,
  branch_ref,
  trigger_ref,
  trigger_sha,
  workflow_id,
  parent_session_id,
  created_by,
  delegated_from_user_id,
  exit_code,
  container_instance,
  active_attempt_id,
  latest_attempt_id,
  failure_reason,
  failure_stage,
  created_at,
  claimed_at,
  started_at,
  completed_at,
  updated_at
)
SELECT
  id,
  repository_id,
  session_number,
  source_type,
  source_number,
  source_comment_id,
  origin,
  status,
  agent_type,
  instance_type,
  prompt,
  branch_ref,
  trigger_ref,
  trigger_sha,
  workflow_id,
  parent_session_id,
  created_by,
  delegated_from_user_id,
  exit_code,
  container_instance,
  active_attempt_id,
  latest_attempt_id,
  failure_reason,
  failure_stage,
  created_at,
  claimed_at,
  started_at,
  completed_at,
  updated_at
FROM agent_sessions;

DROP TABLE agent_sessions;
ALTER TABLE agent_sessions_v2 RENAME TO agent_sessions;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_lookup
  ON agent_sessions(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_number_lookup
  ON agent_sessions(repository_id, session_number DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_source_lookup
  ON agent_sessions(repository_id, source_type, source_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_source_comment_lookup
  ON agent_sessions(repository_id, source_comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_parent_lookup
  ON agent_sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_active_attempt_lookup
  ON agent_sessions(active_attempt_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_latest_attempt_lookup
  ON agent_sessions(latest_attempt_id);

PRAGMA foreign_keys = ON;
