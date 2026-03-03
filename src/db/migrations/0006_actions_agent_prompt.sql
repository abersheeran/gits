PRAGMA foreign_keys = ON;

ALTER TABLE action_workflows
  ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'codex' CHECK (agent_type IN ('codex', 'claude_code'));
ALTER TABLE action_workflows
  ADD COLUMN prompt TEXT NOT NULL DEFAULT '';

UPDATE action_workflows
SET prompt = command
WHERE prompt = '';

ALTER TABLE action_runs
  ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'codex' CHECK (agent_type IN ('codex', 'claude_code'));
ALTER TABLE action_runs
  ADD COLUMN prompt TEXT NOT NULL DEFAULT '';

UPDATE action_runs
SET prompt = command
WHERE prompt = '';
