CREATE TABLE IF NOT EXISTS agent_session_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'run_logs',
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
      'run_log_chars',
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

CREATE INDEX IF NOT EXISTS idx_agent_session_artifacts_lookup
  ON agent_session_artifacts(repository_id, session_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_session_usage_lookup
  ON agent_session_usage_records(repository_id, session_id, updated_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_agent_session_interventions_lookup
  ON agent_session_interventions(repository_id, session_id, created_at ASC, id ASC);
