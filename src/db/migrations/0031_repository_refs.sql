CREATE TABLE IF NOT EXISTS repository_refs (
  repository_id TEXT NOT NULL,
  ref_name TEXT NOT NULL,
  oid TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, ref_name),
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repository_refs_default
  ON repository_refs(repository_id, is_default)
  WHERE is_default = 1;
