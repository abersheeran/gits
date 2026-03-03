PRAGMA foreign_keys = ON;

ALTER TABLE action_runs
  ADD COLUMN trigger_source_comment_id TEXT;

CREATE INDEX idx_action_runs_source_comment_lookup
  ON action_runs(repository_id, trigger_source_comment_id, run_number DESC);
