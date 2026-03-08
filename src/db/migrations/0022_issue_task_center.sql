ALTER TABLE issues ADD COLUMN task_status TEXT NOT NULL DEFAULT 'open'
  CHECK (task_status IN ('open', 'agent-working', 'waiting-human', 'done'));
ALTER TABLE issues ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '';

UPDATE issues
SET task_status = CASE
  WHEN state = 'closed' THEN 'done'
  ELSE 'open'
END
WHERE task_status IS NULL
   OR task_status = '';
