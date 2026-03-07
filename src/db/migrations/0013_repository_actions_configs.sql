CREATE TABLE IF NOT EXISTS repository_actions_configs (
  repository_id TEXT PRIMARY KEY,
  codex_config_file_content TEXT,
  claude_code_config_file_content TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);
