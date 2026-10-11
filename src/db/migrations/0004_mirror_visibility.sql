ALTER TABLE github_repositories
  ADD COLUMN visibility_override INTEGER CHECK (visibility_override IN (0, 1));
