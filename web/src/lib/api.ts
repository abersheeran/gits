export type AuthUser = {
  id: string;
  username: string;
};

export type CollaboratorPermission = "read" | "write" | "admin";
export type IssueTaskStatus = "open" | "agent-working" | "waiting-human" | "done";

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

export type MilestoneState = "open" | "closed";

export type PullRequestReviewDecision = "comment" | "approve" | "request_changes";

export type IssueListState = IssueState | "all";

export type PullRequestListState = PullRequestState | "all";

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

export type IssueDetailResponse = {
  issue: IssueRecord;
  linkedPullRequests: IssueLinkedPullRequestRecord[];
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

export type PullRequestDetailResponse = {
  pullRequest: PullRequestRecord;
  reviewSummary: PullRequestReviewSummary;
  closingIssueNumbers: number[];
  closingIssues: IssueRecord[];
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
  reactions: ReactionSummary[];
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

export type ActionRunStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export type ActionRunSourceType = "issue" | "pull_request";
export type AgentSessionStatus = ActionRunStatus;

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

export type AgentSessionArtifactRecord = {
  id: string;
  session_id: string;
  repository_id: string;
  kind: "run_logs" | "stdout" | "stderr";
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
  kind: "duration_ms" | "exit_code" | "run_log_chars" | "stdout_chars" | "stderr_chars";
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
  kind: "cancel_requested" | "mcp_setup_warning";
  title: string;
  detail: string | null;
  created_by: string | null;
  created_by_username: string | null;
  payload: Record<string, unknown> | null;
  created_at: number;
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
  linkedRun: ActionRunRecord | null;
  sourceContext: AgentSessionSourceContext;
  artifacts: AgentSessionArtifactRecord[];
  usageRecords: AgentSessionUsageRecord[];
  interventions: AgentSessionInterventionRecord[];
};

export type AgentSessionTimelineEvent = {
  id: string;
  type:
    | "session_created"
    | "run_queued"
    | "run_claimed"
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
  run: ActionRunRecord;
  session: AgentSessionRecord;
  issue?: IssueRecord;
};

export type AgentSessionLifecycleResponse = {
  session: AgentSessionRecord;
  run: ActionRunRecord | null;
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
    labelIds?: string[];
    assigneeUserIds?: string[];
    milestoneId?: string | null;
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
    labelIds?: string[];
    assigneeUserIds?: string[];
    milestoneId?: string | null;
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
    labelIds?: string[];
    assigneeUserIds?: string[];
    requestedReviewerIds?: string[];
    milestoneId?: string | null;
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
    labelIds?: string[];
    assigneeUserIds?: string[];
    requestedReviewerIds?: string[];
    milestoneId?: string | null;
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

export async function listActionRuns(
  owner: string,
  repo: string,
  input?: { limit?: number }
): Promise<ActionRunRecord[]> {
  const query = new URLSearchParams();
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await requestJson<{ runs: ActionRunRecord[] }>(
    `/api/repos/${owner}/${repo}/actions/runs${suffix}`
  );
  return response.runs;
}

export async function listLatestActionRunsBySource(
  owner: string,
  repo: string,
  input: { sourceType: ActionRunSourceType; numbers: number[] }
): Promise<ActionRunLatestBySourceItem[]> {
  const query = new URLSearchParams();
  query.set("sourceType", input.sourceType);
  query.set("numbers", input.numbers.join(","));
  const response = await requestJson<{ items: ActionRunLatestBySourceItem[] }>(
    `/api/repos/${owner}/${repo}/actions/runs/latest?${query.toString()}`
  );
  return response.items;
}

export async function listLatestActionRunsByCommentIds(
  owner: string,
  repo: string,
  commentIds: string[]
): Promise<ActionRunLatestByCommentItem[]> {
  const query = new URLSearchParams();
  query.set("commentIds", commentIds.join(","));
  const response = await requestJson<{ items: ActionRunLatestByCommentItem[] }>(
    `/api/repos/${owner}/${repo}/actions/runs/latest-by-comments?${query.toString()}`
  );
  return response.items;
}

export async function getActionRun(
  owner: string,
  repo: string,
  runId: string
): Promise<ActionRunRecord> {
  const response = await requestJson<{ run: ActionRunRecord }>(
    `/api/repos/${owner}/${repo}/actions/runs/${runId}`
  );
  return response.run;
}

export function getActionRunLogStreamPath(owner: string, repo: string, runId: string): string {
  return `/api/repos/${owner}/${repo}/actions/runs/${runId}/logs/stream`;
}

export async function rerunActionRun(
  owner: string,
  repo: string,
  runId: string
): Promise<ActionRunRecord> {
  const response = await requestJson<{ run: ActionRunRecord }>(
    `/api/repos/${owner}/${repo}/actions/runs/${runId}/rerun`,
    {
      method: "POST"
    }
  );
  return response.run;
}

export async function dispatchActionWorkflow(
  owner: string,
  repo: string,
  workflowId: string,
  input?: { ref?: string; sha?: string }
): Promise<ActionRunRecord> {
  const response = await requestJson<{ run: ActionRunRecord }>(
    `/api/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatch`,
    {
      method: "POST",
      bodyJson: input ?? {}
    }
  );
  return response.run;
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

export async function getRepositoryAgentSession(
  owner: string,
  repo: string,
  sessionId: string
): Promise<AgentSessionRecord> {
  const response = await requestJson<{ session: AgentSessionRecord }>(
    `/api/repos/${owner}/${repo}/agent-sessions/${sessionId}`
  );
  return response.session;
}

export async function getRepositoryAgentSessionDetail(
  owner: string,
  repo: string,
  sessionId: string
): Promise<AgentSessionDetail> {
  return requestJson<AgentSessionDetail>(
    `/api/repos/${owner}/${repo}/agent-sessions/${sessionId}`
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
  return requestJson<TriggerRepositoryAgentResponse>(
    `/api/repos/${owner}/${repo}/issues/${number}/assign-agent`,
    {
      method: "POST",
      bodyJson: input ?? {}
    }
  );
}

export async function resumeIssueAgent(
  owner: string,
  repo: string,
  number: number,
  input?: TriggerRepositoryAgentInput
): Promise<TriggerRepositoryAgentResponse> {
  return requestJson<TriggerRepositoryAgentResponse>(
    `/api/repos/${owner}/${repo}/issues/${number}/resume-agent`,
    {
      method: "POST",
      bodyJson: input ?? {}
    }
  );
}

export async function resumePullRequestAgent(
  owner: string,
  repo: string,
  number: number,
  input?: TriggerRepositoryAgentInput
): Promise<TriggerRepositoryAgentResponse> {
  return requestJson<TriggerRepositoryAgentResponse>(
    `/api/repos/${owner}/${repo}/pulls/${number}/resume-agent`,
    {
      method: "POST",
      bodyJson: input ?? {}
    }
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

export async function listRepositoryLabels(
  owner: string,
  repo: string
): Promise<RepositoryLabelRecord[]> {
  const response = await requestJson<{ labels: RepositoryLabelRecord[] }>(
    `/api/repos/${owner}/${repo}/labels`
  );
  return response.labels;
}

export async function createRepositoryLabel(
  owner: string,
  repo: string,
  input: { name: string; color: string; description?: string | null }
): Promise<RepositoryLabelRecord> {
  const response = await requestJson<{ label: RepositoryLabelRecord }>(
    `/api/repos/${owner}/${repo}/labels`,
    {
      method: "POST",
      bodyJson: input
    }
  );
  return response.label;
}

export async function updateRepositoryLabel(
  owner: string,
  repo: string,
  labelId: string,
  input: { name?: string; color?: string; description?: string | null }
): Promise<RepositoryLabelRecord> {
  const response = await requestJson<{ label: RepositoryLabelRecord }>(
    `/api/repos/${owner}/${repo}/labels/${labelId}`,
    {
      method: "PATCH",
      bodyJson: input
    }
  );
  return response.label;
}

export async function deleteRepositoryLabel(
  owner: string,
  repo: string,
  labelId: string
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}/labels/${labelId}`, {
    method: "DELETE"
  });
}

export async function listRepositoryMilestones(
  owner: string,
  repo: string
): Promise<RepositoryMilestoneRecord[]> {
  const response = await requestJson<{ milestones: RepositoryMilestoneRecord[] }>(
    `/api/repos/${owner}/${repo}/milestones`
  );
  return response.milestones;
}

export async function createRepositoryMilestone(
  owner: string,
  repo: string,
  input: { title: string; description?: string; dueAt?: number | null }
): Promise<RepositoryMilestoneRecord> {
  const response = await requestJson<{ milestone: RepositoryMilestoneRecord }>(
    `/api/repos/${owner}/${repo}/milestones`,
    {
      method: "POST",
      bodyJson: input
    }
  );
  return response.milestone;
}

export async function updateRepositoryMilestone(
  owner: string,
  repo: string,
  milestoneId: string,
  input: {
    title?: string;
    description?: string;
    dueAt?: number | null;
    state?: MilestoneState;
  }
): Promise<RepositoryMilestoneRecord> {
  const response = await requestJson<{ milestone: RepositoryMilestoneRecord }>(
    `/api/repos/${owner}/${repo}/milestones/${milestoneId}`,
    {
      method: "PATCH",
      bodyJson: input
    }
  );
  return response.milestone;
}

export async function deleteRepositoryMilestone(
  owner: string,
  repo: string,
  milestoneId: string
): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/repos/${owner}/${repo}/milestones/${milestoneId}`, {
    method: "DELETE"
  });
}

export async function addReaction(
  owner: string,
  repo: string,
  input: {
    subjectType: ReactionSubjectType;
    subjectId: string;
    content: ReactionContent;
  }
): Promise<ReactionSummary[]> {
  const response = await requestJson<{ reactions: ReactionSummary[] }>(
    `/api/repos/${owner}/${repo}/reactions`,
    {
      method: "PUT",
      bodyJson: input
    }
  );
  return response.reactions;
}

export async function removeReaction(
  owner: string,
  repo: string,
  input: {
    subjectType: ReactionSubjectType;
    subjectId: string;
    content: ReactionContent;
  }
): Promise<ReactionSummary[]> {
  const response = await requestJson<{ reactions: ReactionSummary[] }>(
    `/api/repos/${owner}/${repo}/reactions`,
    {
      method: "DELETE",
      bodyJson: input
    }
  );
  return response.reactions;
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
