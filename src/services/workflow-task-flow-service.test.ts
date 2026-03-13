import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionRecord,
  IssueLinkedPullRequestRecord,
  IssueRecord,
  PullRequestReviewThreadRecord,
  RepositoryRecord
} from "../types";
import { createMockD1Database } from "../test-utils/mock-d1";
import { AgentSessionService } from "./agent-session-service";
import { StorageService } from "./storage-service";
import { WorkflowTaskFlowService } from "./workflow-task-flow-service";

function buildRepository(): RepositoryRecord {
  return {
    id: "repo-1",
    owner_id: "owner-1",
    owner_username: "alice",
    name: "demo",
    description: "demo",
    is_private: 1,
    created_at: 1
  };
}

function buildIssue(overrides?: Partial<IssueRecord>): IssueRecord {
  return {
    id: "issue-1",
    repository_id: "repo-1",
    number: 1,
    author_id: "user-1",
    author_username: "alice",
    title: "Issue",
    body: "body",
    state: "open",
    task_status: "open",
    acceptance_criteria: "",
    comment_count: 0,
    created_at: 1,
    updated_at: 1,
    closed_at: null,
    ...overrides
  };
}

function buildLinkedPullRequest(overrides?: Partial<IssueLinkedPullRequestRecord>): IssueLinkedPullRequestRecord {
  return {
    id: "pr-1",
    repository_id: "repo-1",
    number: 1,
    author_id: "user-1",
    author_username: "alice",
    title: "PR",
    state: "open",
    draft: false,
    base_ref: "refs/heads/main",
    head_ref: "refs/heads/feature",
    merge_commit_oid: null,
    created_at: 1,
    updated_at: 1,
    closed_at: null,
    merged_at: null,
    ...overrides
  };
}

function buildSession(status: AgentSessionRecord["status"], updatedAt = 1): AgentSessionRecord {
  return {
    id: `session-${status}-${updatedAt}`,
    repository_id: "repo-1",
    session_number: updatedAt,
    source_type: "issue",
    source_number: 1,
    source_comment_id: null,
    origin: "issue_assign",
    status,
    agent_type: "codex",
    instance_type: "lite",
    prompt: "do the work",
    branch_ref: null,
    trigger_ref: null,
    trigger_sha: null,
    workflow_id: null,
    workflow_name: null,
    parent_session_id: null,
    created_by: null,
    created_by_username: null,
    delegated_from_user_id: null,
    delegated_from_username: null,
    exit_code: null,
    container_instance: null,
    created_at: updatedAt,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    updated_at: updatedAt
  };
}

function buildReviewThread(overrides?: Partial<PullRequestReviewThreadRecord>): PullRequestReviewThreadRecord {
  return {
    id: "thread-1",
    repository_id: "repo-1",
    pull_request_id: "pr-1",
    pull_request_number: 1,
    author_id: "user-2",
    author_username: "bob",
    path: "src/app.ts",
    line: 12,
    side: "head",
    body: "Please fix this",
    base_oid: "a".repeat(40),
    head_oid: "b".repeat(40),
    start_side: "head",
    start_line: 12,
    end_side: "head",
    end_line: 12,
    hunk_header: "@@",
    status: "open",
    resolved_by: null,
    resolved_by_username: null,
    comments: [],
    created_at: 1,
    updated_at: 1,
    resolved_at: null,
    ...overrides
  };
}

function createService(): WorkflowTaskFlowService {
  return new WorkflowTaskFlowService(createMockD1Database([]), new StorageService({} as R2Bucket));
}

