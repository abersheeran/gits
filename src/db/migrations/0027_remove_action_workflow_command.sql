PRAGMA foreign_keys = OFF;

CREATE TABLE action_workflows_next (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('issue_created', 'pull_request_created', 'mention_actions', 'push')),
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

INSERT INTO action_workflows_next (
  id,
  repository_id,
  name,
  trigger_event,
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
  trigger_event,
  agent_type,
  prompt,
  push_branch_regex,
  push_tag_regex,
  enabled,
  created_by,
  created_at,
  updated_at
FROM action_workflows;

DROP TABLE action_workflows;
ALTER TABLE action_workflows_next RENAME TO action_workflows;

PRAGMA foreign_keys = ON;
