ALTER TABLE repository_actions_configs
ADD COLUMN instance_type TEXT
CHECK (instance_type IN ('lite', 'basic', 'standard-1', 'standard-2', 'standard-3', 'standard-4'));

ALTER TABLE action_runs
ADD COLUMN instance_type TEXT NOT NULL DEFAULT 'lite'
CHECK (instance_type IN ('lite', 'basic', 'standard-1', 'standard-2', 'standard-3', 'standard-4'));
