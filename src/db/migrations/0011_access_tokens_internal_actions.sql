ALTER TABLE access_tokens
  ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;

ALTER TABLE access_tokens
  ADD COLUMN display_as_actions INTEGER NOT NULL DEFAULT 0;