describe("WorkflowTaskFlowService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks open issues without active work as open", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([]);

    const flow = await createService().buildIssueTaskFlow({
      repository: buildRepository(),
      issue: buildIssue(),
      linkedPullRequests: []
    });

    expect(flow.status).toBe("open");
    expect(flow.waiting_on).toBe("none");
  });

  it("marks issues with a running direct execution as agent-working", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([
      buildSession("running", 10)
    ]);

    const flow = await createService().buildIssueTaskFlow({
      repository: buildRepository(),
      issue: buildIssue(),
      linkedPullRequests: []
    });

    expect(flow.status).toBe("agent-working");
    expect(flow.waiting_on).toBe("agent");
  });

  it("marks issues with a finished direct execution as waiting-human", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([
      buildSession("success", 20)
    ]);

    const flow = await createService().buildIssueTaskFlow({
      repository: buildRepository(),
      issue: buildIssue(),
      linkedPullRequests: []
    });

    expect(flow.status).toBe("waiting-human");
    expect(flow.waiting_on).toBe("human");
  });

  it("keeps issues on the agent when the latest direct execution failed", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([
      buildSession("failed", 20)
    ]);

    const flow = await createService().buildIssueTaskFlow({
      repository: buildRepository(),
      issue: buildIssue(),
      linkedPullRequests: []
    });

    expect(flow.status).toBe("agent-working");
    expect(flow.waiting_on).toBe("agent");
    expect(flow.headline).toContain("failed");
  });

  it("keeps pull requests on the agent when review threads are still open", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([
      buildSession("success", 10)
    ]);

    const flow = await createService().buildPullRequestTaskFlow({
      repository: buildRepository(),
      pullRequest: buildLinkedPullRequest(),
      closingIssueNumbers: [1],
      closingIssues: [buildIssue()],
      reviewSummary: { approvals: 1, changeRequests: 0, comments: 0 },
      reviewThreads: [
        buildReviewThread({ id: "thread-2", created_at: 20 }),
        buildReviewThread({ id: "thread-1", created_at: 10 })
      ],
      comparison: { mergeable: "mergeable" }
    });

    expect(flow.waiting_on).toBe("agent");
    expect(flow.suggested_review_thread_id).toBe("thread-1");
  });

  it("keeps pull requests on the agent when the latest validation failed", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([
      buildSession("failed", 10)
    ]);

    const flow = await createService().buildPullRequestTaskFlow({
      repository: buildRepository(),
      pullRequest: buildLinkedPullRequest(),
      closingIssueNumbers: [1],
      closingIssues: [buildIssue()],
      reviewSummary: { approvals: 1, changeRequests: 0, comments: 0 },
      reviewThreads: [],
      comparison: { mergeable: "mergeable" }
    });

    expect(flow.waiting_on).toBe("agent");
    expect(flow.headline).toContain("failed");
  });

  it("marks merge-ready pull requests as waiting-human", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([
      buildSession("success", 10)
    ]);

    const flow = await createService().buildPullRequestTaskFlow({
      repository: buildRepository(),
      pullRequest: buildLinkedPullRequest(),
      closingIssueNumbers: [1],
      closingIssues: [buildIssue()],
      reviewSummary: { approvals: 1, changeRequests: 0, comments: 0 },
      reviewThreads: [],
      comparison: { mergeable: "mergeable" }
    });

    expect(flow.waiting_on).toBe("human");
    expect(flow.primary_issue_number).toBe(1);
  });

  it("marks merged pull requests as having no active blocker", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([]);

    const flow = await createService().buildPullRequestTaskFlow({
      repository: buildRepository(),
      pullRequest: buildLinkedPullRequest({ state: "merged" }),
      closingIssueNumbers: [1],
      closingIssues: [buildIssue()],
      reviewSummary: { approvals: 1, changeRequests: 0, comments: 0 },
      reviewThreads: [],
      comparison: { mergeable: "mergeable" }
    });

    expect(flow.waiting_on).toBe("none");
    expect(flow.headline).toContain("已合并");
  });

  it("prioritizes agent-blocked pull requests when multiple linked pull requests are open", async () => {
    const service = createService();
    vi.spyOn(service as any, "analyzePullRequestTaskFlow").mockImplementation(async ({ pullRequest }) => {
      if (pullRequest.number === 2) {
        return {
          reason: "review-thread",
          earliestOpenThreadCreatedAt: 5,
          flow: {
            waiting_on: "agent",
            headline: "PR #2 needs agent work",
            detail: "Handle review feedback first.",
            primary_issue_number: 1,
            suggested_review_thread_id: "thread-2"
          }
        };
      }
      return {
        reason: "waiting-human",
        earliestOpenThreadCreatedAt: null,
        flow: {
          waiting_on: "human",
          headline: "PR #1 is ready for review",
          detail: "A human can decide whether to merge.",
          primary_issue_number: 1,
          suggested_review_thread_id: null
        }
      };
    });

    const flow = await service.buildIssueTaskFlow({
      repository: buildRepository(),
      issue: buildIssue(),
      linkedPullRequests: [
        buildLinkedPullRequest({ number: 1 }),
        buildLinkedPullRequest({ id: "pr-2", number: 2 })
      ]
    });

    expect(flow.status).toBe("agent-working");
    expect(flow.driver_pull_request_number).toBe(2);
  });

  it("prefers the first open non-done closing issue as the primary issue", async () => {
    vi.spyOn(AgentSessionService.prototype, "listLatestSessionsBySource").mockResolvedValue([
      buildSession("success", 10)
    ]);

    const flow = await createService().buildPullRequestTaskFlow({
      repository: buildRepository(),
      pullRequest: buildLinkedPullRequest(),
      closingIssueNumbers: [1, 2, 3],
      closingIssues: [
        buildIssue({ number: 1, state: "closed", task_status: "done" }),
        buildIssue({ number: 2, state: "open", task_status: "waiting-human" }),
        buildIssue({ number: 3, state: "open", task_status: "done" })
      ],
      reviewSummary: { approvals: 1, changeRequests: 0, comments: 0 },
      reviewThreads: [],
      comparison: { mergeable: "mergeable" }
    });

    expect(flow.primary_issue_number).toBe(2);
  });
});
