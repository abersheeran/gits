export type AuthUser = {
  id: string;
  username: string;
};

export type CollaboratorPermission = "read" | "write" | "admin";
export type IssueTaskStatus = "open" | "agent-working" | "waiting-human" | "done";
export type TaskFlowWaitingOn = "agent" | "human" | "none";

export type RepositoryRecord = {
  id: string;
  owner_id: string;
  owner_username: string;
  name: string;
  description: string | null;
  is_private: number;
  created_at: number;
};

export type RepositoryDetailResponse = {
  repository: RepositoryRecord;
  openIssueCount: number;
  openPullRequestCount: number;
  permissions: {
    canCreateIssueOrPullRequest: boolean;
    canRunAgents: boolean;
    canManageActions: boolean;
  };
  defaultBranch: string | null;
  selectedRef: string | null;
  headOid: string | null;
  branches: Array<{ name: string; oid: string }>;
  readme: { path: string; content: string } | null;
};

export type RepositoryBranchMutationResponse = {
  defaultBranch: string | null;
  branches: Array<{ name: string; oid: string }>;
};

export type CommitHistoryResponse = {
  ref: string | null;
  commits: CommitSummary[];
};

export type CommitSummary = {
  oid: string;
  message: string;
  author: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset: number;
  };
  committer: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset: number;
  };
  parents: string[];
};

export type RepositoryTreeEntry = {
  name: string;
  path: string;
  oid: string;
  mode: string;
  type: "tree" | "blob" | "commit";
  latestCommit: CommitSummary | null;
};

export type RepositoryFilePreview = {
  path: string;
  oid: string;
  mode: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
  content: string | null;
  latestCommit: CommitSummary | null;
};

export type RepositoryContentsResponse = {
  defaultBranch: string | null;
  selectedRef: string | null;
  headOid: string | null;
  path: string;
  kind: "tree" | "blob";
  entries: RepositoryTreeEntry[];
  file: RepositoryFilePreview | null;
  readme: { path: string; content: string } | null;
};

export type RepositoryPathHistoryResponse = {
  ref: string | null;
  path: string;
  commits: CommitSummary[];
};

export type RepositoryCompareChange = {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "deleted";
  mode: string | null;
  previousMode: string | null;
  oid: string | null;
  previousOid: string | null;
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch: string | null;
  hunks: RepositoryDiffHunk[];
  oldContent: string | null;
  newContent: string | null;
};

export type RepositoryDiffLine = {
  kind: "context" | "add" | "delete" | "meta";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type RepositoryDiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: RepositoryDiffLine[];
};

export type RepositoryCommitDetailResponse = {
  commit: CommitSummary;
  filesChanged: number;
  additions: number;
  deletions: number;
  changes: RepositoryCompareChange[];
};

export type RepositoryCompareResponse = {
  baseRef: string;
  headRef: string;
  baseOid: string;
  headOid: string;
  mergeBaseOid: string | null;
  mergeable: "mergeable" | "conflicting" | "unknown";
  aheadBy: number;
  behindBy: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  commits: CommitSummary[];
  changes: RepositoryCompareChange[];
};

