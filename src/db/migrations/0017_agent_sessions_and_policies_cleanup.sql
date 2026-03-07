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

CREATE INDEX IF NOT EXISTS idx_agent_sessions_lookup
  ON agent_sessions(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_source_lookup
  ON agent_sessions(repository_id, source_type, source_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_linked_run_lookup
  ON agent_sessions(repository_id, linked_run_id);
