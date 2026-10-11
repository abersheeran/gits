CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT NOT NULL,
  ip_address TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, created_at DESC, id DESC);
CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE github_oauth_states (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_github_oauth_states_expiry ON github_oauth_states(expires_at);
CREATE INDEX idx_github_oauth_states_session ON github_oauth_states(session_id);