export type AccessTokenMetadata = {
  id: string;
  token_prefix: string;
  name: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type CollaboratorRecord = {
  user_id: string;
  username: string;
  permission: CollaboratorPermission;
  created_at: number;
};

export type IssueState = "open" | "closed";

export type PullRequestState = "open" | "closed" | "merged";

export type PullRequestReviewDecision = "comment" | "approve" | "request_changes";

export type IssueListState = IssueState | "all";

export type PullRequestListState = PullRequestState | "all";

export type RepositoryUserSummary = {
  id: string;
  username: string;
};

export type PaginationMetadata = {
  total: number;
  page: number;
  perPage: number;
  hasNextPage: boolean;
};

export type PaginatedIssueListResponse = {
  issues: IssueRecord[];
  pagination: PaginationMetadata;
};

export type PaginatedPullRequestListResponse = {
  pullRequests: PullRequestRecord[];
  pagination: PaginationMetadata;
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
  assignees: RepositoryUserSummary[];
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

export type IssueTaskFlowRecord = {
  status: IssueTaskStatus;
  waiting_on: TaskFlowWaitingOn;
  headline: string;
  detail: string;
  driver_pull_request_number: number | null;
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

export type IssueDetailResponse = {
  issue: IssueRecord;
  linkedPullRequests: IssueLinkedPullRequestRecord[];
  taskFlow: IssueTaskFlowRecord;
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
  draft: boolean;
  base_ref: string;
  head_ref: string;
  base_oid: string;
  head_oid: string;
  assignees: RepositoryUserSummary[];
  requested_reviewers: RepositoryUserSummary[];
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

export type PullRequestDetailResponse = {
  pullRequest: PullRequestRecord;
  reviewSummary: PullRequestReviewSummary;
  closingIssueNumbers: number[];
  closingIssues: IssueRecord[];
  taskFlow: PullRequestTaskFlowRecord;
};

export type PullRequestTaskFlowRecord = {
  waiting_on: TaskFlowWaitingOn;
  headline: string;
  detail: string;
  primary_issue_number: number | null;
  suggested_review_thread_id: string | null;
};

export type PullRequestProvenanceResponse = {
  latestSession: AgentSessionDetail | null;
};

export type PullRequestLatestProvenanceItem = {
  sourceNumber: number;
  latestSession: AgentSessionDetail | null;
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

export type PullRequestReviewSummary = {
  approvals: number;
  changeRequests: number;
  comments: number;
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

export type AgentSessionStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export type ActionRunStatus = AgentSessionStatus;
export type ActionRunSourceType = Exclude<AgentSessionSourceType, "manual">;

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

export type ActionRunLogStreamEvent =
  | {
      event: "snapshot" | "replace";
      data: {
        run: ActionRunRecord;
      };
    }
  | {
      event: "append";
      data: {
        runId: string;
        chunk: string;
        status: ActionRunStatus;
        exitCode: number | null;
        completedAt: number | null;
        updatedAt: number;
      };
    }
  | {
      event: "status" | "done";
      data: {
        runId: string;
        status: ActionRunStatus;
        exitCode: number | null;
        completedAt: number | null;
        updatedAt: number;
      };
    }
  | {
      event: "heartbeat";
      data: {
        timestamp: number;
      };
    }
  | {
      event: "stream-error";
      data: {
        message: string;
      };
    };

export type ActionRunLatestBySourceItem = {
  sourceNumber: number;
  run: ActionRunRecord | null;
};

export type ActionRunLatestByCommentItem = {
  commentId: string;
  run: ActionRunRecord | null;
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
  session_number: number;
  run_number?: number;
  source_type: AgentSessionSourceType;
  source_number: number | null;
  source_comment_id: string | null;
  trigger_source_type?: ActionRunSourceType | null;
  trigger_source_number?: number | null;
  trigger_source_comment_id?: string | null;
  origin: AgentSessionOrigin;
  status: AgentSessionStatus;
  agent_type: ActionAgentType;
  instance_type: ActionContainerInstanceType;
  prompt: string;
  branch_ref: string | null;
  trigger_ref: string | null;
  trigger_sha: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  parent_session_id: string | null;
  linked_run_id?: string | null;
  created_by: string | null;
  created_by_username: string | null;
  delegated_from_user_id: string | null;
  delegated_from_username: string | null;
  active_attempt_id?: string | null;
  latest_attempt_id?: string | null;
  triggered_by?: string | null;
  triggered_by_username?: string | null;
  logs: string;
  has_full_logs?: boolean;
  logs_url?: string | null;
  exit_code: number | null;
  container_instance: string | null;
  failure_reason?:
    | "runner_binding_missing"
    | "container_start_conflict"
    | "dockerd_bootstrap_failed"
    | "stream_disconnected"
    | "missing_result"
    | "workspace_preparation_failed"
    | "git_clone_failed"
    | "git_checkout_failed"
    | "agent_exit_non_zero"
    | "storage_write_failed"
    | "cancel_requested"
    | "unknown_infra_failure"
    | "unknown_task_failure"
    | null;
  failure_stage?:
    | "boot"
    | "workspace"
    | "runtime"
    | "result"
    | "logs"
    | "side_effects"
    | "unknown"
    | null;
  created_at: number;
  claimed_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

export type ActionRunRecord = AgentSessionRecord;

export type AgentSessionAttemptStatus =
  | "queued"
  | "booting"
  | "running"
  | "retryable_failed"
  | "failed"
  | "success"
  | "cancelled";

export type AgentSessionAttemptRecord = {
  id: string;
  session_id: string;
  repository_id: string;
  attempt_number: number;
  status: AgentSessionAttemptStatus;
  instance_type: ActionContainerInstanceType;
  promoted_from_instance_type: ActionContainerInstanceType | null;
  container_instance: string | null;
  exit_code: number | null;
  failure_reason: AgentSessionRecord["failure_reason"];
  failure_stage: AgentSessionRecord["failure_stage"];
  created_at: number;
  claimed_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

export type AgentSessionAttemptEventRecord = {
  id: number;
  attempt_id: string;
  session_id: string;
  repository_id: string;
  type:
    | "attempt_created"
    | "attempt_claimed"
    | "attempt_started"
    | "stdout_chunk"
    | "stderr_chunk"
    | "heartbeat"
    | "warning"
    | "result_reported"
    | "retry_scheduled"
    | "attempt_completed";
  stream: "system" | "stdout" | "stderr" | "error";
  message: string;
  payload: Record<string, unknown> | null;
  created_at: number;
};

export type AgentSessionArtifactRecord = {
  id: string;
  attempt_id: string;
  session_id: string;
  repository_id: string;
  kind: "session_logs" | "stdout" | "stderr";
  title: string;
  media_type: string;
  size_bytes: number;
  content_text: string;
  has_full_content?: boolean;
  content_url?: string | null;
  created_at: number;
  updated_at: number;
};

export type ActionRunLogsResponse = {
  logs: string;
};

export type AgentSessionArtifactContentResponse = {
  artifact: AgentSessionArtifactRecord;
  content: string;
};

export type AgentSessionValidationCheckKind = "tests" | "build" | "lint";

export type AgentSessionValidationCheckStatus =
  | "passed"
  | "failed"
  | "pending"
  | "cancelled"
  | "skipped"
  | "partial";

export type AgentSessionValidationCheckRecord = {
  kind: AgentSessionValidationCheckKind;
  label: string;
  scope: string | null;
  status: AgentSessionValidationCheckStatus;
  command: string;
  summary: string;
};

export type AgentSessionValidationSummary = {
  status: AgentSessionStatus | null;
  headline: string;
  detail: string;
  duration_ms: number | null;
  exit_code: number | null;
  stdout_chars: number | null;
  stderr_chars: number | null;
  checks: AgentSessionValidationCheckRecord[];
  highlighted_artifact_ids: string[];
};

export type AgentSessionSourceContext = {
  type: AgentSessionSourceType;
  number: number | null;
  title: string | null;
  url: string | null;
  commentId: string | null;
};

export type AgentSessionDetail = {
  session: AgentSessionRecord;
  linkedRun?: ActionRunRecord | null;
  sourceContext: AgentSessionSourceContext;
  attempts: AgentSessionAttemptRecord[];
  activeAttempt: AgentSessionAttemptRecord | null;
  latestAttempt: AgentSessionAttemptRecord | null;
  artifacts: AgentSessionArtifactRecord[];
  events: AgentSessionAttemptEventRecord[];
  validationSummary: AgentSessionValidationSummary;
};

export type AgentSessionTimelineEvent = {
  id: string;
  type:
    | "session_created"
    | "session_queued"
    | "session_claimed"
    | "session_started"
    | "log"
    | "session_completed"
    | "session_cancelled"
    | "intervention";
  title: string;
  detail: string | null;
  timestamp: number | null;
  level: "info" | "success" | "warning" | "error";
  stream: "system" | "stdout" | "stderr" | "error" | null;
};

export type AgentSessionLatestBySourceItem = {
  sourceNumber: number;
  session: AgentSessionRecord | null;
};

export type TriggerRepositoryAgentInput = {
  agentType?: ActionAgentType;
  prompt?: string;
  threadId?: string;
};

export type TriggerRepositoryAgentResponse = {
  run?: ActionRunRecord;
  session: AgentSessionRecord;
  issue?: IssueRecord;
};

export type AgentSessionLifecycleResponse = {
  session: AgentSessionRecord;
  run?: ActionRunRecord | null;
};

type ApiRequestInit = RequestInit & {
  bodyJson?: unknown;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const json = (await response.json()) as
        | { message?: string; error?: { message?: string } }
        | null;
      if (json?.message && typeof json.message === "string") {
        return json.message;
      }
      if (json?.error?.message && typeof json.error.message === "string") {
        return json.error.message;
      }
    } catch {
      // fall back to text
    }
  }

  const text = await response.text();
  return text || response.statusText || "Request failed";
}

async function requestJson<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (init.bodyJson !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
    body: init.bodyJson !== undefined ? JSON.stringify(init.bodyJson) : init.body
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return (await response.json()) as T;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await requestJson<{ user: AuthUser | null }>("/api/me");
  return response.user;
}

export async function login(input: {
  usernameOrEmail: string;
  password: string;
}): Promise<AuthUser> {
  const response = await requestJson<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    bodyJson: input
  });
  return response.user;
}

export async function register(input: {
  username: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const response = await requestJson<{ user: AuthUser }>("/api/auth/register", {
    method: "POST",
    bodyJson: input
  });
  return response.user;
}

export async function logout(): Promise<void> {
  await requestJson<{ ok: boolean }>("/api/auth/logout", {
    method: "POST"
  });
}

export async function listPublicRepositories(limit = 50): Promise<RepositoryRecord[]> {
  const response = await requestJson<{ repositories: RepositoryRecord[] }>(
    `/api/public/repos?limit=${limit}`
  );
  return response.repositories;
}

export async function listMyRepositories(): Promise<RepositoryRecord[]> {
  const response = await requestJson<{ repositories: RepositoryRecord[] }>("/api/repos");
  return response.repositories;
}

export async function createRepository(input: {
  name: string;
  description?: string;
  isPrivate: boolean;
}): Promise<void> {
  await requestJson<{ ok: boolean }>("/api/repos", {
    method: "POST",
    bodyJson: input
  });
}

export async function updateRepository(
  owner: string,
  repo: string,
  input: {
    name?: string;
    description?: string | null;
    isPrivate?: boolean;
  }
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}`, {
    method: "PATCH",
    bodyJson: input
  });
}

export async function deleteRepository(owner: string, repo: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}`, {
    method: "DELETE"
  });
}

export async function getRepositoryDetail(
  owner: string,
  repo: string,
  ref?: string
): Promise<RepositoryDetailResponse> {
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return requestJson<RepositoryDetailResponse>(`/api/repos/${owner}/${repo}${suffix}`);
}

export async function createRepositoryBranch(
  owner: string,
  repo: string,
  input: { branchName: string; sourceOid: string }
): Promise<RepositoryBranchMutationResponse> {
  return requestJson<RepositoryBranchMutationResponse>(`/api/repos/${owner}/${repo}/branches`, {
    method: "POST",
    bodyJson: input
  });
}

export async function updateRepositoryDefaultBranch(
  owner: string,
  repo: string,
  input: { branchName: string }
): Promise<RepositoryBranchMutationResponse> {
  return requestJson<RepositoryBranchMutationResponse>(`/api/repos/${owner}/${repo}/default-branch`, {
    method: "PATCH",
    bodyJson: input
  });
}

export async function deleteRepositoryBranch(
  owner: string,
  repo: string,
  branchName: string
): Promise<RepositoryBranchMutationResponse> {
  return requestJson<RepositoryBranchMutationResponse>(
    `/api/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}`,
    {
      method: "DELETE"
    }
  );
}

export async function getRepositoryCommits(
  owner: string,
  repo: string,
  input?: { ref?: string; limit?: number }
): Promise<CommitHistoryResponse> {
  const query = new URLSearchParams();
  if (input?.ref) {
    query.set("ref", input.ref);
  }
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson<CommitHistoryResponse>(`/api/repos/${owner}/${repo}/commits${suffix}`);
}

export async function getRepositoryContents(
  owner: string,
  repo: string,
  input?: { ref?: string; path?: string }
): Promise<RepositoryContentsResponse> {
  const query = new URLSearchParams();
  if (input?.ref) {
    query.set("ref", input.ref);
  }
  if (input?.path) {
    query.set("path", input.path);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson<RepositoryContentsResponse>(`/api/repos/${owner}/${repo}/contents${suffix}`);
}

export async function getRepositoryCommitDetail(
  owner: string,
  repo: string,
  oid: string
): Promise<RepositoryCommitDetailResponse> {
  return requestJson<RepositoryCommitDetailResponse>(`/api/repos/${owner}/${repo}/commits/${oid}`);
}

export async function getRepositoryPathHistory(
  owner: string,
  repo: string,
  input: { path: string; ref?: string; limit?: number }
): Promise<RepositoryPathHistoryResponse> {
  const query = new URLSearchParams();
  query.set("path", input.path);
  if (input.ref) {
    query.set("ref", input.ref);
  }
  if (input.limit) {
    query.set("limit", String(input.limit));
  }
  return requestJson<RepositoryPathHistoryResponse>(
    `/api/repos/${owner}/${repo}/history?${query.toString()}`
  );
}

export async function compareRepositoryRefs(
  owner: string,
  repo: string,
  input: { baseRef: string; headRef: string }
): Promise<RepositoryCompareResponse> {
  const query = new URLSearchParams();
  query.set("baseRef", input.baseRef);
  query.set("headRef", input.headRef);
  return requestJson<RepositoryCompareResponse>(
    `/api/repos/${owner}/${repo}/compare?${query.toString()}`
  );
}

export async function listIssues(
  owner: string,
  repo: string,
  input?: { state?: IssueListState; limit?: number; page?: number }
): Promise<PaginatedIssueListResponse> {
  const query = new URLSearchParams();
  if (input?.state) {
    query.set("state", input.state);
  }
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  if (input?.page) {
    query.set("page", String(input.page));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson<PaginatedIssueListResponse>(
    `/api/repos/${owner}/${repo}/issues${suffix}`
  );
}

export async function getIssue(
  owner: string,
  repo: string,
  number: number
): Promise<IssueDetailResponse> {
  return requestJson<IssueDetailResponse>(
    `/api/repos/${owner}/${repo}/issues/${number}`
  );
}

export async function createIssue(
  owner: string,
  repo: string,
  input: {
    title: string;
    body?: string;
    acceptanceCriteria?: string;
    assigneeUserIds?: string[];
  }
): Promise<IssueRecord> {
  const response = await requestJson<{ issue: IssueRecord }>(`/api/repos/${owner}/${repo}/issues`, {
    method: "POST",
    bodyJson: input
  });
  return response.issue;
}

export async function updateIssue(
  owner: string,
  repo: string,
  number: number,
  input: {
    title?: string;
    body?: string;
    state?: IssueState;
    taskStatus?: IssueTaskStatus;
    acceptanceCriteria?: string;
    assigneeUserIds?: string[];
  }
): Promise<IssueRecord> {
  const response = await requestJson<{ issue: IssueRecord }>(
    `/api/repos/${owner}/${repo}/issues/${number}`,
    {
      method: "PATCH",
      bodyJson: input
    }
  );
  return response.issue;
}

export async function listIssueComments(
  owner: string,
  repo: string,
  number: number
): Promise<IssueCommentRecord[]> {
  const response = await requestJson<{ comments: IssueCommentRecord[] }>(
    `/api/repos/${owner}/${repo}/issues/${number}/comments`
  );
  return response.comments;
}

export async function createIssueComment(
  owner: string,
  repo: string,
  number: number,
  input: { body: string }
): Promise<IssueCommentRecord> {
  const response = await requestJson<{ comment: IssueCommentRecord }>(
    `/api/repos/${owner}/${repo}/issues/${number}/comments`,
    {
      method: "POST",
      bodyJson: input
    }
  );
  return response.comment;
}

export async function listPullRequests(
  owner: string,
  repo: string,
  input?: { state?: PullRequestListState; limit?: number; page?: number }
): Promise<PaginatedPullRequestListResponse> {
  const query = new URLSearchParams();
  if (input?.state) {
    query.set("state", input.state);
  }
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  if (input?.page) {
    query.set("page", String(input.page));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson<PaginatedPullRequestListResponse>(
    `/api/repos/${owner}/${repo}/pulls${suffix}`
  );
}

export async function getPullRequest(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestDetailResponse> {
  return requestJson<PullRequestDetailResponse>(
    `/api/repos/${owner}/${repo}/pulls/${number}`
  );
}

export async function getPullRequestProvenance(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestProvenanceResponse> {
  return requestJson<PullRequestProvenanceResponse>(
    `/api/repos/${owner}/${repo}/pulls/${number}/provenance`
  );
}

export async function listLatestPullRequestProvenance(
  owner: string,
  repo: string,
  numbers: number[]
): Promise<PullRequestLatestProvenanceItem[]> {
  if (numbers.length === 0) {
    return [];
  }
  const query = new URLSearchParams();
  query.set("numbers", numbers.join(","));
  const response = await requestJson<{ items: PullRequestLatestProvenanceItem[] }>(
    `/api/repos/${owner}/${repo}/pulls/provenance/latest?${query.toString()}`
  );
  return response.items;
}

export async function createPullRequest(
  owner: string,
  repo: string,
  input: {
    title: string;
    body?: string;
    baseRef: string;
    headRef: string;
    closeIssueNumbers?: number[];
    draft?: boolean;
    assigneeUserIds?: string[];
    requestedReviewerIds?: string[];
  }
): Promise<PullRequestRecord> {
  const response = await requestJson<{ pullRequest: PullRequestRecord; closingIssueNumbers: number[] }>(
    `/api/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      bodyJson: input
    }
  );
  return response.pullRequest;
}

export async function updatePullRequest(
  owner: string,
  repo: string,
  number: number,
  input: {
    title?: string;
    body?: string;
    state?: PullRequestState;
    closeIssueNumbers?: number[];
    draft?: boolean;
    assigneeUserIds?: string[];
    requestedReviewerIds?: string[];
  }
): Promise<PullRequestRecord> {
  const response = await requestJson<{ pullRequest: PullRequestRecord; closingIssueNumbers: number[] }>(
    `/api/repos/${owner}/${repo}/pulls/${number}`,
    {
      method: "PATCH",
      bodyJson: input
    }
  );
  return response.pullRequest;
}

export async function listPullRequestReviews(
  owner: string,
  repo: string,
  number: number
): Promise<{ reviews: PullRequestReviewRecord[]; reviewSummary: PullRequestReviewSummary }> {
  return requestJson<{ reviews: PullRequestReviewRecord[]; reviewSummary: PullRequestReviewSummary }>(
    `/api/repos/${owner}/${repo}/pulls/${number}/reviews`
  );
}

export async function createPullRequestReview(
  owner: string,
  repo: string,
  number: number,
  input: { decision: PullRequestReviewDecision; body?: string }
): Promise<{ review: PullRequestReviewRecord; reviewSummary: PullRequestReviewSummary }> {
  return requestJson<{ review: PullRequestReviewRecord; reviewSummary: PullRequestReviewSummary }>(
    `/api/repos/${owner}/${repo}/pulls/${number}/reviews`,
    {
      method: "POST",
      bodyJson: input
    }
  );
}

export async function listPullRequestReviewThreads(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestReviewThreadRecord[]> {
  const response = await requestJson<{ reviewThreads: PullRequestReviewThreadRecord[] }>(
    `/api/repos/${owner}/${repo}/pulls/${number}/review-threads`
  );
  return response.reviewThreads;
}

export async function createPullRequestReviewThread(
  owner: string,
  repo: string,
  number: number,
  input: {
    path: string;
    baseOid: string;
    headOid: string;
    startSide: PullRequestReviewThreadSide;
    startLine: number;
    endSide: PullRequestReviewThreadSide;
    endLine: number;
    hunkHeader: string;
    body?: string;
    suggestedCode?: string;
  }
): Promise<PullRequestReviewThreadRecord> {
  const response = await requestJson<{ reviewThread: PullRequestReviewThreadRecord }>(
    `/api/repos/${owner}/${repo}/pulls/${number}/review-threads`,
    {
      method: "POST",
      bodyJson: input
    }
  );
  return response.reviewThread;
}

export async function createPullRequestReviewThreadComment(
  owner: string,
  repo: string,
  number: number,
  threadId: string,
  input: {
    body?: string;
    suggestedCode?: string;
  }
): Promise<PullRequestReviewThreadRecord> {
  const response = await requestJson<{
    reviewThread: PullRequestReviewThreadRecord;
    comment: PullRequestReviewThreadCommentRecord;
  }>(`/api/repos/${owner}/${repo}/pulls/${number}/review-threads/${threadId}/comments`, {
    method: "POST",
    bodyJson: input
  });
  return response.reviewThread;
}

export async function resolvePullRequestReviewThread(
  owner: string,
  repo: string,
  number: number,
  threadId: string
): Promise<PullRequestReviewThreadRecord> {
  const response = await requestJson<{ reviewThread: PullRequestReviewThreadRecord }>(
    `/api/repos/${owner}/${repo}/pulls/${number}/review-threads/${threadId}/resolve`,
    {
      method: "POST"
    }
  );
  return response.reviewThread;
}

export async function getActionsGlobalConfig(): Promise<ActionsGlobalConfig> {
  const response = await requestJson<{ config: ActionsGlobalConfig }>("/api/settings/actions");
  return response.config;
}

export async function updateActionsGlobalConfig(input: {
  codexConfigFileContent?: string | null;
  claudeCodeConfigFileContent?: string | null;
}): Promise<ActionsGlobalConfig> {
  const response = await requestJson<{ config: ActionsGlobalConfig }>("/api/settings/actions", {
    method: "PATCH",
    bodyJson: input
  });
  return response.config;
}

export async function getRepositoryActionsConfig(
  owner: string,
  repo: string
): Promise<RepositoryActionsConfig> {
  const response = await requestJson<{ config: RepositoryActionsConfig }>(
    `/api/repos/${owner}/${repo}/actions/config`
  );
  return response.config;
}

export async function updateRepositoryActionsConfig(
  owner: string,
  repo: string,
  input: {
    instanceType?: ActionContainerInstanceType | null;
    codexConfigFileContent?: string | null;
    claudeCodeConfigFileContent?: string | null;
  }
): Promise<RepositoryActionsConfig> {
  const response = await requestJson<{ config: RepositoryActionsConfig }>(
    `/api/repos/${owner}/${repo}/actions/config`,
    {
      method: "PATCH",
      bodyJson: input
    }
  );
  return response.config;
}

export async function listActionWorkflows(
  owner: string,
  repo: string
): Promise<ActionWorkflowRecord[]> {
  const response = await requestJson<{ workflows: ActionWorkflowRecord[] }>(
    `/api/repos/${owner}/${repo}/actions/workflows`
  );
  return response.workflows;
}

export async function createActionWorkflow(
  owner: string,
  repo: string,
  input: {
    name: string;
    triggerEvent: ActionWorkflowTrigger;
    agentType: ActionAgentType;
    prompt: string;
    pushBranchRegex?: string | null;
    pushTagRegex?: string | null;
    enabled?: boolean;
  }
): Promise<ActionWorkflowRecord> {
  const response = await requestJson<{ workflow: ActionWorkflowRecord }>(
    `/api/repos/${owner}/${repo}/actions/workflows`,
    {
      method: "POST",
      bodyJson: input
    }
  );
  return response.workflow;
}

export async function updateActionWorkflow(
  owner: string,
  repo: string,
  workflowId: string,
  input: {
    name?: string;
    triggerEvent?: ActionWorkflowTrigger;
    agentType?: ActionAgentType;
    prompt?: string;
    pushBranchRegex?: string | null;
    pushTagRegex?: string | null;
    enabled?: boolean;
  }
): Promise<ActionWorkflowRecord> {
  const response = await requestJson<{ workflow: ActionWorkflowRecord }>(
    `/api/repos/${owner}/${repo}/actions/workflows/${workflowId}`,
    {
      method: "PATCH",
      bodyJson: input
    }
  );
  return response.workflow;
}

function normalizeActionRunRecord(session: AgentSessionRecord): ActionRunRecord {
  return {
    ...session,
    run_number: session.run_number ?? session.session_number,
    trigger_source_type:
      session.trigger_source_type ??
      (session.source_type === "manual" ? null : session.source_type),
    trigger_source_number: session.trigger_source_number ?? session.source_number,
    trigger_source_comment_id:
      session.trigger_source_comment_id ?? session.source_comment_id,
    linked_run_id: session.linked_run_id ?? null,
    triggered_by: session.triggered_by ?? session.created_by,
    triggered_by_username:
      session.triggered_by_username ?? session.created_by_username
  };
}

function normalizeAgentSessionDetail(detail: AgentSessionDetail): AgentSessionDetail {
  return {
    ...detail,
    session: normalizeActionRunRecord(detail.session),
    linkedRun: detail.linkedRun ?? null
  };
}

function normalizeTriggerRepositoryAgentResponse(
  response: TriggerRepositoryAgentResponse
): TriggerRepositoryAgentResponse {
  return {
    ...response,
    run: response.run ?? normalizeActionRunRecord(response.session)
  };
}

export async function listActionRuns(
  owner: string,
  repo: string,
  input?: { limit?: number }
): Promise<ActionRunRecord[]> {
  return (await listRepositoryAgentSessions(owner, repo, { limit: input?.limit })).map(
    (session) => normalizeActionRunRecord(session)
  );
}

export async function listLatestActionRunsBySource(
  owner: string,
  repo: string,
  input: { sourceType: ActionRunSourceType; numbers: number[] }
): Promise<ActionRunLatestBySourceItem[]> {
  const items = await listLatestAgentSessionsBySource(owner, repo, input);
  return items.map((item) => ({
    sourceNumber: item.sourceNumber,
    run: item.session ? normalizeActionRunRecord(item.session) : null
  }));
}

export async function listLatestActionRunsByCommentIds(
  owner: string,
  repo: string,
  commentIds: string[]
): Promise<ActionRunLatestByCommentItem[]> {
  const query = new URLSearchParams();
  query.set("commentIds", commentIds.join(","));
  const response = await requestJson<{ items: AgentSessionLatestByCommentItem[] }>(
    `/api/repos/${owner}/${repo}/agent-sessions/latest-by-comments?${query.toString()}`
  );
  return response.items.map((item) => ({
    commentId: item.commentId,
    run: item.session ? normalizeActionRunRecord(item.session) : null
  }));
}

export async function getActionRun(
  owner: string,
  repo: string,
  runId: string
): Promise<ActionRunRecord> {
  const detail = await getRepositoryAgentSessionDetail(owner, repo, runId);
  return normalizeActionRunRecord(detail.session);
}

export function getActionRunLogStreamPath(owner: string, repo: string, runId: string): string {
  return `/api/repos/${owner}/${repo}/agent-sessions/${runId}/logs/stream`;
}

export async function getActionRunLogs(
  owner: string,
  repo: string,
  runId: string
): Promise<ActionRunLogsResponse> {
  return requestJson<ActionRunLogsResponse>(`/api/repos/${owner}/${repo}/agent-sessions/${runId}/logs`);
}

export async function rerunActionRun(
  owner: string,
  repo: string,
  runId: string
): Promise<ActionRunRecord> {
  const response = await requestJson<{ session: AgentSessionRecord }>(
    `/api/repos/${owner}/${repo}/agent-sessions/${runId}/rerun`,
    {
      method: "POST"
    }
  );
  return normalizeActionRunRecord(response.session);
}

export async function dispatchActionWorkflow(
  owner: string,
  repo: string,
  workflowId: string,
  input?: { ref?: string; sha?: string }
): Promise<ActionRunRecord> {
  const response = await requestJson<{ session: AgentSessionRecord }>(
    `/api/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatch`,
    {
      method: "POST",
      bodyJson: input ?? {}
    }
  );
  return normalizeActionRunRecord(response.session);
}

export async function listRepositoryAgentSessions(
  owner: string,
  repo: string,
  input?: { limit?: number; sourceType?: AgentSessionSourceType; sourceNumber?: number }
): Promise<AgentSessionRecord[]> {
  const query = new URLSearchParams();
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  if (input?.sourceType) {
    query.set("sourceType", input.sourceType);
  }
  if (input?.sourceNumber) {
    query.set("sourceNumber", String(input.sourceNumber));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await requestJson<{ sessions: AgentSessionRecord[] }>(
    `/api/repos/${owner}/${repo}/agent-sessions${suffix}`
  );
  return response.sessions;
}

export async function listLatestAgentSessionsBySource(
  owner: string,
  repo: string,
  input: { sourceType: Exclude<AgentSessionSourceType, "manual">; numbers: number[] }
): Promise<AgentSessionLatestBySourceItem[]> {
  const query = new URLSearchParams();
  query.set("sourceType", input.sourceType);
  query.set("numbers", input.numbers.join(","));
  const response = await requestJson<{ items: AgentSessionLatestBySourceItem[] }>(
    `/api/repos/${owner}/${repo}/agent-sessions/latest?${query.toString()}`
  );
  return response.items;
}

export type AgentSessionLatestByCommentItem = {
  commentId: string;
  session: AgentSessionRecord | null;
};

export async function getRepositoryAgentSession(
  owner: string,
  repo: string,
  sessionId: string
): Promise<AgentSessionRecord> {
  const response = await getRepositoryAgentSessionDetail(owner, repo, sessionId);
  return response.session;
}

export async function getRepositoryAgentSessionDetail(
  owner: string,
  repo: string,
  sessionId: string
): Promise<AgentSessionDetail> {
  return normalizeAgentSessionDetail(
    await requestJson<AgentSessionDetail>(`/api/repos/${owner}/${repo}/agent-sessions/${sessionId}`)
  );
}

export async function getRepositoryAgentSessionTimeline(
  owner: string,
  repo: string,
  sessionId: string
): Promise<AgentSessionTimelineEvent[]> {
  const response = await requestJson<{ events: AgentSessionTimelineEvent[] }>(
    `/api/repos/${owner}/${repo}/agent-sessions/${sessionId}/timeline`
  );
  return response.events;
}

export async function listRepositoryAgentSessionArtifacts(
  owner: string,
  repo: string,
  sessionId: string
): Promise<AgentSessionArtifactRecord[]> {
  const response = await requestJson<{ artifacts: AgentSessionArtifactRecord[] }>(
    `/api/repos/${owner}/${repo}/agent-sessions/${sessionId}/artifacts`
  );
  return response.artifacts;
}

export async function getRepositoryAgentSessionArtifactContent(
  owner: string,
  repo: string,
  sessionId: string,
  artifactId: string
): Promise<AgentSessionArtifactContentResponse> {
  return requestJson<AgentSessionArtifactContentResponse>(
    `/api/repos/${owner}/${repo}/agent-sessions/${sessionId}/artifacts/${artifactId}/content`
  );
}

export async function cancelRepositoryAgentSession(
  owner: string,
  repo: string,
  sessionId: string
): Promise<AgentSessionLifecycleResponse> {
  return requestJson<AgentSessionLifecycleResponse>(
    `/api/repos/${owner}/${repo}/agent-sessions/${sessionId}/cancel`,
    {
      method: "POST"
    }
  );
}

export async function assignIssueAgent(
  owner: string,
  repo: string,
  number: number,
  input?: TriggerRepositoryAgentInput
): Promise<TriggerRepositoryAgentResponse> {
  return normalizeTriggerRepositoryAgentResponse(
    await requestJson<TriggerRepositoryAgentResponse>(
      `/api/repos/${owner}/${repo}/issues/${number}/assign-agent`,
      {
        method: "POST",
        bodyJson: input ?? {}
      }
    )
  );
}

export async function resumeIssueAgent(
  owner: string,
  repo: string,
  number: number,
  input?: TriggerRepositoryAgentInput
): Promise<TriggerRepositoryAgentResponse> {
  return normalizeTriggerRepositoryAgentResponse(
    await requestJson<TriggerRepositoryAgentResponse>(
      `/api/repos/${owner}/${repo}/issues/${number}/resume-agent`,
      {
        method: "POST",
        bodyJson: input ?? {}
      }
    )
  );
}

export async function resumePullRequestAgent(
  owner: string,
  repo: string,
  number: number,
  input?: TriggerRepositoryAgentInput
): Promise<TriggerRepositoryAgentResponse> {
  return normalizeTriggerRepositoryAgentResponse(
    await requestJson<TriggerRepositoryAgentResponse>(
      `/api/repos/${owner}/${repo}/pulls/${number}/resume-agent`,
      {
        method: "POST",
        bodyJson: input ?? {}
      }
    )
  );
}

export async function listRepositoryParticipants(
  owner: string,
  repo: string
): Promise<RepositoryUserSummary[]> {
  const response = await requestJson<{ participants: RepositoryUserSummary[] }>(
    `/api/repos/${owner}/${repo}/participants`
  );
  return response.participants;
}

export async function listCollaborators(
  owner: string,
  repo: string
): Promise<CollaboratorRecord[]> {
  const response = await requestJson<{ collaborators: CollaboratorRecord[] }>(
    `/api/repos/${owner}/${repo}/collaborators`
  );
  return response.collaborators;
}

export async function upsertCollaborator(
  owner: string,
  repo: string,
  input: { username: string; permission: CollaboratorPermission }
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}/collaborators`, {
    method: "PUT",
    bodyJson: input
  });
}

export async function removeCollaborator(
  owner: string,
  repo: string,
  username: string
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}/collaborators/${username}`, {
    method: "DELETE"
  });
}

export async function listAccessTokens(): Promise<AccessTokenMetadata[]> {
  const response = await requestJson<{ tokens: AccessTokenMetadata[] }>("/api/auth/tokens");
  return response.tokens;
}

export async function createAccessToken(input: {
  name: string;
  expiresAt?: number;
}): Promise<{ tokenId: string; token: string }> {
  return requestJson<{ tokenId: string; token: string }>("/api/auth/tokens", {
    method: "POST",
    bodyJson: input
  });
}

export async function revokeAccessToken(tokenId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/auth/tokens/${tokenId}`, {
    method: "DELETE"
  });
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "未登录或登录已过期。";
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}
