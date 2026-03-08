CREATE TABLE IF NOT EXISTS agent_session_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'session_created',
      'run_queued',
      'run_claimed',
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

CREATE INDEX IF NOT EXISTS idx_agent_session_steps_lookup
  ON agent_session_steps(repository_id, session_id, created_at ASC, id ASC);
