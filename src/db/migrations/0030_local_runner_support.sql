-- Add runner_type to agent_sessions
ALTER TABLE agent_sessions ADD COLUMN runner_type TEXT NOT NULL DEFAULT 'cloud' CHECK (runner_type IN ('cloud', 'local'));

-- Add runner_type to agent_session_attempts
ALTER TABLE agent_session_attempts ADD COLUMN runner_type TEXT NOT NULL DEFAULT 'cloud' CHECK (runner_type IN ('cloud', 'local'));

-- Add runner_type to repository_actions_configs
ALTER TABLE repository_actions_configs ADD COLUMN runner_type TEXT DEFAULT 'cloud' CHECK (runner_type IS NULL OR runner_type IN ('cloud', 'local'));

-- Index for local runner polling (find queued local sessions)
CREATE INDEX idx_agent_sessions_runner_poll ON agent_sessions(runner_type, status) WHERE runner_type = 'local' AND status = 'queued';
