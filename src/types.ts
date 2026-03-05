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

export type PullRequestState = "open" | "closed" | "merged";

export type PullRequestReviewDecision = "comment" | "approve" | "request_changes";

export type ActionWorkflowTrigger =
  | "issue_created"
  | "pull_request_created"
  | "mention_actions"
  | "push";

export type ActionAgentType = "codex" | "claude_code";

export type ActionRunStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export type ActionRunSourceType = "issue" | "pull_request";

export type ActionRunQueueMessage = {
  repositoryId: string;
  runId: string;
  requestOrigin: string;
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
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

export type IssueCommentRecord = {
  id: string;
  repository_id: string;
  issue_id: string;
  issue_number: number;
  author_id: string;
  author_username: string;
  body: string;
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
  base_ref: string;
  head_ref: string;
  base_oid: string;
  head_oid: string;
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
  created_at: number;
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
  prompt: string;
  logs: string;
  exit_code: number | null;
  container_instance: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

export type ActionsGlobalConfig = {
  codexConfigFileContent: string;
  claudeCodeConfigFileContent: string;
  updated_at: number | null;
};

export type AppBindings = {
  DB: D1Database;
  GIT_BUCKET: R2Bucket;
  ACTIONS_RUNNER?: DurableObjectNamespace;
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
