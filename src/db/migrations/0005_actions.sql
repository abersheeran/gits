PRAGMA foreign_keys = ON;

ALTER TABLE repository_counters
  ADD COLUMN action_run_seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE action_workflows (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('push', 'pull_request', 'workflow_dispatch')),
  command TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(repository_id, name)
);

CREATE TABLE action_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  run_number INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('push', 'pull_request', 'workflow_dispatch')),
  trigger_ref TEXT,
  trigger_sha TEXT,
  triggered_by TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  command TEXT NOT NULL,
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

CREATE INDEX idx_action_workflows_lookup
  ON action_workflows(repository_id, enabled, updated_at DESC);
CREATE INDEX idx_action_runs_lookup
  ON action_runs(repository_id, created_at DESC);
CREATE INDEX idx_action_runs_workflow
  ON action_runs(workflow_id, created_at DESC);
