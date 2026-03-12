DROP TABLE IF EXISTS repository_counters_v2;
CREATE TABLE repository_counters_v2 (
  repository_id TEXT PRIMARY KEY,
  issue_number_seq INTEGER NOT NULL DEFAULT 0,
  pull_number_seq INTEGER NOT NULL DEFAULT 0,
  session_number_seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

INSERT INTO repository_counters_v2 (
  repository_id,
  issue_number_seq,
  pull_number_seq,
  session_number_seq
)
SELECT
  repository_id,
  issue_number_seq,
  pull_number_seq,
  action_run_seq
FROM repository_counters;

DROP TABLE repository_counters;
ALTER TABLE repository_counters_v2 RENAME TO repository_counters;

DROP INDEX IF EXISTS idx_agent_session_interventions_lookup;
DROP INDEX IF EXISTS idx_agent_session_usage_lookup;
DROP INDEX IF EXISTS idx_agent_session_artifacts_lookup;
DROP INDEX IF EXISTS idx_agent_session_steps_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_parent_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_source_comment_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_number_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_source_lookup;
DROP INDEX IF EXISTS idx_agent_sessions_lookup;
DROP INDEX IF EXISTS idx_action_runs_source_comment_lookup;
DROP INDEX IF EXISTS idx_action_runs_source_lookup;
DROP INDEX IF EXISTS idx_action_runs_workflow;
DROP INDEX IF EXISTS idx_action_runs_lookup;

DROP TABLE IF EXISTS agent_session_interventions;
DROP TABLE IF EXISTS agent_session_usage_records;
DROP TABLE IF EXISTS agent_session_artifacts;
DROP TABLE IF EXISTS agent_session_steps;
DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS action_runs;

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
  logs TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  container_instance TEXT,
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

CREATE TABLE IF NOT EXISTS agent_session_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'session_created',
      'session_queued',
      'session_claimed',
      'session_started',
      'session_completed',
      'session_cancelled'
    )
  ),
  title TEXT NOT NULL,
  detail TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_session_artifacts (
  id TEXT PRIMARY KEY,
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
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE(session_id, kind)
);

CREATE TABLE IF NOT EXISTS agent_session_usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'duration_ms',
      'exit_code',
      'log_chars',
      'stdout_chars',
      'stderr_chars'
    )
  ),
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  detail TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE(session_id, kind)
);

CREATE TABLE IF NOT EXISTS agent_session_interventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'cancel_requested',
      'mcp_setup_warning'
    )
  ),
  title TEXT NOT NULL,
  detail TEXT,
  created_by TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

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
CREATE INDEX IF NOT EXISTS idx_agent_session_steps_lookup
  ON agent_session_steps(repository_id, session_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_agent_session_artifacts_lookup
  ON agent_session_artifacts(repository_id, session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_session_usage_lookup
  ON agent_session_usage_records(repository_id, session_id, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_agent_session_interventions_lookup
  ON agent_session_interventions(repository_id, session_id, created_at ASC, id ASC);
