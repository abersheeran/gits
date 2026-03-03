PRAGMA foreign_keys = ON;

ALTER TABLE action_runs
  ADD COLUMN trigger_source_type TEXT CHECK (trigger_source_type IN ('issue', 'pull_request'));
ALTER TABLE action_runs
  ADD COLUMN trigger_source_number INTEGER;

CREATE INDEX idx_action_runs_source_lookup
  ON action_runs(repository_id, trigger_source_type, trigger_source_number, run_number DESC);
