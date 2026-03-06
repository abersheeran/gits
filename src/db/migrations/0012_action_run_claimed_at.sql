PRAGMA foreign_keys = ON;

ALTER TABLE action_runs
  ADD COLUMN claimed_at INTEGER;
