DROP TABLE IF EXISTS agent_session_attempt_artifacts;
DROP TABLE IF EXISTS agent_session_attempt_events;
DROP TABLE IF EXISTS agent_session_attempts;
DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS action_workflows;
DROP TABLE IF EXISTS repository_actions_configs;
DROP TABLE IF EXISTS global_settings;
DROP TABLE IF EXISTS pull_request_review_thread_comments;
DROP TABLE IF EXISTS pull_request_review_threads;
DROP TABLE IF EXISTS pull_request_reviews;
DROP TABLE IF EXISTS pull_request_closing_issues;
DROP TABLE IF EXISTS pull_requests;
DROP TABLE IF EXISTS issue_comments;
DROP TABLE IF EXISTS issues;
DROP TABLE IF EXISTS repository_counters;
DROP TABLE IF EXISTS repository_refs;

DELETE FROM access_tokens WHERE is_internal = 1;
DELETE FROM users WHERE id = 'actions-system-user';

ALTER TABLE access_tokens DROP COLUMN is_internal;
ALTER TABLE access_tokens DROP COLUMN display_as_actions;
