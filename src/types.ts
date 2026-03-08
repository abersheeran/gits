export type GitServiceName = "git-upload-pack" | "git-receive-pack";

export type AuthUser = {
  id: string;
  username: string;
};

export type AccessTokenContext = {
  tokenId: string;
  isInternal: boolean;
  displayAsActions: boolean;
};

export type RepositoryRecord = {
  id: string;
  owner_id: string;
  owner_username: string;
  name: string;
  description: string | null;
  is_private: number;
  created_at: number;
};

export type CollaboratorPermission = "read" | "write" | "admin";

export type IssueState = "open" | "closed";
export type IssueTaskStatus = "open" | "agent-working" | "waiting-human" | "done";

export type PullRequestState = "open" | "closed" | "merged";

export type MilestoneState = "open" | "closed";

export type PullRequestReviewDecision = "comment" | "approve" | "request_changes";
export type PullRequestReviewThreadSide = "base" | "head";
export type PullRequestReviewThreadStatus = "open" | "resolved";

export type PullRequestReviewThreadSuggestionRecord = {
  side: PullRequestReviewThreadSide;
  start_line: number;
  end_line: number;
  code: string;
};

export type PullRequestReviewThreadAnchorStatus = "current" | "reanchored" | "stale";

export type PullRequestReviewThreadAnchorRecord = {
  status: PullRequestReviewThreadAnchorStatus;
  patchset_changed: boolean;
  path: string;
  line: number | null;
  side: PullRequestReviewThreadSide;
  start_side: PullRequestReviewThreadSide;
  start_line: number | null;
  end_side: PullRequestReviewThreadSide;
  end_line: number | null;
  hunk_header: string | null;
  message: string;
};

export type ActionWorkflowTrigger =
  | "issue_created"
  | "pull_request_created"
  | "mention_actions"
  | "push";

export type ActionAgentType = "codex" | "claude_code";

export type AgentSessionSourceType = "issue" | "pull_request" | "manual";

export type AgentSessionOrigin =
  | "workflow"
  | "mention"
  | "manual"
  | "rerun"
  | "dispatch"
  | "issue_assign"
  | "issue_resume"
  | "pull_request_resume";

export type ActionContainerInstanceType =
  | "lite"
  | "basic"
  | "standard-1"
  | "standard-2"
  | "standard-3"
  | "standard-4";

export type ActionRunStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export type ActionRunSourceType = "issue" | "pull_request";

export type AgentSessionStatus = ActionRunStatus;

export type AgentSessionStepKind =
  | "session_created"
  | "run_queued"
  | "run_claimed"
  | "session_started"
  | "session_completed"
  | "session_cancelled";

export type AgentSessionArtifactKind = "run_logs" | "stdout" | "stderr";

export type AgentSessionUsageKind =
  | "duration_ms"
  | "exit_code"
  | "run_log_chars"
  | "stdout_chars"
  | "stderr_chars";

export type AgentSessionInterventionKind = "cancel_requested" | "mcp_setup_warning";

export type AgentSessionValidationCheckKind = "tests" | "build" | "lint";

export type AgentSessionValidationCheckStatus =
  | "passed"
  | "failed"
  | "pending"
  | "cancelled";

export type ActionRunQueueMessage = {
  repositoryId: string;
  runId: string;
  requestOrigin: string;
};

export type ReactionSubjectType =
  | "issue"
  | "issue_comment"
  | "pull_request"
  | "pull_request_review";

export type ReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "hooray"
  | "confused"
  | "heart"
  | "rocket"
  | "eyes";

export type RepositoryUserSummary = {
  id: string;
  username: string;
};

export type RepositoryLabelRecord = {
  id: string;
  repository_id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: number;
  updated_at: number;
};

