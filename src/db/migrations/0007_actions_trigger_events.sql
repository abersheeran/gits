PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_action_runs_workflow;
DROP INDEX IF EXISTS idx_action_runs_lookup;
DROP INDEX IF EXISTS idx_action_workflows_lookup;

CREATE TABLE action_workflows_v2 (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('issue_created', 'pull_request_created', 'mention_actions', 'push')),
  command TEXT NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'codex' CHECK (agent_type IN ('codex', 'claude_code')),
  prompt TEXT NOT NULL,
  push_branch_regex TEXT,
  push_tag_regex TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(repository_id, name)
);

INSERT INTO action_workflows_v2 (
  id,
  repository_id,
  name,
  trigger_event,
  command,
  agent_type,
  prompt,
  push_branch_regex,
  push_tag_regex,
  enabled,
  created_by,
  created_at,
  updated_at
)
SELECT
  id,
  repository_id,
  name,
  CASE
    WHEN trigger_event = 'pull_request' THEN 'pull_request_created'
    WHEN trigger_event = 'workflow_dispatch' THEN 'mention_actions'
    ELSE trigger_event
  END,
  command,
  agent_type,
  prompt,
  NULL,
  NULL,
  enabled,
  created_by,
  created_at,
  updated_at
FROM action_workflows;

DROP TABLE action_workflows;
ALTER TABLE action_workflows_v2 RENAME TO action_workflows;

CREATE TABLE action_runs_v2 (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  run_number INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('issue_created', 'pull_request_created', 'mention_actions', 'push')),
  trigger_ref TEXT,
  trigger_sha TEXT,
  triggered_by TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  command TEXT NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'codex' CHECK (agent_type IN ('codex', 'claude_code')),
  prompt TEXT NOT NULL,
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

INSERT INTO action_runs_v2 (
  id,
  repository_id,
  run_number,
  workflow_id,
  trigger_event,
  trigger_ref,
  trigger_sha,
  triggered_by,
  status,
  command,
  agent_type,
  prompt,
  logs,
  exit_code,
  container_instance,
  created_at,
  started_at,
  completed_at,
  updated_at
)
SELECT
  id,
  repository_id,
  run_number,
  workflow_id,
  CASE
    WHEN trigger_event = 'pull_request' THEN 'pull_request_created'
    WHEN trigger_event = 'workflow_dispatch' THEN 'mention_actions'
    ELSE trigger_event
  END,
  trigger_ref,
  trigger_sha,
  triggered_by,
  status,
  command,
  agent_type,
  prompt,
  logs,
  exit_code,
  container_instance,
  created_at,
  started_at,
  completed_at,
  updated_at
FROM action_runs;

DROP TABLE action_runs;
ALTER TABLE action_runs_v2 RENAME TO action_runs;

CREATE INDEX idx_action_workflows_lookup
  ON action_workflows(repository_id, enabled, updated_at DESC);
CREATE INDEX idx_action_runs_lookup
  ON action_runs(repository_id, created_at DESC);
CREATE INDEX idx_action_runs_workflow
  ON action_runs(workflow_id, created_at DESC);

PRAGMA foreign_keys = ON;
