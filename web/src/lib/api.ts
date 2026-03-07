export type AuthUser = {
  id: string;
  username: string;
};

export type CollaboratorPermission = "read" | "write" | "admin";

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
  };
  defaultBranch: string | null;
  selectedRef: string | null;
  headOid: string | null;
  branches: Array<{ name: string; oid: string }>;
  readme: { path: string; content: string } | null;
};

export type CommitHistoryResponse = {
  ref: string | null;
  commits: Array<{
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
  }>;
};

export type RepositoryTreeEntry = {
  name: string;
  path: string;
  oid: string;
  mode: string;
  type: "tree" | "blob" | "commit";
};

export type RepositoryFilePreview = {
  path: string;
  oid: string;
  mode: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
  content: string | null;
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

export type PullRequestDetailResponse = {
  pullRequest: PullRequestRecord;
  reviewSummary: PullRequestReviewSummary;
  closingIssueNumbers: number[];
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

export type ActionRunStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export type ActionRunSourceType = "issue" | "pull_request";

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
  codexConfigFileContent: string;
  claudeCodeConfigFileContent: string;
  inheritsGlobalCodexConfig: boolean;
  inheritsGlobalClaudeCodeConfig: boolean;
  updated_at: number | null;
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

export async function listIssues(
  owner: string,
  repo: string,
  input?: { state?: IssueListState; limit?: number }
): Promise<IssueRecord[]> {
  const query = new URLSearchParams();
  if (input?.state) {
    query.set("state", input.state);
  }
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await requestJson<{ issues: IssueRecord[] }>(
    `/api/repos/${owner}/${repo}/issues${suffix}`
  );
  return response.issues;
}

export async function getIssue(
  owner: string,
  repo: string,
  number: number
): Promise<IssueRecord> {
  const response = await requestJson<{ issue: IssueRecord }>(
    `/api/repos/${owner}/${repo}/issues/${number}`
  );
  return response.issue;
}

export async function createIssue(
  owner: string,
  repo: string,
  input: { title: string; body?: string }
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
  input: { title?: string; body?: string; state?: IssueState }
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
  input?: { state?: PullRequestListState; limit?: number }
): Promise<PullRequestRecord[]> {
  const query = new URLSearchParams();
  if (input?.state) {
    query.set("state", input.state);
  }
  if (input?.limit) {
    query.set("limit", String(input.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await requestJson<{ pullRequests: PullRequestRecord[] }>(
    `/api/repos/${owner}/${repo}/pulls${suffix}`
  );
  return response.pullRequests;
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

export async function createPullRequest(
  owner: string,
  repo: string,
  input: {
    title: string;
    body?: string;
    baseRef: string;
    headRef: string;
    closeIssueNumbers?: number[];
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