export type RepositoryMilestoneRecord = {
  id: string;
  repository_id: string;
  title: string;
  description: string;
  state: MilestoneState;
  due_at: number | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

export type ReactionSummary = {
  content: ReactionContent;
  count: number;
  viewer_reacted: boolean;
};

export type IssueRecord = {
  id: string;
  repository_id: string;
  number: number;
  author_id: string;
  author_username: string;
  title: string;
  body: string;
  state: IssueState;
  task_status: IssueTaskStatus;
  acceptance_criteria: string;
  comment_count: number;
  labels: RepositoryLabelRecord[];
  assignees: RepositoryUserSummary[];
  milestone: RepositoryMilestoneRecord | null;
  reactions: ReactionSummary[];
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

export type IssueLinkedPullRequestRecord = {
  id: string;
  repository_id: string;
  number: number;
  author_id: string;
  author_username: string;
  title: string;
  state: PullRequestState;
  draft: boolean;
  base_ref: string;
  head_ref: string;
  merge_commit_oid: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  merged_at: number | null;
};

export type IssueCommentRecord = {
  id: string;
  repository_id: string;
  issue_id: string;
  issue_number: number;
  author_id: string;
  author_username: string;
  body: string;
  reactions: ReactionSummary[];
  created_at: number;
  updated_at: number;
};

export type PullRequestRecord = {
  id: string;
  repository_id: string;
  number: number;
  author_id: string;
  author_username: string;
  title: string;
  body: string;
  state: PullRequestState;
  draft: boolean;
  base_ref: string;
  head_ref: string;
  base_oid: string;
  head_oid: string;
  labels: RepositoryLabelRecord[];
  assignees: RepositoryUserSummary[];
  requested_reviewers: RepositoryUserSummary[];
  milestone: RepositoryMilestoneRecord | null;
  reactions: ReactionSummary[];
  mergeable?: "mergeable" | "conflicting" | "unknown";
  ahead_by?: number;
  behind_by?: number;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  merge_commit_oid: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  merged_at: number | null;
};

export type PullRequestReviewRecord = {
  id: string;
  repository_id: string;
  pull_request_id: string;
  pull_request_number: number;
  reviewer_id: string;
  reviewer_username: string;
  decision: PullRequestReviewDecision;
  body: string;
  reactions: ReactionSummary[];
  created_at: number;
};

export type PullRequestReviewThreadRecord = {
  id: string;
  repository_id: string;
  pull_request_id: string;
  pull_request_number: number;
  author_id: string;
  author_username: string;
  path: string;
  line: number;
  side: PullRequestReviewThreadSide;
  body: string;
  base_oid: string | null;
  head_oid: string | null;
  start_side: PullRequestReviewThreadSide;
  start_line: number;
  end_side: PullRequestReviewThreadSide;
  end_line: number;
  hunk_header: string | null;
  status: PullRequestReviewThreadStatus;
  resolved_by: string | null;
  resolved_by_username: string | null;
  anchor?: PullRequestReviewThreadAnchorRecord;
  comments: PullRequestReviewThreadCommentRecord[];
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
};

export type PullRequestReviewThreadCommentRecord = {
  id: string;
  repository_id: string;
  pull_request_id: string;
  pull_request_number: number;
  thread_id: string;
  author_id: string;
  author_username: string;
  body: string;
  suggestion: PullRequestReviewThreadSuggestionRecord | null;
  created_at: number;
  updated_at: number;
};

export type ActionWorkflowRecord = {
  id: string;
  repository_id: string;
  name: string;
  trigger_event: ActionWorkflowTrigger;
  agent_type: ActionAgentType;
  prompt: string;
  push_branch_regex: string | null;
  push_tag_regex: string | null;
  enabled: number;
  created_by: string;
  created_at: number;
  updated_at: number;
};

export type ActionRunRecord = {
  id: string;
  repository_id: string;
  run_number: number;
  workflow_id: string;
  workflow_name: string;
  trigger_event: ActionWorkflowTrigger;
  trigger_ref: string | null;
  trigger_sha: string | null;
  trigger_source_type: ActionRunSourceType | null;
  trigger_source_number: number | null;
  trigger_source_comment_id: string | null;
  triggered_by: string | null;
  triggered_by_username: string | null;
  status: ActionRunStatus;
  agent_type: ActionAgentType;
  instance_type: ActionContainerInstanceType;
  prompt: string;
  logs: string;
  exit_code: number | null;
  container_instance: string | null;
  created_at: number;
  claimed_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

export type ActionsGlobalConfig = {
  codexConfigFileContent: string;
  claudeCodeConfigFileContent: string;
  updated_at: number | null;
};

export type RepositoryActionsConfig = {
  instanceType: ActionContainerInstanceType;
  codexConfigFileContent: string;
  claudeCodeConfigFileContent: string;
  inheritsGlobalCodexConfig: boolean;
  inheritsGlobalClaudeCodeConfig: boolean;
  updated_at: number | null;
};

export type AgentSessionRecord = {
  id: string;
  repository_id: string;
  source_type: AgentSessionSourceType;
  source_number: number | null;
  source_comment_id: string | null;
  origin: AgentSessionOrigin;
  status: AgentSessionStatus;
  agent_type: ActionAgentType;
  prompt: string;
  branch_ref: string | null;
  trigger_ref: string | null;
  trigger_sha: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  linked_run_id: string | null;
  created_by: string | null;
  created_by_username: string | null;
  delegated_from_user_id: string | null;
  delegated_from_username: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

export type AgentSessionStepRecord = {
  id: number;
  session_id: string;
  repository_id: string;
  kind: AgentSessionStepKind;
  title: string;
  detail: string | null;
  payload: Record<string, unknown> | null;
  created_at: number;
};

export type AgentSessionArtifactRecord = {
  id: string;
  session_id: string;
  repository_id: string;
  kind: AgentSessionArtifactKind;
  title: string;
  media_type: string;
  size_bytes: number;
  content_text: string;
  created_at: number;
  updated_at: number;
};

export type AgentSessionUsageRecord = {
  id: number;
  session_id: string;
  repository_id: string;
  kind: AgentSessionUsageKind;
  value: number;
  unit: string;
  detail: string | null;
  payload: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
};

export type AgentSessionInterventionRecord = {
  id: number;
  session_id: string;
  repository_id: string;
  kind: AgentSessionInterventionKind;
  title: string;
  detail: string | null;
  created_by: string | null;
  created_by_username: string | null;
  payload: Record<string, unknown> | null;
  created_at: number;
};

export type AgentSessionValidationCheckRecord = {
  kind: AgentSessionValidationCheckKind;
  label: string;
  status: AgentSessionValidationCheckStatus;
  command: string;
  summary: string;
};

export type AgentSessionValidationSummary = {
  status: ActionRunStatus | null;
  headline: string;
  detail: string;
  duration_ms: number | null;
  exit_code: number | null;
  stdout_chars: number | null;
  stderr_chars: number | null;
  checks: AgentSessionValidationCheckRecord[];
  highlighted_artifact_ids: string[];
};

export type AppBindings = {
  DB: D1Database;
  GIT_BUCKET: R2Bucket;
  ACTIONS_RUNNER?: DurableObjectNamespace;
  ACTIONS_RUNNER_BASIC?: DurableObjectNamespace;
  ACTIONS_RUNNER_STANDARD_1?: DurableObjectNamespace;
  ACTIONS_RUNNER_STANDARD_2?: DurableObjectNamespace;
  ACTIONS_RUNNER_STANDARD_3?: DurableObjectNamespace;
  ACTIONS_RUNNER_STANDARD_4?: DurableObjectNamespace;
  ACTIONS_QUEUE?: Queue<ActionRunQueueMessage>;
  ASSETS?: Fetcher;
  JWT_SECRET: string;
  APP_ORIGIN: string;
  UPLOAD_PACK_MAX_BODY_BYTES?: string;
  RECEIVE_PACK_MAX_BODY_BYTES?: string;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: {
    sessionUser?: AuthUser;
    basicAuthUser?: AuthUser;
    accessTokenContext?: AccessTokenContext;
  };
};
