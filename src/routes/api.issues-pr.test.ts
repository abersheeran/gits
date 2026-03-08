import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler";
import { AuthService } from "../services/auth-service";
import { PullRequestMergeConflictError } from "../services/pull-request-merge-service";
import { RepositoryObjectClient } from "../services/repository-object";
import { WorkflowTaskFlowService } from "../services/workflow-task-flow-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import type { AppEnv } from "../types";
import apiRoutes from "./api";

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route("/api", apiRoutes);
  return app;
}

function createBaseEnv(db: D1Database): AppEnv["Bindings"] {
  return {
    DB: db,
    GIT_BUCKET: {} as R2Bucket,
    REPOSITORY_OBJECTS: {
      getByName: vi.fn()
    } as unknown as DurableObjectNamespace,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787"
  };
}

function buildRepositoryRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "repo-1",
    owner_id: "owner-1",
    owner_username: "alice",
    name: "demo",
    description: "demo repo",
    is_private: 1,
    created_at: Date.now(),
    ...(overrides ?? {})
  };
}

function buildActionRunRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    id: "run-1",
    repository_id: "repo-1",
    run_number: 1,
    workflow_id: "workflow-1",
    workflow_name: "CI",
    trigger_event: "pull_request_created",
    trigger_ref: "refs/heads/feature",
    trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    trigger_source_type: "pull_request",
    trigger_source_number: 1,
    trigger_source_comment_id: null,
    triggered_by: "user-2",
    triggered_by_username: "bob",
    status: "queued",
    agent_type: "codex",
    instance_type: "lite",
    prompt: "请执行测试并修复失败。",
    logs: "",
    exit_code: null,
    container_instance: null,
    created_at: now,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    updated_at: now,
    ...(overrides ?? {})
  };
}

function buildAgentSessionRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    id: "session-1",
    repository_id: "repo-1",
    source_type: "pull_request",
    source_number: 1,
    source_comment_id: null,
    origin: "rerun",
    status: "queued",
    agent_type: "codex",
    prompt: "请执行测试并修复失败。",
    branch_ref: "refs/heads/agent/session-1",
    trigger_ref: "refs/heads/feature",
    trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    workflow_id: "workflow-1",
    workflow_name: "CI",
    linked_run_id: "run-2",
    created_by: "user-2",
    created_by_username: "bob",
    delegated_from_user_id: "user-2",
    delegated_from_username: "bob",
    created_at: now,
    started_at: null,
    completed_at: null,
    updated_at: now,
    ...(overrides ?? {})
  };
}

function buildPullRequestReviewThreadRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
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
    body: "Please handle null path.",
    base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    start_side: "head",
    start_line: 12,
    end_side: "head",
    end_line: 12,
    hunk_header: "@@ -10,3 +10,4 @@",
    status: "open",
    resolved_by: null,
    resolved_by_username: null,
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ...(overrides ?? {})
  };
}

function buildPullRequestReviewThreadCommentRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    id: "thread-comment-1",
    repository_id: "repo-1",
    pull_request_id: "pr-1",
    pull_request_number: 1,
    thread_id: "thread-1",
    author_id: "user-2",
    author_username: "bob",
    body: "Please handle null path.",
    suggested_start_line: null,
    suggested_end_line: null,
    suggested_side: null,
    suggested_code: null,
    created_at: now,
    updated_at: now,
    ...(overrides ?? {})
  };
}

describe("API issues and pull requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects issue creation for non-collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM repository_collaborators",
        first: () => null
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Need bugfix"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(403);
  });

  it("allows collaborators to create issues", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "RETURNING issue_number_seq AS issue_number",
        first: () => ({ issue_number: 1 })
      },
      {
        when: "INSERT INTO issues",
        run: () => ({ success: true })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "user-2",
          author_username: "bob",
          title: "Need bugfix",
          body: "Steps to reproduce",
          state: "open",
          task_status: "open",
          acceptance_criteria: "- bug fixed",
          created_at: Date.now(),
          updated_at: Date.now(),
          closed_at: null
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Need bugfix",
          body: "Steps to reproduce",
          acceptanceCriteria: "- bug fixed"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      issue: {
        number: number;
        title: string;
        state: string;
        task_status: string;
        acceptance_criteria: string;
      };
    };
    expect(body.issue.number).toBe(1);
    expect(body.issue.title).toBe("Need bugfix");
    expect(body.issue.state).toBe("open");
    expect(body.issue.task_status).toBe("open");
    expect(body.issue.acceptance_criteria).toBe("- bug fixed");
  });

  it("returns issue detail with linked pull requests", async () => {
    const now = Date.now();
    const reconcileIssueTaskStatus = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssueTaskStatus")
      .mockResolvedValue({
        id: "issue-1",
        repository_id: "repo-1",
        number: 1,
        author_id: "owner-1",
        author_username: "alice",
      title: "Need login fix",
      body: "body",
      state: "open",
      task_status: "agent-working",
      acceptance_criteria: "- login succeeds\n- error state is visible",
      comment_count: 0,
      labels: [],
      assignees: [],
      milestone: null,
      reactions: [],
      created_at: now,
        updated_at: now,
        closed_at: null
      });
    vi.spyOn(WorkflowTaskFlowService.prototype, "buildIssueTaskFlow").mockResolvedValue({
      status: "agent-working",
      waiting_on: "agent",
      headline: "PR #7 正在推进当前 Issue。",
      detail: "先等待当前 PR 的下一轮 Agent 交付。",
      driver_pull_request_number: 7
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Need login fix",
          body: "body",
          state: "open",
          task_status: "waiting-human",
          acceptance_criteria: "- login succeeds\n- error state is visible",
          created_at: now,
          updated_at: now,
          closed_at: null
        })
      },
      {
        when: "FROM pull_request_closing_issues pci",
        all: () => [
          {
            id: "pr-1",
            repository_id: "repo-1",
            number: 7,
            author_id: "user-2",
            author_username: "bob",
            title: "Fix login retry flow",
            state: "open",
            draft: 0,
            base_ref: "refs/heads/main",
            head_ref: "refs/heads/fix-login",
            merge_commit_oid: null,
            created_at: now - 10_000,
            updated_at: now - 5_000,
            closed_at: null,
            merged_at: null
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      issue: { task_status: string; acceptance_criteria: string };
      linkedPullRequests: Array<{ number: number; title: string; head_ref: string }>;
      taskFlow: {
        status: string;
        waiting_on: string;
        driver_pull_request_number: number | null;
      };
    };
    expect(body.issue.task_status).toBe("agent-working");
    expect(body.issue.acceptance_criteria).toContain("login succeeds");
    expect(body.linkedPullRequests).toHaveLength(1);
    expect(body.linkedPullRequests[0]?.number).toBe(7);
    expect(body.linkedPullRequests[0]?.title).toBe("Fix login retry flow");
    expect(body.linkedPullRequests[0]?.head_ref).toBe("refs/heads/fix-login");
    expect(body.taskFlow.status).toBe("agent-working");
    expect(body.taskFlow.waiting_on).toBe("agent");
    expect(body.taskFlow.driver_pull_request_number).toBe(7);
    expect(reconcileIssueTaskStatus).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      issueNumber: 1
    });
  });

  it("allows collaborators to update issue task status and acceptance criteria", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const now = Date.now();
    const issueRow = {
      id: "issue-1",
      repository_id: "repo-1",
      number: 1,
      author_id: "owner-1",
      author_username: "alice",
      title: "Need login fix",
      body: "body",
      state: "open",
      task_status: "open",
      acceptance_criteria: "",
      created_at: now,
      updated_at: now,
      closed_at: null
    };
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "write" })
      },
      {
        when: "FROM issues i",
        first: () => issueRow
      },
      {
        when: "UPDATE issues",
        run: (params) => {
          issueRow.task_status = String(params[0]);
          issueRow.acceptance_criteria = String(params[1]);
          issueRow.updated_at = Number(params[2]);
          return { success: true };
        }
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          taskStatus: "agent-working",
          acceptanceCriteria: "- login succeeds"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      issue: { task_status: string; acceptance_criteria: string };
    };
    expect(body.issue.task_status).toBe("agent-working");
    expect(body.issue.acceptance_criteria).toBe("- login succeeds");
  });

  it("lists issue comments for readable repositories", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Issue one",
          body: "body",
          state: "open",
          created_at: now,
          updated_at: now,
          closed_at: null
        })
      },
      {
        when: "FROM issue_comments c",
        all: () => [
          {
            id: "comment-1",
            repository_id: "repo-1",
            issue_id: "issue-1",
            issue_number: 1,
            author_id: "owner-1",
            author_username: "alice",
            body: "First comment",
            created_at: now,
            updated_at: now
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1/comments"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { comments: Array<{ id: string; body: string }> };
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]?.id).toBe("comment-1");
    expect(body.comments[0]?.body).toBe("First comment");
  });

  it("rejects issue comment creation for non-collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM repository_collaborators",
        first: () => null
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          body: "Can I help?"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(403);
  });

  it("allows collaborators to create issue comments", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Need bugfix",
          body: "Steps",
          state: "open",
          created_at: now,
          updated_at: now,
          closed_at: null
        })
      },
      {
        when: "INSERT INTO issue_comments",
        run: () => ({ success: true })
      },
      {
        when: "FROM issue_comments c",
        first: () => ({
          id: "comment-1",
          repository_id: "repo-1",
          issue_id: "issue-1",
          issue_number: 1,
          author_id: "user-2",
          author_username: "bob",
          body: "I can take this",
          created_at: now,
          updated_at: now
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          body: "I can take this"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { comment: { id: string; author_username: string } };
    expect(body.comment.id).toBe("comment-1");
    expect(body.comment.author_username).toBe("bob");
  });

  it("creates issue comments as actions when token requests actions identity", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(null);
    vi.spyOn(AuthService.prototype, "verifyAccessTokenWithMetadata").mockResolvedValue({
      user: { id: "user-2", username: "bob" },
      context: {
        tokenId: "tok-actions",
        isInternal: true,
        displayAsActions: true
      }
    });
    vi.spyOn(AuthService.prototype, "getOrCreateActionsUser").mockResolvedValue({
      id: "actions-system-user",
      username: "actions"
    });

    const now = Date.now();
    let insertedAuthorId: string | null = null;
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Need bugfix",
          body: "Steps",
          state: "open",
          created_at: now,
          updated_at: now,
          closed_at: null
        })
      },
      {
        when: "INSERT INTO issue_comments",
        run: (params) => {
          insertedAuthorId = String(params[4] ?? "");
          return { success: true };
        }
      },
      {
        when: "FROM issue_comments c",
        first: () => ({
          id: "comment-1",
          repository_id: "repo-1",
          issue_id: "issue-1",
          issue_number: 1,
          author_id: "actions-system-user",
          author_username: "actions",
          body: "I can take this",
          created_at: now,
          updated_at: now
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer pat-actions",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          body: "I can take this"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    expect(insertedAuthorId).toBe("actions-system-user");
    const body = (await response.json()) as { comment: { author_username: string } };
    expect(body.comment.author_username).toBe("actions");
  });

  it("does not trigger actions for comments authored as actions identity", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(null);
    vi.spyOn(AuthService.prototype, "verifyAccessTokenWithMetadata").mockResolvedValue({
      user: { id: "user-2", username: "bob" },
      context: {
        tokenId: "tok-actions",
        isInternal: true,
        displayAsActions: true
      }
    });
    vi.spyOn(AuthService.prototype, "getOrCreateActionsUser").mockResolvedValue({
      id: "actions-system-user",
      username: "actions"
    });

    const enqueueRun = vi.fn(async () => undefined);
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Need bugfix",
          body: "Steps",
          state: "open",
          created_at: now,
          updated_at: now,
          closed_at: null
        })
      },
      {
        when: "INSERT INTO issue_comments",
        run: () => ({ success: true })
      },
      {
        when: "FROM issue_comments c",
        first: () => ({
          id: "comment-1",
          repository_id: "repo-1",
          issue_id: "issue-1",
          issue_number: 1,
          author_id: "actions-system-user",
          author_username: "actions",
          body: "@actions please run",
          created_at: now,
          updated_at: now
        }),
        all: () => [
          {
            id: "comment-1",
            repository_id: "repo-1",
            issue_id: "issue-1",
            issue_number: 1,
            author_id: "actions-system-user",
            author_username: "actions",
            body: "@actions please run",
            created_at: now,
            updated_at: now
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer pat-actions",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          body: "@actions please run"
        })
      }),
      {
        ...createBaseEnv(db),
        ACTIONS_QUEUE: {
          send: enqueueRun
        } as unknown as Queue<unknown>
      }
    );

    expect(response.status).toBe(201);
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("triggers issue actions on issue comment creation with full conversation history", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(RepositoryObjectClient.prototype, "resolveDefaultBranchTarget").mockResolvedValue({
      ref: "refs/heads/main",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    const enqueueRun = vi.fn(async () => undefined);
    const now = Date.now();
    let createdRunPrompt = "";
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Need bugfix",
          body: "Initial issue details",
          state: "open",
          created_at: now,
          updated_at: now,
          closed_at: null
        })
      },
      {
        when: "INSERT INTO issue_comments",
        run: () => ({ success: true })
      },
      {
        when: "FROM issue_comments c",
        first: () => ({
          id: "comment-2",
          repository_id: "repo-1",
          issue_id: "issue-1",
          issue_number: 1,
          author_id: "user-2",
          author_username: "bob",
          body: "Added logs below",
          created_at: now,
          updated_at: now
        }),
        all: () => [
          {
            id: "comment-1",
            repository_id: "repo-1",
            issue_id: "issue-1",
            issue_number: 1,
            author_id: "owner-1",
            author_username: "alice",
            body: "Can you share stack trace?",
            created_at: now - 1_000,
            updated_at: now - 1_000
          },
          {
            id: "comment-2",
            repository_id: "repo-1",
            issue_id: "issue-1",
            issue_number: 1,
            author_id: "user-2",
            author_username: "bob",
            body: "Added logs below",
            created_at: now,
            updated_at: now
          }
        ]
      },
      {
        when: "WHERE repository_id = ? AND trigger_event = ? AND enabled = 1",
        all: () => [
          {
            id: "workflow-1",
            repository_id: "repo-1",
            name: "Issue Bot",
            trigger_event: "issue_created",
            agent_type: "codex",
            prompt: "Issue workflow prompt",
            push_branch_regex: null,
            push_tag_regex: null,
            enabled: 1,
            created_by: "owner-1",
            created_at: now,
            updated_at: now
          }
        ]
      },
      {
        when: "RETURNING action_run_seq AS run_number",
        first: () => ({ run_number: 1 })
      },
      {
        when: "INSERT INTO action_runs",
        run: (params) => {
          createdRunPrompt = String(params[15] ?? "");
          return { success: true };
        }
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () => ({
          id: "run-1",
          repository_id: "repo-1",
          run_number: 1,
          workflow_id: "workflow-1",
          workflow_name: "Issue Bot",
          trigger_event: "issue_created",
          trigger_ref: "refs/heads/main",
          trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          trigger_source_type: "issue",
          trigger_source_number: 1,
          trigger_source_comment_id: "comment-2",
          triggered_by: "user-2",
          triggered_by_username: "bob",
          status: "queued",
          agent_type: "codex",
          prompt: createdRunPrompt,
          logs: "",
          exit_code: null,
          container_instance: null,
          created_at: now,
          started_at: null,
          completed_at: null,
          updated_at: now
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          body: "Added logs below"
        })
      }),
      {
        ...createBaseEnv(db),
        ACTIONS_QUEUE: {
          send: enqueueRun
        } as unknown as Queue<unknown>
      }
    );

    expect(response.status).toBe(201);
    expect(enqueueRun).toHaveBeenCalledTimes(1);
    expect(createdRunPrompt).toContain("trigger_reason: issue_comment_added");
    expect(createdRunPrompt).toContain("trigger_comment_id: comment-2");
    expect(createdRunPrompt).toContain("issue_conversation_history:");
    expect(createdRunPrompt).toContain("Initial issue details");
    expect(createdRunPrompt).toContain("Can you share stack trace?");
    expect(createdRunPrompt).toContain("Added logs below");
    expect(createdRunPrompt).toContain("summarize/compress");
  });

  it("reconciles issue task status after assigning an issue agent", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const reconciledIssue = {
      id: "issue-1",
      repository_id: "repo-1",
      number: 1,
      author_id: "owner-1",
      author_username: "alice",
      title: "Need bugfix",
      body: "Initial issue details",
      state: "open",
      task_status: "agent-working",
      acceptance_criteria: "- bug fixed",
      comment_count: 0,
      labels: [],
      assignees: [],
      milestone: null,
      reactions: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      closed_at: null
    };
    const reconcileIssueTaskStatus = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssueTaskStatus")
      .mockResolvedValue(reconciledIssue);
    vi.spyOn(RepositoryObjectClient.prototype, "resolveDefaultBranchTarget").mockResolvedValue({
      ref: "refs/heads/main",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("workflow-interactive")
      .mockReturnValueOnce("run-issue-assign")
      .mockReturnValueOnce("session-issue-assign");
    const enqueueRun = vi.fn(async () => undefined);
    const now = Date.now();
    let insertedPrompt = "";
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Need bugfix",
          body: "Initial issue details",
          state: "open",
          task_status: "open",
          acceptance_criteria: "- bug fixed",
          created_at: now,
          updated_at: now,
          closed_at: null
        })
      },
      {
        when: "FROM issue_comments c",
        all: () => []
      },
      {
        when: "FROM action_workflows\n         WHERE repository_id = ? AND id = ?",
        first: () => ({
          id: "workflow-interactive",
          repository_id: "repo-1",
          name: "__agent_session_internal__codex",
          trigger_event: "mention_actions",
          agent_type: "codex",
          prompt: "internal interactive agent session workflow",
          push_branch_regex: null,
          push_tag_regex: null,
          enabled: 1,
          created_by: "owner-1",
          created_at: now,
          updated_at: now
        })
      },
      {
        when: "FROM global_settings",
        all: () => []
      },
      {
        when: "FROM repository_actions_configs",
        first: () => null
      },
      {
        when: "FROM action_workflows\n         WHERE repository_id = ?\n         ORDER BY updated_at DESC, created_at DESC",
        all: () => []
      },
      {
        when: "INSERT INTO action_workflows",
        run: () => ({ success: true })
      },
      {
        when: "RETURNING action_run_seq AS run_number",
        first: () => ({ run_number: 7 })
      },
      {
        when: "INSERT INTO action_runs",
        run: (params) => {
          insertedPrompt = String(params[15] ?? "");
          return { success: true };
        }
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () =>
          buildActionRunRow({
            id: "run-issue-assign",
            run_number: 7,
            workflow_id: "workflow-interactive",
            workflow_name: "__agent_session_internal__codex",
            trigger_event: "mention_actions",
            trigger_ref: "refs/heads/main",
            trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            trigger_source_type: "issue",
            trigger_source_number: 1,
            triggered_by: "user-2",
            triggered_by_username: "bob",
            prompt: insertedPrompt || "placeholder",
            created_at: now,
            updated_at: now
          })
      },
      {
        when: "WHERE s.repository_id = ? AND s.linked_run_id = ?",
        first: () => null
      },
      {
        when: "INSERT INTO agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-issue-assign",
            source_type: "issue",
            source_number: 1,
            origin: "issue_assign",
            linked_run_id: "run-issue-assign",
            prompt: insertedPrompt || "placeholder",
            created_at: now,
            updated_at: now
          })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues/1/assign-agent", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agentType: "codex",
          prompt: "Please start with the failing path."
        })
      }),
      {
        ...createBaseEnv(db),
        ACTIONS_QUEUE: {
          send: enqueueRun
        } as unknown as Queue<unknown>
      }
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      issue: { task_status: string };
      run: { id: string; status: string };
      session: { id: string; status: string };
    };
    expect(body.issue.task_status).toBe("agent-working");
    expect(body.run.id).toBe("run-issue-assign");
    expect(body.run.status).toBe("queued");
    expect(body.session.id).toBe("session-issue-assign");
    expect(body.session.status).toBe("queued");
    expect(reconcileIssueTaskStatus).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      issueNumber: 1,
      viewerId: "user-2"
    });
    expect(enqueueRun).toHaveBeenCalledTimes(1);
    expect(insertedPrompt).toContain("Issue #1");
    expect(insertedPrompt).toContain("Please start with the failing path.");
  });

  it("rejects pull request creation for non-collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM repository_collaborators",
        first: () => null
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Add feature",
          baseRef: "main",
          headRef: "feature"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(403);
  });

  it("allows collaborators to create pull requests", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(RepositoryObjectClient.prototype, "listHeadRefs").mockResolvedValue([
      { name: "refs/heads/main", oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { name: "refs/heads/feature", oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    ]);
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "state = 'open' AND base_ref = ? AND head_ref = ?",
        first: () => null
      },
      {
        when: "RETURNING pull_number_seq AS pull_number",
        first: () => ({ pull_number: 1 })
      },
      {
        when: "INSERT INTO pull_requests",
        run: () => ({ success: true })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "user-2",
          author_username: "bob",
          title: "Add feature",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: Date.now(),
          updated_at: Date.now(),
          closed_at: null,
          merged_at: null
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Add feature",
          baseRef: "main",
          headRef: "feature"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      pullRequest: { number: number; state: string; base_ref: string; head_ref: string };
    };
    expect(body.pullRequest.number).toBe(1);
    expect(body.pullRequest.state).toBe("open");
    expect(body.pullRequest.base_ref).toBe("refs/heads/main");
    expect(body.pullRequest.head_ref).toBe("refs/heads/feature");
  });

  it("returns pull request detail with linked closing issues", async () => {
    const now = Date.now();
    const reconcileIssueTaskStatus = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssueTaskStatus")
      .mockResolvedValue({
        id: "issue-3",
        repository_id: "repo-1",
        number: 3,
        author_id: "owner-1",
        author_username: "alice",
        title: "Fix login",
        body: "body",
        state: "open",
        task_status: "waiting-human",
        acceptance_criteria: "- login succeeds",
        comment_count: 0,
        labels: [],
        assignees: [],
        milestone: null,
        reactions: [],
        created_at: now - 5_000,
        updated_at: now - 1_000,
        closed_at: null
      });
    vi.spyOn(WorkflowTaskFlowService.prototype, "buildPullRequestTaskFlow").mockResolvedValue({
      waiting_on: "human",
      headline: "当前 PR 已进入待人工审校/合并阶段。",
      detail: "等待人工最终决定是否合并。",
      primary_issue_number: 3,
      suggested_review_thread_id: "thread-1"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "user-2",
          author_username: "bob",
          title: "Add feature",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "FROM pull_request_reviews",
        all: () => [
          {
            id: "review-1",
            reviewer_id: "user-2",
            decision: "approve",
            created_at: now
          }
        ]
      },
      {
        when: "FROM pull_request_closing_issues",
        all: () => [{ issue_number: 3 }]
      },
      {
        when: "FROM issues i",
        all: () => [
          {
            id: "issue-3",
            repository_id: "repo-1",
            number: 3,
            author_id: "owner-1",
            author_username: "alice",
            title: "Fix login",
            body: "body",
            state: "open",
            task_status: "waiting-human",
            acceptance_criteria: "- login succeeds",
            created_at: now - 5_000,
            updated_at: now - 1_000,
            closed_at: null
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      closingIssueNumbers: number[];
      closingIssues: Array<{ number: number; task_status: string; acceptance_criteria: string }>;
      taskFlow: {
        waiting_on: string;
        primary_issue_number: number | null;
        suggested_review_thread_id: string | null;
      };
    };
    expect(body.closingIssueNumbers).toEqual([3]);
    expect(body.closingIssues).toHaveLength(1);
    expect(body.closingIssues[0]?.number).toBe(3);
    expect(body.closingIssues[0]?.task_status).toBe("waiting-human");
    expect(body.closingIssues[0]?.acceptance_criteria).toContain("login succeeds");
    expect(body.taskFlow.waiting_on).toBe("human");
    expect(body.taskFlow.primary_issue_number).toBe(3);
    expect(body.taskFlow.suggested_review_thread_id).toBe("thread-1");
    expect(reconcileIssueTaskStatus).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      issueNumber: 3
    });
  });

  it("lists issues for readable repositories", async () => {
    const reconcileIssueTaskStatus = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssueTaskStatus")
      .mockResolvedValue({
        id: "issue-1",
        repository_id: "repo-1",
        number: 1,
        author_id: "owner-1",
        author_username: "alice",
        title: "Issue one",
        body: "body",
        state: "open",
        task_status: "waiting-human",
        acceptance_criteria: "",
        comment_count: 0,
        labels: [],
        assignees: [],
        milestone: null,
        reactions: [],
        created_at: Date.now(),
        updated_at: Date.now(),
        closed_at: null
      });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM issues i",
        all: () => [
          {
            id: "issue-1",
            repository_id: "repo-1",
            number: 1,
            author_id: "owner-1",
            author_username: "alice",
            title: "Issue one",
            body: "body",
            state: "open",
            created_at: Date.now(),
            updated_at: Date.now(),
            closed_at: null
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/issues?state=all"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      issues: Array<{ number: number; title: string; task_status: string }>;
    };
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]?.number).toBe(1);
    expect(body.issues[0]?.title).toBe("Issue one");
    expect(body.issues[0]?.task_status).toBe("waiting-human");
    expect(reconcileIssueTaskStatus).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      issueNumber: 1
    });
  });

  it("creates pull requests as actions when token requests actions identity", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(null);
    vi.spyOn(AuthService.prototype, "verifyAccessTokenWithMetadata").mockResolvedValue({
      user: { id: "user-2", username: "bob" },
      context: {
        tokenId: "tok-actions-pr",
        isInternal: true,
        displayAsActions: true
      }
    });
    vi.spyOn(AuthService.prototype, "getOrCreateActionsUser").mockResolvedValue({
      id: "actions-system-user",
      username: "actions"
    });
    vi.spyOn(RepositoryObjectClient.prototype, "listHeadRefs").mockResolvedValue([
      { name: "refs/heads/main", oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { name: "refs/heads/feature", oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    ]);

    const now = Date.now();
    let insertedAuthorId: string | null = null;
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "state = 'open' AND base_ref = ? AND head_ref = ?",
        first: () => null
      },
      {
        when: "RETURNING pull_number_seq AS pull_number",
        first: () => ({ pull_number: 2 })
      },
      {
        when: "INSERT INTO pull_requests",
        run: (params) => {
          insertedAuthorId = String(params[3] ?? "");
          return { success: true };
        }
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-2",
          repository_id: "repo-1",
          number: 2,
          author_id: "actions-system-user",
          author_username: "actions",
          title: "Add feature",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls", {
        method: "POST",
        headers: {
          authorization: "Bearer pat-actions-pr",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Add feature",
          baseRef: "main",
          headRef: "feature"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    expect(insertedAuthorId).toBe("actions-system-user");
    const body = (await response.json()) as { pullRequest: { author_username: string } };
    expect(body.pullRequest.author_username).toBe("actions");
  });

  it("rejects pull request review for non-collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-3",
      username: "charlie"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM repository_collaborators",
        first: () => null
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/reviews", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          decision: "approve",
          body: "Looks good"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(403);
  });

  it("allows collaborators to submit pull request reviews", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const reconcileIssuesForPullRequest = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssuesForPullRequest")
      .mockResolvedValue([]);
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "INSERT INTO pull_request_reviews",
        run: () => ({ success: true })
      },
      {
        when: "WHERE r.id = ?",
        first: () => ({
          id: "review-1",
          repository_id: "repo-1",
          pull_request_id: "pr-1",
          pull_request_number: 1,
          reviewer_id: "user-2",
          reviewer_username: "bob",
          decision: "approve",
          body: "Looks good",
          created_at: now
        })
      },
      {
        when: "FROM pull_request_reviews",
        all: () => [
          {
            id: "review-1",
            reviewer_id: "user-2",
            decision: "approve",
            created_at: now
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/reviews", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          decision: "approve",
          body: "Looks good"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      review: { decision: string; reviewer_username: string };
      reviewSummary: { approvals: number; changeRequests: number; comments: number };
    };
    expect(body.review.decision).toBe("approve");
    expect(body.review.reviewer_username).toBe("bob");
    expect(body.reviewSummary.approvals).toBe(1);
    expect(body.reviewSummary.changeRequests).toBe(0);
    expect(body.reviewSummary.comments).toBe(0);
    expect(reconcileIssuesForPullRequest).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      pullRequestNumber: 1,
      viewerId: "user-2"
    });
  });

  it("lists pull request review threads for readable repositories", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "ORDER BY\n           CASE WHEN t.status = 'open' THEN 0 ELSE 1 END",
        all: () => [buildPullRequestReviewThreadRow()]
      },
      {
        when: "FROM pull_request_review_thread_comments c",
        all: () => [buildPullRequestReviewThreadCommentRow()]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/review-threads"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reviewThreads: Array<{
        id: string;
        path: string;
        line: number;
        status: string;
        comments: Array<{ id: string }>;
      }>;
    };
    expect(body.reviewThreads).toHaveLength(1);
    expect(body.reviewThreads[0]?.id).toBe("thread-1");
    expect(body.reviewThreads[0]?.path).toBe("src/app.ts");
    expect(body.reviewThreads[0]?.line).toBe(12);
    expect(body.reviewThreads[0]?.status).toBe("open");
    expect(body.reviewThreads[0]?.comments).toHaveLength(1);
  });

  it("re-anchors review threads after newer pull request commits", async () => {
    const compareRefs = vi
      .spyOn(RepositoryObjectClient.prototype, "compareRefs")
      .mockResolvedValueOnce({
        baseRef: "refs/heads/main",
        headRef: "refs/heads/feature",
        baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        headOid: "cccccccccccccccccccccccccccccccccccccccc",
        mergeBaseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mergeable: "mergeable",
        aheadBy: 2,
        behindBy: 0,
        filesChanged: 1,
        additions: 1,
        deletions: 0,
        commits: [],
        changes: [
          {
            path: "src/app.ts",
            previousPath: null,
            status: "modified",
            mode: "100644",
            previousMode: "100644",
            oid: "cccccccccccccccccccccccccccccccccccccccc",
            previousOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            additions: 1,
            deletions: 0,
            isBinary: false,
            patch: "@@ -14,1 +14,1 @@\n const value = normalizePath(path);",
            hunks: [
              {
                header: "@@ -14,1 +14,1 @@",
                oldStart: 14,
                oldLines: 1,
                newStart: 14,
                newLines: 1,
                lines: [
                  {
                    kind: "context",
                    content: "const value = normalizePath(path);",
                    oldLineNumber: 14,
                    newLineNumber: 14
                  }
                ]
              }
            ],
            oldContent: "const value = normalizePath(path);",
            newContent: "const value = normalizePath(path);"
          }
        ]
      })
      .mockResolvedValueOnce({
        baseRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        headRef: "cccccccccccccccccccccccccccccccccccccccc",
        baseOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        headOid: "cccccccccccccccccccccccccccccccccccccccc",
        mergeBaseOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        mergeable: "mergeable",
        aheadBy: 1,
        behindBy: 0,
        filesChanged: 1,
        additions: 2,
        deletions: 0,
        commits: [],
        changes: [
          {
            path: "src/app.ts",
            previousPath: null,
            status: "modified",
            mode: "100644",
            previousMode: "100644",
            oid: "cccccccccccccccccccccccccccccccccccccccc",
            previousOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            additions: 2,
            deletions: 0,
            isBinary: false,
            patch: "@@ -1,0 +1,2 @@\n+const prelude = true;\n+const shifted = true;",
            hunks: [
              {
                header: "@@ -1,0 +1,2 @@",
                oldStart: 1,
                oldLines: 0,
                newStart: 1,
                newLines: 2,
                lines: [
                  {
                    kind: "add",
                    content: "const prelude = true;",
                    oldLineNumber: null,
                    newLineNumber: 1
                  },
                  {
                    kind: "add",
                    content: "const shifted = true;",
                    oldLineNumber: null,
                    newLineNumber: 2
                  }
                ]
              }
            ],
            oldContent: "",
            newContent: "const prelude = true;\nconst shifted = true;"
          }
        ]
      });
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "cccccccccccccccccccccccccccccccccccccccc",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "ORDER BY\n           CASE WHEN t.status = 'open' THEN 0 ELSE 1 END",
        all: () =>
          [
            buildPullRequestReviewThreadRow({
              head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              line: 12,
              start_line: 12,
              end_line: 12,
              hunk_header: "@@ -12,1 +12,1 @@"
            })
          ]
      },
      {
        when: "FROM pull_request_review_thread_comments c",
        all: () => [buildPullRequestReviewThreadCommentRow()]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/review-threads"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reviewThreads: Array<{
        anchor?: {
          status: string;
          patchset_changed: boolean;
          start_line: number | null;
          hunk_header: string | null;
        };
      }>;
    };
    expect(body.reviewThreads[0]?.anchor?.status).toBe("reanchored");
    expect(body.reviewThreads[0]?.anchor?.patchset_changed).toBe(true);
    expect(body.reviewThreads[0]?.anchor?.start_line).toBe(14);
    expect(body.reviewThreads[0]?.anchor?.hunk_header).toBe("@@ -14,1 +14,1 @@");
    expect(compareRefs).toHaveBeenNthCalledWith(1, {
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo",
      baseRef: "refs/heads/main",
      headRef: "refs/heads/feature"
    });
    expect(compareRefs).toHaveBeenNthCalledWith(2, {
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo",
      baseRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      headRef: "cccccccccccccccccccccccccccccccccccccccc"
    });
  });

  it("marks review threads stale when they no longer map to the current diff", async () => {
    vi.spyOn(RepositoryObjectClient.prototype, "compareRefs")
      .mockResolvedValueOnce({
        baseRef: "refs/heads/main",
        headRef: "refs/heads/feature",
        baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        headOid: "cccccccccccccccccccccccccccccccccccccccc",
        mergeBaseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mergeable: "mergeable",
        aheadBy: 2,
        behindBy: 0,
        filesChanged: 1,
        additions: 1,
        deletions: 0,
        commits: [],
        changes: [
          {
            path: "src/app.ts",
            previousPath: null,
            status: "modified",
            mode: "100644",
            previousMode: "100644",
            oid: "cccccccccccccccccccccccccccccccccccccccc",
            previousOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            additions: 1,
            deletions: 0,
            isBinary: false,
            patch: "@@ -30,1 +30,1 @@\n const unrelated = true;",
            hunks: [
              {
                header: "@@ -30,1 +30,1 @@",
                oldStart: 30,
                oldLines: 1,
                newStart: 30,
                newLines: 1,
                lines: [
                  {
                    kind: "context",
                    content: "const unrelated = true;",
                    oldLineNumber: 30,
                    newLineNumber: 30
                  }
                ]
              }
            ],
            oldContent: "const unrelated = true;",
            newContent: "const unrelated = true;"
          }
        ]
      })
      .mockResolvedValueOnce({
        baseRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        headRef: "cccccccccccccccccccccccccccccccccccccccc",
        baseOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        headOid: "cccccccccccccccccccccccccccccccccccccccc",
        mergeBaseOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        mergeable: "mergeable",
        aheadBy: 1,
        behindBy: 0,
        filesChanged: 1,
        additions: 0,
        deletions: 1,
        commits: [],
        changes: [
          {
            path: "src/app.ts",
            previousPath: null,
            status: "modified",
            mode: "100644",
            previousMode: "100644",
            oid: "cccccccccccccccccccccccccccccccccccccccc",
            previousOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            additions: 0,
            deletions: 1,
            isBinary: false,
            patch: "@@ -12,1 +12,0 @@\n-const value = path;",
            hunks: [
              {
                header: "@@ -12,1 +12,0 @@",
                oldStart: 12,
                oldLines: 1,
                newStart: 12,
                newLines: 0,
                lines: [
                  {
                    kind: "delete",
                    content: "const value = path;",
                    oldLineNumber: 12,
                    newLineNumber: null
                  }
                ]
              }
            ],
            oldContent: "const value = path;",
            newContent: ""
          }
        ]
      });
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "cccccccccccccccccccccccccccccccccccccccc",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "ORDER BY\n           CASE WHEN t.status = 'open' THEN 0 ELSE 1 END",
        all: () =>
          [
            buildPullRequestReviewThreadRow({
              head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              line: 12,
              start_line: 12,
              end_line: 12,
              hunk_header: "@@ -12,1 +12,1 @@"
            })
          ]
      },
      {
        when: "FROM pull_request_review_thread_comments c",
        all: () => [buildPullRequestReviewThreadCommentRow()]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/review-threads"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reviewThreads: Array<{
        anchor?: {
          status: string;
          patchset_changed: boolean;
          start_line: number | null;
          message: string;
        };
      }>;
    };
    expect(body.reviewThreads[0]?.anchor?.status).toBe("stale");
    expect(body.reviewThreads[0]?.anchor?.patchset_changed).toBe(true);
    expect(body.reviewThreads[0]?.anchor?.start_line).toBeNull();
    expect(body.reviewThreads[0]?.anchor?.message).toContain("no longer maps");
  });

  it("allows collaborators to create pull request review threads", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const reconcileIssuesForPullRequest = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssuesForPullRequest")
      .mockResolvedValue([]);
    const compareRefs = vi.spyOn(RepositoryObjectClient.prototype, "compareRefs").mockResolvedValue({
      baseRef: "refs/heads/main",
      headRef: "refs/heads/feature",
      baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      headOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      mergeBaseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      mergeable: "mergeable",
      aheadBy: 1,
      behindBy: 0,
      filesChanged: 1,
      additions: 1,
      deletions: 0,
      commits: [],
      changes: [
        {
          path: "src/app.ts",
          previousPath: null,
          status: "modified",
          mode: "100644",
          previousMode: "100644",
          oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          previousOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          additions: 1,
          deletions: 0,
          isBinary: false,
          patch: "@@ -12,1 +12,1 @@\n const value = path;",
          hunks: [
            {
              header: "@@ -12,1 +12,1 @@",
              oldStart: 12,
              oldLines: 1,
              newStart: 12,
              newLines: 1,
              lines: [
                {
                  kind: "context",
                  content: "const value = path;",
                  oldLineNumber: 12,
                  newLineNumber: 12
                }
              ]
            }
          ],
          oldContent: "const value = path;",
          newContent: "const value = path;"
        }
      ]
    });
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "INSERT INTO pull_request_review_threads",
        run: () => ({ success: true })
      },
      {
        when: "INSERT INTO pull_request_review_thread_comments",
        run: () => ({ success: true })
      },
      {
        when: "WHERE t.repository_id = ? AND t.pull_request_number = ? AND t.id = ?",
        first: () =>
          buildPullRequestReviewThreadRow({
            body: "Please handle null path.",
            start_side: "head",
            start_line: 12,
            end_side: "head",
            end_line: 12,
            hunk_header: "@@ -12,1 +12,1 @@"
          })
      },
      {
        when: "FROM pull_request_review_thread_comments c",
        all: () => [
          buildPullRequestReviewThreadCommentRow({
            body: "Please handle null path.",
            suggested_start_line: 12,
            suggested_end_line: 12,
            suggested_side: "head",
            suggested_code: "const value = normalizePath(path);"
          })
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/review-threads", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          path: "src/app.ts",
          baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          headOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          startSide: "head",
          startLine: 12,
          endSide: "head",
          endLine: 12,
          hunkHeader: "@@ -12,1 +12,1 @@",
          body: "Please handle null path.",
          suggestedCode: "const value = normalizePath(path);"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      reviewThread: {
        path: string;
        line: number;
        side: string;
        author_username: string;
        comments: Array<{ suggestion: { code: string } | null }>;
      };
    };
    expect(body.reviewThread.path).toBe("src/app.ts");
    expect(body.reviewThread.line).toBe(12);
    expect(body.reviewThread.side).toBe("head");
    expect(body.reviewThread.author_username).toBe("bob");
    expect(body.reviewThread.comments[0]?.suggestion?.code).toBe(
      "const value = normalizePath(path);"
    );
    expect(compareRefs).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo",
      baseRef: "refs/heads/main",
      headRef: "refs/heads/feature"
    });
    expect(reconcileIssuesForPullRequest).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      pullRequestNumber: 1,
      viewerId: "user-2"
    });
  });

  it("allows collaborators to resolve pull request review threads", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const reconcileIssuesForPullRequest = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssuesForPullRequest")
      .mockResolvedValue([]);
    const now = Date.now();
    let threadReadCount = 0;
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "WHERE t.repository_id = ? AND t.pull_request_number = ? AND t.id = ?",
        first: () => {
          threadReadCount += 1;
          return buildPullRequestReviewThreadRow({
            status: threadReadCount >= 2 ? "resolved" : "open",
            resolved_by: threadReadCount >= 2 ? "user-2" : null,
            resolved_by_username: threadReadCount >= 2 ? "bob" : null,
            resolved_at: threadReadCount >= 2 ? now + 1_000 : null,
            updated_at: threadReadCount >= 2 ? now + 1_000 : now
          });
        }
      },
      {
        when: "FROM pull_request_review_thread_comments c",
        all: () => [buildPullRequestReviewThreadCommentRow()]
      },
      {
        when: "UPDATE pull_request_review_threads",
        run: () => ({ success: true })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/review-threads/thread-1/resolve", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reviewThread: { id: string; status: string; resolved_by_username: string | null };
    };
    expect(body.reviewThread.id).toBe("thread-1");
    expect(body.reviewThread.status).toBe("resolved");
    expect(body.reviewThread.resolved_by_username).toBe("bob");
    expect(reconcileIssuesForPullRequest).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      pullRequestNumber: 1,
      viewerId: "user-2"
    });
  });

  it("allows collaborators to reply to pull request review threads with suggested changes", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const reconcileIssuesForPullRequest = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssuesForPullRequest")
      .mockResolvedValue([]);
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "WHERE t.repository_id = ? AND t.pull_request_number = ? AND t.id = ?",
        first: () =>
          buildPullRequestReviewThreadRow({
            start_side: "head",
            start_line: 12,
            end_side: "head",
            end_line: 12
          })
      },
      {
        when: "INSERT INTO pull_request_review_thread_comments",
        run: () => ({ success: true })
      },
      {
        when: "WHERE c.repository_id = ? AND c.pull_request_number = ? AND c.thread_id = ? AND c.id = ?",
        first: () =>
          buildPullRequestReviewThreadCommentRow({
            id: "thread-comment-2",
            body: "Use normalizePath here.",
            suggested_start_line: 12,
            suggested_end_line: 12,
            suggested_side: "head",
            suggested_code: "const value = normalizePath(path);"
          })
      },
      {
        when: "UPDATE pull_request_review_threads",
        run: () => ({ success: true })
      },
      {
        when: "FROM pull_request_review_thread_comments c",
        all: () => [
          buildPullRequestReviewThreadCommentRow(),
          buildPullRequestReviewThreadCommentRow({
            id: "thread-comment-2",
            body: "Use normalizePath here.",
            suggested_start_line: 12,
            suggested_end_line: 12,
            suggested_side: "head",
            suggested_code: "const value = normalizePath(path);",
            created_at: now + 1_000,
            updated_at: now + 1_000
          })
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/review-threads/thread-1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          body: "Use normalizePath here.",
          suggestedCode: "const value = normalizePath(path);"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      reviewThread: {
        id: string;
        comments: Array<{ id: string; suggestion: { code: string } | null }>;
      };
      comment: {
        id: string;
        suggestion: { code: string } | null;
      };
    };
    expect(body.comment.id).toBe("thread-comment-2");
    expect(body.comment.suggestion?.code).toBe("const value = normalizePath(path);");
    expect(body.reviewThread.id).toBe("thread-1");
    expect(body.reviewThread.comments).toHaveLength(2);
    expect(reconcileIssuesForPullRequest).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      pullRequestNumber: 1,
      viewerId: "user-2"
    });
  });

  it("re-anchors suggested changes when replying after newer pull request commits", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const compareRefs = vi
      .spyOn(RepositoryObjectClient.prototype, "compareRefs")
      .mockResolvedValueOnce({
        baseRef: "refs/heads/main",
        headRef: "refs/heads/feature",
        baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        headOid: "cccccccccccccccccccccccccccccccccccccccc",
        mergeBaseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mergeable: "mergeable",
        aheadBy: 2,
        behindBy: 0,
        filesChanged: 1,
        additions: 1,
        deletions: 0,
        commits: [],
        changes: [
          {
            path: "src/app.ts",
            previousPath: null,
            status: "modified",
            mode: "100644",
            previousMode: "100644",
            oid: "cccccccccccccccccccccccccccccccccccccccc",
            previousOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            additions: 1,
            deletions: 0,
            isBinary: false,
            patch: "@@ -14,1 +14,1 @@\n const value = normalizePath(path);",
            hunks: [
              {
                header: "@@ -14,1 +14,1 @@",
                oldStart: 14,
                oldLines: 1,
                newStart: 14,
                newLines: 1,
                lines: [
                  {
                    kind: "context",
                    content: "const value = normalizePath(path);",
                    oldLineNumber: 14,
                    newLineNumber: 14
                  }
                ]
              }
            ],
            oldContent: "const value = normalizePath(path);",
            newContent: "const value = normalizePath(path);"
          }
        ]
      })
      .mockResolvedValueOnce({
        baseRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        headRef: "cccccccccccccccccccccccccccccccccccccccc",
        baseOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        headOid: "cccccccccccccccccccccccccccccccccccccccc",
        mergeBaseOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        mergeable: "mergeable",
        aheadBy: 1,
        behindBy: 0,
        filesChanged: 1,
        additions: 2,
        deletions: 0,
        commits: [],
        changes: [
          {
            path: "src/app.ts",
            previousPath: null,
            status: "modified",
            mode: "100644",
            previousMode: "100644",
            oid: "cccccccccccccccccccccccccccccccccccccccc",
            previousOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            additions: 2,
            deletions: 0,
            isBinary: false,
            patch: "@@ -1,0 +1,2 @@\n+const prelude = true;\n+const shifted = true;",
            hunks: [
              {
                header: "@@ -1,0 +1,2 @@",
                oldStart: 1,
                oldLines: 0,
                newStart: 1,
                newLines: 2,
                lines: [
                  {
                    kind: "add",
                    content: "const prelude = true;",
                    oldLineNumber: null,
                    newLineNumber: 1
                  },
                  {
                    kind: "add",
                    content: "const shifted = true;",
                    oldLineNumber: null,
                    newLineNumber: 2
                  }
                ]
              }
            ],
            oldContent: "",
            newContent: "const prelude = true;\nconst shifted = true;"
          }
        ]
      })
      .mockResolvedValueOnce({
        baseRef: "refs/heads/main",
        headRef: "refs/heads/feature",
        baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        headOid: "cccccccccccccccccccccccccccccccccccccccc",
        mergeBaseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mergeable: "mergeable",
        aheadBy: 2,
        behindBy: 0,
        filesChanged: 1,
        additions: 1,
        deletions: 0,
        commits: [],
        changes: [
          {
            path: "src/app.ts",
            previousPath: null,
            status: "modified",
            mode: "100644",
            previousMode: "100644",
            oid: "cccccccccccccccccccccccccccccccccccccccc",
            previousOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            additions: 1,
            deletions: 0,
            isBinary: false,
            patch: "@@ -14,1 +14,1 @@\n const value = normalizePath(path);",
            hunks: [
              {
                header: "@@ -14,1 +14,1 @@",
                oldStart: 14,
                oldLines: 1,
                newStart: 14,
                newLines: 1,
                lines: [
                  {
                    kind: "context",
                    content: "const value = normalizePath(path);",
                    oldLineNumber: 14,
                    newLineNumber: 14
                  }
                ]
              }
            ],
            oldContent: "const value = normalizePath(path);",
            newContent: "const value = normalizePath(path);"
          }
        ]
      })
      .mockResolvedValueOnce({
        baseRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        headRef: "cccccccccccccccccccccccccccccccccccccccc",
        baseOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        headOid: "cccccccccccccccccccccccccccccccccccccccc",
        mergeBaseOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        mergeable: "mergeable",
        aheadBy: 1,
        behindBy: 0,
        filesChanged: 1,
        additions: 2,
        deletions: 0,
        commits: [],
        changes: [
          {
            path: "src/app.ts",
            previousPath: null,
            status: "modified",
            mode: "100644",
            previousMode: "100644",
            oid: "cccccccccccccccccccccccccccccccccccccccc",
            previousOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            additions: 2,
            deletions: 0,
            isBinary: false,
            patch: "@@ -1,0 +1,2 @@\n+const prelude = true;\n+const shifted = true;",
            hunks: [
              {
                header: "@@ -1,0 +1,2 @@",
                oldStart: 1,
                oldLines: 0,
                newStart: 1,
                newLines: 2,
                lines: [
                  {
                    kind: "add",
                    content: "const prelude = true;",
                    oldLineNumber: null,
                    newLineNumber: 1
                  },
                  {
                    kind: "add",
                    content: "const shifted = true;",
                    oldLineNumber: null,
                    newLineNumber: 2
                  }
                ]
              }
            ],
            oldContent: "",
            newContent: "const prelude = true;\nconst shifted = true;"
          }
        ]
      });
    const now = Date.now();
    let insertedSuggestedStartLine: number | null = null;
    let insertedSuggestedEndLine: number | null = null;
    let insertedSuggestedSide: string | null = null;
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "cccccccccccccccccccccccccccccccccccccccc",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "WHERE t.repository_id = ? AND t.pull_request_number = ? AND t.id = ?",
        first: () =>
          buildPullRequestReviewThreadRow({
            head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            start_side: "head",
            start_line: 12,
            end_side: "head",
            end_line: 12,
            hunk_header: "@@ -12,1 +12,1 @@"
          })
      },
      {
        when: "INSERT INTO pull_request_review_thread_comments",
        run: (params) => {
          insertedSuggestedStartLine = params[7] as number | null;
          insertedSuggestedEndLine = params[8] as number | null;
          insertedSuggestedSide = params[9] as string | null;
          return { success: true };
        }
      },
      {
        when: "WHERE c.repository_id = ? AND c.pull_request_number = ? AND c.thread_id = ? AND c.id = ?",
        first: () =>
          buildPullRequestReviewThreadCommentRow({
            id: "thread-comment-2",
            body: "Use normalizePath here.",
            suggested_start_line: 14,
            suggested_end_line: 14,
            suggested_side: "head",
            suggested_code: "const value = normalizePath(path);"
          })
      },
      {
        when: "UPDATE pull_request_review_threads",
        run: () => ({ success: true })
      },
      {
        when: "FROM pull_request_review_thread_comments c",
        all: () => [
          buildPullRequestReviewThreadCommentRow(),
          buildPullRequestReviewThreadCommentRow({
            id: "thread-comment-2",
            body: "Use normalizePath here.",
            suggested_start_line: 14,
            suggested_end_line: 14,
            suggested_side: "head",
            suggested_code: "const value = normalizePath(path);",
            created_at: now + 1_000,
            updated_at: now + 1_000
          })
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/review-threads/thread-1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          body: "Use normalizePath here.",
          suggestedCode: "const value = normalizePath(path);"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      reviewThread: {
        anchor?: { status: string; start_line: number | null };
        comments: Array<{ id: string; suggestion: { start_line: number; code: string } | null }>;
      };
      comment: {
        suggestion: { start_line: number; code: string } | null;
      };
    };
    expect(insertedSuggestedStartLine).toBe(14);
    expect(insertedSuggestedEndLine).toBe(14);
    expect(insertedSuggestedSide).toBe("head");
    expect(body.comment.suggestion?.start_line).toBe(14);
    expect(body.reviewThread.anchor?.status).toBe("reanchored");
    expect(body.reviewThread.anchor?.start_line).toBe(14);
    expect(body.reviewThread.comments[1]?.suggestion?.code).toBe(
      "const value = normalizePath(path);"
    );
    expect(compareRefs).toHaveBeenCalledTimes(4);
  });

  it("resumes a pull request agent from an open review thread", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const reconcileIssuesForPullRequest = vi
      .spyOn(WorkflowTaskFlowService.prototype, "reconcileIssuesForPullRequest")
      .mockResolvedValue([]);
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("workflow-interactive")
      .mockReturnValueOnce("run-thread-resume")
      .mockReturnValueOnce("session-thread-resume");
    const enqueueRun = vi.fn(async () => undefined);
    const now = Date.now();
    let insertedPrompt = "";

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "Please update the implementation safely.",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "FROM pull_request_reviews r",
        all: () => []
      },
      {
        when: "ORDER BY\n           CASE WHEN t.status = 'open' THEN 0 ELSE 1 END",
        all: () => [buildPullRequestReviewThreadRow()]
      },
      {
        when: "FROM pull_request_review_thread_comments c",
        all: () => [
          buildPullRequestReviewThreadCommentRow({
            body: "Please handle null path.",
            suggested_start_line: 12,
            suggested_end_line: 12,
            suggested_side: "head",
            suggested_code: "const value = normalizePath(path);"
          })
        ]
      },
      {
        when: "FROM action_workflows\n         WHERE repository_id = ? AND id = ?",
        first: () => ({
          id: "workflow-interactive",
          repository_id: "repo-1",
          name: "__agent_session_internal__codex",
          trigger_event: "mention_actions",
          agent_type: "codex",
          prompt: "internal interactive agent session workflow",
          push_branch_regex: null,
          push_tag_regex: null,
          enabled: 1,
          created_by: "owner-1",
          created_at: now,
          updated_at: now
        })
      },
      {
        when: "FROM global_settings",
        all: () => []
      },
      {
        when: "FROM repository_actions_configs",
        first: () => null
      },
      {
        when: "FROM action_workflows\n         WHERE repository_id = ?\n         ORDER BY updated_at DESC, created_at DESC",
        all: () => []
      },
      {
        when: "INSERT INTO action_workflows",
        run: () => ({ success: true })
      },
      {
        when: "RETURNING action_run_seq AS run_number",
        first: () => ({ run_number: 7 })
      },
      {
        when: "INSERT INTO action_runs",
        run: (params) => {
          insertedPrompt = String(params[15] ?? "");
          return { success: true };
        }
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () =>
          buildActionRunRow({
            id: "run-thread-resume",
            run_number: 7,
            workflow_id: "workflow-interactive",
            workflow_name: "__agent_session_internal__codex",
            trigger_event: "mention_actions",
            trigger_ref: "refs/heads/feature",
            trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            trigger_source_type: "pull_request",
            trigger_source_number: 1,
            triggered_by: "user-2",
            triggered_by_username: "bob",
            prompt: insertedPrompt || "placeholder",
            created_at: now,
            updated_at: now
          })
      },
      {
        when: "WHERE s.repository_id = ? AND s.linked_run_id = ?",
        first: () => null
      },
      {
        when: "INSERT INTO agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-thread-resume",
            source_number: 1,
            origin: "pull_request_resume",
            linked_run_id: "run-thread-resume",
            prompt: insertedPrompt || "placeholder",
            created_at: now,
            updated_at: now
          })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/resume-agent", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agentType: "codex",
          threadId: "thread-1",
          prompt: "Only address this thread."
        })
      }),
      {
        ...createBaseEnv(db),
        ACTIONS_QUEUE: {
          send: enqueueRun
        } as unknown as Queue<unknown>
      }
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      run: { id: string; run_number: number; status: string };
      session: { id: string; status: string; origin: string };
    };
    expect(body.run.id).toBe("run-thread-resume");
    expect(body.run.run_number).toBe(7);
    expect(body.run.status).toBe("queued");
    expect(body.session.id).toBe("session-thread-resume");
    expect(body.session.status).toBe("queued");
    expect(body.session.origin).toBe("pull_request_resume");
    expect(reconcileIssuesForPullRequest).toHaveBeenCalledWith({
      repository: expect.objectContaining({ id: "repo-1" }),
      pullRequestNumber: 1,
      viewerId: "user-2"
    });
    expect(enqueueRun).toHaveBeenCalledTimes(1);
    expect(insertedPrompt).toContain("[Focused Review Thread]");
    expect(insertedPrompt).toContain("location: src/app.ts:12 (head)");
    expect(insertedPrompt).toContain("Please handle null path.");
    expect(insertedPrompt).toContain("suggestion (head 12-12):");
    expect(insertedPrompt).toContain("const value = normalizePath(path);");
    expect(insertedPrompt).toContain("Only address this thread.");
  });

  it("returns pull request provenance from the latest agent session", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "owner-1",
          author_username: "alice",
          title: "Improve README",
          body: "Please update the implementation safely.",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: now,
          updated_at: now,
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "AND s.source_type = ?\n           AND s.source_number IN",
        all: () => [
          buildAgentSessionRow({
            id: "session-pr-provenance",
            source_number: 1,
            origin: "pull_request_resume",
            linked_run_id: "run-pr-provenance",
            created_at: now - 10_000,
            updated_at: now - 5_000
          })
        ]
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () =>
          buildActionRunRow({
            id: "run-pr-provenance",
            run_number: 9,
            workflow_name: "__agent_session_internal__codex",
            trigger_event: "mention_actions",
            trigger_source_type: "pull_request",
            trigger_source_number: 1,
            status: "running",
            created_at: now - 10_000,
            updated_at: now - 5_000
          })
      },
      {
        when: "FROM agent_session_artifacts",
        all: () => [
          {
            id: "artifact-pr-1",
            session_id: "session-pr-provenance",
            repository_id: "repo-1",
            kind: "stdout",
            title: "Runner stdout",
            media_type: "text/plain",
            size_bytes: 18,
            content_text: "artifact payload",
            created_at: now - 4_000,
            updated_at: now - 4_000
          }
        ]
      },
      {
        when: "FROM agent_session_usage_records",
        all: () => [
          {
            id: 1,
            session_id: "session-pr-provenance",
            repository_id: "repo-1",
            kind: "duration_ms",
            value: 900,
            unit: "ms",
            detail: "Container execution duration",
            payload_json: "{\"runId\":\"run-pr-provenance\"}",
            created_at: now - 4_000,
            updated_at: now - 4_000
          }
        ]
      },
      {
        when: "FROM agent_session_interventions",
        all: () => [
          {
            id: 2,
            session_id: "session-pr-provenance",
            repository_id: "repo-1",
            kind: "mcp_setup_warning",
            title: "MCP setup warning",
            detail: "platform MCP missing",
            created_by: null,
            created_by_username: null,
            payload_json: "{\"runId\":\"run-pr-provenance\"}",
            created_at: now - 3_000
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1/provenance"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      latestSession: {
        session: { id: string; origin: string };
        linkedRun: { id: string; status: string } | null;
        sourceContext: { type: string; number: number | null; title: string | null; url: string | null };
        artifacts: Array<{ kind: string; title: string }>;
        usageRecords: Array<{ kind: string; value: number }>;
        interventions: Array<{ kind: string; title: string }>;
        validationSummary: { status: string | null; headline: string };
      } | null;
    };
    expect(body.latestSession?.session.id).toBe("session-pr-provenance");
    expect(body.latestSession?.session.origin).toBe("pull_request_resume");
    expect(body.latestSession?.linkedRun?.id).toBe("run-pr-provenance");
    expect(body.latestSession?.linkedRun?.status).toBe("running");
    expect(body.latestSession?.sourceContext.type).toBe("pull_request");
    expect(body.latestSession?.sourceContext.number).toBe(1);
    expect(body.latestSession?.sourceContext.title).toBe("Improve README");
    expect(body.latestSession?.sourceContext.url).toBe("/repo/alice/demo/pulls/1");
    expect(body.latestSession?.artifacts[0]?.kind).toBe("stdout");
    expect(body.latestSession?.usageRecords[0]?.kind).toBe("duration_ms");
    expect(body.latestSession?.interventions[0]?.kind).toBe("mcp_setup_warning");
    expect(body.latestSession?.validationSummary.status).toBe("running");
    expect(body.latestSession?.validationSummary.headline).toBe("Validation is still running.");
  });

  it("returns latest pull request provenance in batch form for issue task views", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "AND s.source_type = ?\n           AND s.source_number IN",
        all: () => [
          buildAgentSessionRow({
            id: "session-pr-batch",
            source_number: 1,
            origin: "pull_request_resume",
            linked_run_id: "run-pr-batch",
            created_at: now - 8_000,
            updated_at: now - 4_000
          })
        ]
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () =>
          buildActionRunRow({
            id: "run-pr-batch",
            run_number: 11,
            workflow_name: "__agent_session_internal__codex",
            trigger_event: "mention_actions",
            trigger_source_type: "pull_request",
            trigger_source_number: 1,
            status: "success",
            created_at: now - 8_000,
            updated_at: now - 4_000
          })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: (params) => {
          const number = Number(params[1]);
          if (number !== 1) {
            return null;
          }
          return {
            id: "pr-1",
            repository_id: "repo-1",
            number: 1,
            author_id: "owner-1",
            author_username: "alice",
            title: "Improve README",
            body: "Please update the implementation safely.",
            state: "open",
            base_ref: "refs/heads/main",
            head_ref: "refs/heads/feature",
            base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            merge_commit_oid: null,
            created_at: now,
            updated_at: now,
            closed_at: null,
            merged_at: null
          };
        }
      },
      {
        when: "FROM agent_session_artifacts",
        all: () => [
          {
            id: "artifact-pr-batch",
            session_id: "session-pr-batch",
            repository_id: "repo-1",
            kind: "stdout",
            title: "Runner stdout",
            media_type: "text/plain",
            size_bytes: 24,
            content_text: "batch artifact payload",
            created_at: now - 3_000,
            updated_at: now - 3_000
          }
        ]
      },
      {
        when: "FROM agent_session_usage_records",
        all: () => [
          {
            id: 1,
            session_id: "session-pr-batch",
            repository_id: "repo-1",
            kind: "duration_ms",
            value: 1250,
            unit: "ms",
            detail: "Container execution duration",
            payload_json: "{\"runId\":\"run-pr-batch\"}",
            created_at: now - 3_000,
            updated_at: now - 3_000
          }
        ]
      },
      {
        when: "FROM agent_session_interventions",
        all: () => []
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/provenance/latest?numbers=1,2"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{
        sourceNumber: number;
        latestSession: {
          session: { id: string };
          linkedRun: { id: string; status: string } | null;
          sourceContext: { type: string; number: number | null; title: string | null };
          artifacts: Array<{ title: string }>;
          usageRecords: Array<{ kind: string; value: number }>;
          validationSummary: { status: string | null; headline: string };
        } | null;
      }>;
    };

    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.sourceNumber).toBe(1);
    expect(body.items[0]?.latestSession?.session.id).toBe("session-pr-batch");
    expect(body.items[0]?.latestSession?.linkedRun?.id).toBe("run-pr-batch");
    expect(body.items[0]?.latestSession?.linkedRun?.status).toBe("success");
    expect(body.items[0]?.latestSession?.sourceContext.type).toBe("pull_request");
    expect(body.items[0]?.latestSession?.sourceContext.number).toBe(1);
    expect(body.items[0]?.latestSession?.sourceContext.title).toBe("Improve README");
    expect(body.items[0]?.latestSession?.artifacts[0]?.title).toBe("Runner stdout");
    expect(body.items[0]?.latestSession?.usageRecords[0]?.value).toBe(1250);
    expect(body.items[0]?.latestSession?.validationSummary.status).toBe("success");
    expect(body.items[0]?.latestSession?.validationSummary.headline).toBe(
      "Validation passed, but no explicit test/build/lint commands were detected."
    );
    expect(body.items[1]).toEqual({
      sourceNumber: 2,
      latestSession: null
    });
  });

  it("allows marking closing issues when creating pull requests", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(RepositoryObjectClient.prototype, "listHeadRefs").mockResolvedValue([
      { name: "refs/heads/main", oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { name: "refs/heads/feature", oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    ]);
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM issues",
        all: () => [{ number: 1 }, { number: 2 }]
      },
      {
        when: "state = 'open' AND base_ref = ? AND head_ref = ?",
        first: () => null
      },
      {
        when: "RETURNING pull_number_seq AS pull_number",
        first: () => ({ pull_number: 2 })
      },
      {
        when: "INSERT INTO pull_requests",
        run: () => ({ success: true })
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-2",
          repository_id: "repo-1",
          number: 2,
          author_id: "user-2",
          author_username: "bob",
          title: "Close issues",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: Date.now(),
          updated_at: Date.now(),
          closed_at: null,
          merged_at: null
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Close issues",
          baseRef: "main",
          headRef: "feature",
          closeIssueNumbers: [1, 2]
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      closingIssueNumbers: number[];
    };
    expect(body.closingIssueNumbers).toEqual([1, 2]);
  });

  it("auto closes marked issues when pull request is merged", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    vi.spyOn(RepositoryObjectClient.prototype, "squashMergePullRequest").mockResolvedValue({
      baseOid: "cccccccccccccccccccccccccccccccccccccccc",
      headOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      mergeCommitOid: "cccccccccccccccccccccccccccccccccccccccc",
      createdCommit: true
    });
    const closedIssueNumbers: number[] = [];
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "user-2",
          author_username: "bob",
          title: "Merge this",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: Date.now(),
          updated_at: Date.now(),
          closed_at: null,
          merged_at: null
        })
      },
      {
        when: "UPDATE pull_requests",
        run: () => ({ success: true })
      },
      {
        when: "FROM pull_request_closing_issues",
        all: () => [{ issue_number: 1 }, { issue_number: 2 }]
      },
      {
        when: "FROM issues i",
        first: (params) => ({
          id: `issue-${params[1]}`,
          repository_id: "repo-1",
          number: Number(params[1]),
          author_id: "owner-1",
          author_username: "alice",
          title: `Issue ${params[1]}`,
          body: "",
          state: "open",
          created_at: Date.now(),
          updated_at: Date.now(),
          closed_at: null
        })
      },
      {
        when: "UPDATE issues",
        run: (params) => {
          const issueNumber = Number(params.at(-1));
          if (Number.isFinite(issueNumber)) {
            closedIssueNumbers.push(issueNumber);
          }
          return { success: true };
        }
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          state: "merged"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect(Array.from(new Set(closedIssueNumbers)).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("returns conflict when squash merge cannot be applied", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    vi.spyOn(RepositoryObjectClient.prototype, "squashMergePullRequest").mockRejectedValue(
      new PullRequestMergeConflictError()
    );
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "WHERE pr.repository_id = ? AND pr.number = ?",
        first: () => ({
          id: "pr-1",
          repository_id: "repo-1",
          number: 1,
          author_id: "user-2",
          author_username: "bob",
          title: "Merge this",
          body: "",
          state: "open",
          base_ref: "refs/heads/main",
          head_ref: "refs/heads/feature",
          base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          merge_commit_oid: null,
          created_at: Date.now(),
          updated_at: Date.now(),
          closed_at: null,
          merged_at: null
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/pulls/1", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          state: "merged"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toBe("Pull request has merge conflicts");
  });

  it("returns masked global actions config for authenticated users", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const db = createMockD1Database([
      {
        when: "FROM global_settings",
        all: () => [
          { key: "actions.codex.config_file_content", value: "model = \"gpt-5-codex\"", updated_at: 1 },
          {
            key: "actions.claude_code.config_file_content",
            value: "{\n  \"permissions\": \"bypass\"\n}",
            updated_at: 1
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/settings/actions", {
        method: "GET",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config: {
        codexConfigFileContent: string;
        claudeCodeConfigFileContent: string;
      };
    };
    expect(body.config.codexConfigFileContent).toContain("gpt-5-codex");
    expect(body.config.claudeCodeConfigFileContent).toContain("\"permissions\": \"bypass\"");
  });

  it("updates actions config file contents via settings API", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const settings = new Map<string, string>();
    const db = createMockD1Database([
      {
        when: "INSERT INTO global_settings",
        run: (params) => {
          settings.set(String(params[0]), String(params[1]));
          return { success: true };
        }
      },
      {
        when: "DELETE FROM global_settings",
        run: (params) => {
          settings.delete(String(params[0]));
          return { success: true };
        }
      },
      {
        when: "FROM global_settings",
        all: () =>
          Array.from(settings.entries()).map(([key, value]) => ({
            key,
            value,
            updated_at: 1
          }))
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/settings/actions", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          codexConfigFileContent: "model = \"gpt-5-codex\"\napproval_policy = \"never\"",
          claudeCodeConfigFileContent: "{\n  \"permissions\": \"bypass\"\n}"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config: { codexConfigFileContent: string; claudeCodeConfigFileContent: string };
    };
    expect(body.config.codexConfigFileContent).toContain("approval_policy");
    expect(body.config.claudeCodeConfigFileContent).toContain("\"permissions\": \"bypass\"");
    expect(settings.get("actions.codex.config_file_content")).toContain("approval_policy");
    expect(settings.get("actions.claude_code.config_file_content")).toContain("\"permissions\"");
  });

  it("returns repository actions config with global fallback for collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM repository_actions_configs",
        first: () => null
      },
      {
        when: "FROM global_settings",
        all: () => [
          {
            key: "actions.codex.config_file_content",
            value: "model = \"gpt-5-codex\"",
            updated_at: 10
          },
          {
            key: "actions.claude_code.config_file_content",
            value: "{\n  \"permissions\": \"bypass\"\n}",
            updated_at: 12
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/config", {
        method: "GET",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config: {
        instanceType: string;
        codexConfigFileContent: string;
        claudeCodeConfigFileContent: string;
        inheritsGlobalCodexConfig: boolean;
        inheritsGlobalClaudeCodeConfig: boolean;
        updated_at: number | null;
      };
    };
    expect(body.config.instanceType).toBe("lite");
    expect(body.config.codexConfigFileContent).toContain("gpt-5-codex");
    expect(body.config.claudeCodeConfigFileContent).toContain("\"permissions\": \"bypass\"");
    expect(body.config.inheritsGlobalCodexConfig).toBe(true);
    expect(body.config.inheritsGlobalClaudeCodeConfig).toBe(true);
    expect(body.config.updated_at).toBe(12);
  });

  it("updates repository actions config via repository API", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });

    let repositoryConfigRow:
      | {
          repository_id: string;
          instance_type: string | null;
          codex_config_file_content: string | null;
          claude_code_config_file_content: string | null;
          updated_at: number;
        }
      | null = null;

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM repository_actions_configs",
        first: () => repositoryConfigRow
      },
      {
        when: "INSERT INTO repository_actions_configs",
        run: (params) => {
          repositoryConfigRow = {
            repository_id: String(params[0]),
            instance_type: params[1] === null ? null : String(params[1]),
            codex_config_file_content:
              params[2] === null ? null : String(params[2]),
            claude_code_config_file_content:
              params[3] === null ? null : String(params[3]),
            updated_at: Number(params[4])
          };
          return { success: true };
        }
      },
      {
        when: "DELETE FROM repository_actions_configs",
        run: () => {
          repositoryConfigRow = null;
          return { success: true };
        }
      },
      {
        when: "FROM global_settings",
        all: () => []
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/config", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          instanceType: "standard-2",
          codexConfigFileContent: "model = \"gpt-5-codex\"\napproval_policy = \"never\"",
          claudeCodeConfigFileContent: "{\n  \"permissions\": \"bypass\"\n}"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config: {
        instanceType: string;
        codexConfigFileContent: string;
        claudeCodeConfigFileContent: string;
        inheritsGlobalCodexConfig: boolean;
        inheritsGlobalClaudeCodeConfig: boolean;
      };
    };
    expect(body.config.instanceType).toBe("standard-2");
    expect(body.config.codexConfigFileContent).toContain("approval_policy");
    expect(body.config.claudeCodeConfigFileContent).toContain("\"permissions\": \"bypass\"");
    expect(body.config.inheritsGlobalCodexConfig).toBe(false);
    expect(body.config.inheritsGlobalClaudeCodeConfig).toBe(false);
    expect(repositoryConfigRow?.instance_type).toBe("standard-2");
    expect(repositoryConfigRow?.codex_config_file_content).toContain("approval_policy");
    expect(repositoryConfigRow?.claude_code_config_file_content).toContain("\"permissions\"");
  });

  it("reconciles running action runs when container is already stopped", async () => {
    const now = Date.now();
    const fetchContainerState = vi.fn(async () =>
      new Response(JSON.stringify({ state: { status: "stopped_with_code", exitCode: 137 } }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM action_runs r",
        all: () => [
          {
            id: "run-1",
            repository_id: "repo-1",
            run_number: 1,
            workflow_id: "workflow-1",
            workflow_name: "CI",
            trigger_event: "pull_request_created",
            trigger_ref: "refs/heads/feature",
            trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            trigger_source_type: "pull_request",
            trigger_source_number: 1,
            trigger_source_comment_id: null,
            triggered_by: "owner-1",
            triggered_by_username: "alice",
            status: "running",
            agent_type: "codex",
            prompt: "run tests",
            logs: "",
            exit_code: null,
            container_instance: "action-run-run-1",
            created_at: now - 60_000,
            claimed_at: now - 50_000,
            started_at: now - 45_000,
            completed_at: null,
            updated_at: now - 30_000
        }
      ]
    },
      {
        when: "SET status = 'failed', logs = ?, exit_code = ?, completed_at = ?, updated_at = ?",
        run: () => ({
          success: true,
          meta: {
            changes: 1
          }
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/runs"),
      {
        ...createBaseEnv(db),
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: fetchContainerState
          })
        } as unknown as DurableObjectNamespace
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      runs: Array<{
        id: string;
        status: string;
        exit_code: number | null;
        logs: string;
      }>;
    };
    expect(body.runs[0]?.id).toBe("run-1");
    expect(body.runs[0]?.status).toBe("failed");
    expect(body.runs[0]?.exit_code).toBe(137);
    expect(body.runs[0]?.logs).toContain("stopped_with_code");
    expect(body.runs[0]?.logs).toContain("claimed_at:");
    expect(body.runs[0]?.logs).toContain("started_at:");
    expect(body.runs[0]?.logs).toContain("reconciled_at:");
    expect(fetchContainerState).toHaveBeenCalledTimes(1);
    expect(fetchContainerState).toHaveBeenCalledWith("https://actions-container.internal/state");
  });

  it("does not fail recently started runs while streaming logs", async () => {
    const now = Date.now();
    let readCount = 0;
    const fetchContainerState = vi.fn(async () =>
      new Response(JSON.stringify({ state: { status: "stopped_with_code", exitCode: 137 } }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () => {
          readCount += 1;
          if (readCount === 1) {
            return {
              id: "run-queued-starting",
              repository_id: "repo-1",
              run_number: 3,
              workflow_id: "workflow-1",
              workflow_name: "CI",
              trigger_event: "pull_request_created",
              trigger_ref: "refs/heads/feature",
              trigger_sha: "cccccccccccccccccccccccccccccccccccccccc",
              trigger_source_type: "pull_request",
              trigger_source_number: 3,
              trigger_source_comment_id: null,
              triggered_by: "owner-1",
              triggered_by_username: "alice",
              status: "running",
              agent_type: "codex",
              prompt: "run tests",
              logs: "",
              exit_code: null,
              container_instance: "action-run-run-queued-starting",
              created_at: now - 2_000,
              started_at: now - 500,
              completed_at: null,
              updated_at: now - 500
            };
          }
          return {
            id: "run-queued-starting",
            repository_id: "repo-1",
            run_number: 3,
            workflow_id: "workflow-1",
            workflow_name: "CI",
            trigger_event: "pull_request_created",
            trigger_ref: "refs/heads/feature",
            trigger_sha: "cccccccccccccccccccccccccccccccccccccccc",
            trigger_source_type: "pull_request",
            trigger_source_number: 3,
            trigger_source_comment_id: null,
            triggered_by: "owner-1",
            triggered_by_username: "alice",
            status: "success",
            agent_type: "codex",
            prompt: "run tests",
            logs: "line 1",
            exit_code: 0,
            container_instance: "action-run-run-queued-starting",
            created_at: now - 2_000,
            started_at: now - 500,
            completed_at: now + 600,
            updated_at: now + 600
          };
        }
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/runs/run-queued-starting/logs/stream"),
      {
        ...createBaseEnv(db),
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: fetchContainerState
          })
        } as unknown as DurableObjectNamespace
      }
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    const events = body.trim().split("\n\n");
    expect(events.some((event) => event.includes("event: snapshot"))).toBe(true);
    expect(events.some((event) => event.includes("\"status\":\"running\""))).toBe(true);
    expect(events.some((event) => event.includes("event: done"))).toBe(true);
    expect(events.some((event) => event.includes("\"status\":\"success\""))).toBe(true);
    expect(body).not.toContain("status reconciliation");
    expect(fetchContainerState).not.toHaveBeenCalled();
  });

  it("streams action run logs over SSE", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () => ({
          id: "run-1",
          repository_id: "repo-1",
          run_number: 1,
          workflow_id: "workflow-1",
          workflow_name: "CI",
          trigger_event: "pull_request_created",
          trigger_ref: "refs/heads/feature",
          trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          trigger_source_type: "pull_request",
          trigger_source_number: 1,
          trigger_source_comment_id: null,
          triggered_by: "owner-1",
          triggered_by_username: "alice",
          status: "success",
          agent_type: "codex",
          prompt: "run tests",
          logs: "line 1\nline 2",
          exit_code: 0,
          container_instance: "action-run-run-1",
          created_at: now - 1_000,
          started_at: now - 900,
          completed_at: now - 100,
          updated_at: now - 100
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/runs/run-1/logs/stream"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    const events = body.trim().split("\n\n");
    expect(events[0]).toBe("retry: 1000");
    expect(events[1]).toContain("event: snapshot");
    expect(events[1]).toContain("data: {");
    expect(events[1]).toContain("\"run\":{\"id\":\"run-1\"");
    expect(events[1]).toContain("\"logs\":\"line 1\\nline 2\"");
    expect(events[2]).toContain("event: done");
    expect(events[2]).toContain("data: {");
    expect(events[2]).toContain("\"status\":\"success\"");
  });

  it("streams append and status updates for running action runs", async () => {
    const now = Date.now();
    let readCount = 0;
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () => {
          readCount += 1;
          if (readCount === 1) {
            return {
              id: "run-2",
              repository_id: "repo-1",
              run_number: 2,
              workflow_id: "workflow-1",
              workflow_name: "CI",
              trigger_event: "pull_request_created",
              trigger_ref: "refs/heads/feature",
              trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              trigger_source_type: "pull_request",
              trigger_source_number: 2,
              trigger_source_comment_id: null,
              triggered_by: "owner-1",
              triggered_by_username: "alice",
              status: "running",
              agent_type: "codex",
              prompt: "run tests",
              logs: "",
              exit_code: null,
              container_instance: null,
              created_at: now - 2_000,
              started_at: now - 1_900,
              completed_at: null,
              updated_at: now - 1_900
            };
          }
          if (readCount === 2) {
            return {
              id: "run-2",
              repository_id: "repo-1",
              run_number: 2,
              workflow_id: "workflow-1",
              workflow_name: "CI",
              trigger_event: "pull_request_created",
              trigger_ref: "refs/heads/feature",
              trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              trigger_source_type: "pull_request",
              trigger_source_number: 2,
              trigger_source_comment_id: null,
              triggered_by: "owner-1",
              triggered_by_username: "alice",
              status: "running",
              agent_type: "codex",
              prompt: "run tests",
              logs: "line 1",
              exit_code: null,
              container_instance: null,
              created_at: now - 2_000,
              started_at: now - 1_900,
              completed_at: null,
              updated_at: now - 900
            };
          }
          return {
            id: "run-2",
            repository_id: "repo-1",
            run_number: 2,
            workflow_id: "workflow-1",
            workflow_name: "CI",
            trigger_event: "pull_request_created",
            trigger_ref: "refs/heads/feature",
            trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            trigger_source_type: "pull_request",
            trigger_source_number: 2,
            trigger_source_comment_id: null,
            triggered_by: "owner-1",
            triggered_by_username: "alice",
            status: "success",
            agent_type: "codex",
            prompt: "run tests",
            logs: "line 1",
            exit_code: 0,
            container_instance: null,
            created_at: now - 2_000,
            started_at: now - 1_900,
            completed_at: now - 100,
            updated_at: now - 100
          };
        }
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/runs/run-2/logs/stream"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    const events = body.trim().split("\n\n");
    expect(events.some((event) => event.includes("event: snapshot"))).toBe(true);
    expect(events.some((event) => event.includes("event: append"))).toBe(true);
    expect(events.some((event) => event.includes("\"chunk\":\"line 1\""))).toBe(true);
    expect(events.some((event) => event.includes("event: status"))).toBe(true);
    expect(events.some((event) => event.includes("event: done"))).toBe(true);
    expect(readCount).toBeGreaterThanOrEqual(3);
  });

  it("rejects rerunning action runs for non-collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-3",
      username: "charlie"
    });

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM repository_collaborators",
        first: () => null
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/runs/run-1/rerun", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(403);
  });

  it("allows collaborators to rerun action runs", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue("run-2");
    const enqueueRun = vi.fn(async () => undefined);
    const now = Date.now();
    const sourceRun = {
      id: "run-1",
      repository_id: "repo-1",
      run_number: 1,
      workflow_id: "workflow-1",
      workflow_name: "CI",
      trigger_event: "pull_request_created",
      trigger_ref: "refs/heads/feature",
      trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      trigger_source_type: "pull_request",
      trigger_source_number: 1,
      trigger_source_comment_id: null,
      triggered_by: "user-2",
      triggered_by_username: "bob",
      status: "failed",
      agent_type: "codex",
      prompt: "请执行测试并修复失败。",
      logs: "failed logs",
      exit_code: 1,
      container_instance: null,
      created_at: now - 10_000,
      started_at: now - 9_000,
      completed_at: now - 8_000,
      updated_at: now - 8_000
    };

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: (params) => {
          const runId = String(params[1]);
          if (runId === "run-1") {
            return sourceRun;
          }
          return {
            ...sourceRun,
            id: runId,
            run_number: 2,
            status: "queued",
            logs: "",
            exit_code: null,
            container_instance: null,
            created_at: now,
            started_at: null,
            completed_at: null,
            updated_at: now
          };
        }
      },
      {
        when: "RETURNING action_run_seq AS run_number",
        first: () => ({ run_number: 2 })
      },
      {
        when: "INSERT INTO action_runs",
        run: () => ({ success: true })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/runs/run-1/rerun", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      {
        ...createBaseEnv(db),
        ACTIONS_QUEUE: {
          send: enqueueRun
        } as unknown as Queue<unknown>
      }
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as { run: { id: string; run_number: number; status: string } };
    expect(body.run.id).toBe("run-2");
    expect(body.run.run_number).toBe(2);
    expect(body.run.status).toBe("queued");
    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });

  it("does not block reruns for delegated agent sessions", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("run-2")
      .mockReturnValueOnce("session-pending");
    const enqueueRun = vi.fn(async () => undefined);
    const now = Date.now();
    const sourceRun = buildActionRunRow({
      id: "run-1",
      status: "failed",
      logs: "failed logs",
      exit_code: 1,
      created_at: now - 10_000,
      started_at: now - 9_000,
      completed_at: now - 8_000,
      updated_at: now - 8_000
    });

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: (params) => {
          const runId = String(params[1]);
          if (runId === "run-1") {
            return sourceRun;
          }
          return buildActionRunRow({
            id: runId,
            run_number: 2,
            created_at: now,
            updated_at: now
          });
        }
      },
      {
        when: "RETURNING action_run_seq AS run_number",
        first: () => ({ run_number: 2 })
      },
      {
        when: "INSERT INTO action_runs",
        run: () => ({ success: true })
      },
      {
        when: "WHERE s.repository_id = ? AND s.linked_run_id = ?",
        first: () => null
      },
      {
        when: "INSERT INTO agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-pending",
            linked_run_id: "run-2",
            created_at: now,
            updated_at: now
          })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/runs/run-1/rerun", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      {
        ...createBaseEnv(db),
        ACTIONS_QUEUE: {
          send: enqueueRun
        } as unknown as Queue<unknown>
      }
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      run: { id: string; status: string };
      session: { id: string; status: string };
    };
    expect(body.run.id).toBe("run-2");
    expect(body.run.status).toBe("queued");
    expect(body.session.id).toBe("session-pending");
    expect(body.session.status).toBe("queued");
    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });

  it("returns agent session detail with linked run and source context", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-detail",
            source_type: "issue",
            source_number: 42,
            origin: "issue_resume",
            linked_run_id: "run-detail",
            created_at: now - 20_000,
            updated_at: now - 10_000
          })
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () =>
          buildActionRunRow({
            id: "run-detail",
            workflow_name: "Issue Bot",
            trigger_event: "issue_created",
            trigger_source_type: "issue",
            trigger_source_number: 42,
            status: "running",
            created_at: now - 20_000,
            updated_at: now - 10_000
          })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-42",
          repository_id: "repo-1",
          number: 42,
          author_id: "owner-1",
          author_username: "alice",
          title: "Need login fix",
          body: "body",
          state: "open",
          created_at: now - 40_000,
          updated_at: now - 30_000,
          closed_at: null
        })
      },
      {
        when: "FROM agent_session_artifacts",
        all: () => [
          {
            id: "artifact-1",
            session_id: "session-detail",
            repository_id: "repo-1",
            kind: "stdout",
            title: "Runner stdout",
            media_type: "text/plain",
            size_bytes: 14,
            content_text: "stdout payload",
            created_at: now - 9_000,
            updated_at: now - 9_000
          }
        ]
      },
      {
        when: "FROM agent_session_usage_records",
        all: () => [
          {
            id: 1,
            session_id: "session-detail",
            repository_id: "repo-1",
            kind: "duration_ms",
            value: 250,
            unit: "ms",
            detail: "Container execution duration",
            payload_json: "{\"runId\":\"run-detail\"}",
            created_at: now - 9_000,
            updated_at: now - 9_000
          }
        ]
      },
      {
        when: "FROM agent_session_interventions",
        all: () => [
          {
            id: 2,
            session_id: "session-detail",
            repository_id: "repo-1",
            kind: "mcp_setup_warning",
            title: "MCP setup warning",
            detail: "platform MCP missing",
            created_by: null,
            created_by_username: null,
            payload_json: "{\"runId\":\"run-detail\"}",
            created_at: now - 8_000
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-detail"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: { id: string; source_type: string; source_number: number };
      linkedRun: { id: string; workflow_name: string; status: string } | null;
      sourceContext: { type: string; number: number | null; title: string | null; url: string | null };
      artifacts: Array<{ kind: string; title: string }>;
      usageRecords: Array<{ kind: string; value: number }>;
      interventions: Array<{ kind: string; title: string }>;
    };
    expect(body.session.id).toBe("session-detail");
    expect(body.session.source_type).toBe("issue");
    expect(body.session.source_number).toBe(42);
    expect(body.linkedRun?.id).toBe("run-detail");
    expect(body.linkedRun?.workflow_name).toBe("Issue Bot");
    expect(body.linkedRun?.status).toBe("running");
    expect(body.sourceContext.type).toBe("issue");
    expect(body.sourceContext.number).toBe(42);
    expect(body.sourceContext.title).toBe("Need login fix");
    expect(body.sourceContext.url).toBe("/repo/alice/demo/issues/42");
    expect(body.artifacts[0]?.kind).toBe("stdout");
    expect(body.usageRecords[0]?.kind).toBe("duration_ms");
    expect(body.interventions[0]?.kind).toBe("mcp_setup_warning");
  });

  it("builds agent session timeline events from linked run logs", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-timeline",
            source_type: "issue",
            source_number: 7,
            origin: "issue_assign",
            status: "failed",
            linked_run_id: "run-timeline",
            created_at: now - 12_000,
            started_at: now - 10_000,
            completed_at: now - 1_000,
            updated_at: now - 1_000
          })
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () =>
          buildActionRunRow({
            id: "run-timeline",
            run_number: 9,
            workflow_name: "Issue Bot",
            trigger_event: "issue_created",
            trigger_source_type: "issue",
            trigger_source_number: 7,
            status: "failed",
            logs: `run_id: run-timeline
run_number: 9
agent_type: codex
prompt: debug

claimed_at: ${new Date(now - 11_000).toISOString()}
started_at: ${new Date(now - 10_000).toISOString()}

[stdout]
Analyzing repository
Applying fix

[stderr]
Tests still failing`,
            exit_code: 1,
            created_at: now - 12_000,
            claimed_at: now - 11_000,
            started_at: now - 10_000,
            completed_at: now - 1_000,
            updated_at: now - 1_000
          })
      },
      {
        when: "FROM agent_session_interventions",
        all: () => []
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-timeline/timeline"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: Array<{
        type: string;
        title: string;
        detail: string | null;
        stream: string | null;
      }>;
    };
    expect(body.events.some((event) => event.type === "session_created")).toBe(true);
    expect(body.events.some((event) => event.type === "run_queued")).toBe(true);
    expect(body.events.some((event) => event.type === "run_claimed")).toBe(true);
    expect(body.events.some((event) => event.type === "session_started")).toBe(true);
    expect(
      body.events.some(
        (event) => event.type === "log" && event.stream === "stdout" && event.detail === "Analyzing repository"
      )
    ).toBe(true);
    expect(
      body.events.some(
        (event) => event.type === "log" && event.stream === "stderr" && event.detail === "Tests still failing"
      )
    ).toBe(true);
    expect(
      body.events.some((event) => event.type === "session_completed" && event.title === "Session failed")
    ).toBe(true);
  });

  it("uses structured agent session steps in timeline when available", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-structured",
            source_type: "issue",
            source_number: 5,
            origin: "issue_assign",
            status: "success",
            linked_run_id: "run-structured",
            created_at: now - 12_000,
            started_at: now - 10_000,
            completed_at: now - 1_000,
            updated_at: now - 1_000
          })
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () =>
          buildActionRunRow({
            id: "run-structured",
            run_number: 11,
            workflow_name: "Issue Bot",
            trigger_event: "issue_created",
            trigger_source_type: "issue",
            trigger_source_number: 5,
            status: "success",
            logs: "[stdout]\nAnalyzing repository",
            exit_code: 0,
            created_at: now - 12_000,
            claimed_at: now - 11_000,
            started_at: now - 10_000,
            completed_at: now - 1_000,
            updated_at: now - 1_000
          })
      },
      {
        when: "FROM agent_session_steps",
        all: () => [
          {
            id: 1,
            session_id: "session-structured",
            repository_id: "repo-1",
            kind: "session_created",
            title: "Session created",
            detail: "issue #5 · issue_assign · bob",
            payload_json: "{\"status\":\"queued\"}",
            created_at: now - 12_000
          },
          {
            id: 2,
            session_id: "session-structured",
            repository_id: "repo-1",
            kind: "session_started",
            title: "Session started",
            detail: "refs/heads/agent/session-structured",
            payload_json: "{\"status\":\"running\"}",
            created_at: now - 10_000
          },
          {
            id: 3,
            session_id: "session-structured",
            repository_id: "repo-1",
            kind: "session_completed",
            title: "Session completed",
            detail: "success",
            payload_json: "{\"status\":\"success\"}",
            created_at: now - 1_000
          }
        ]
      },
      {
        when: "FROM agent_session_interventions",
        all: () => [
          {
            id: 4,
            session_id: "session-structured",
            repository_id: "repo-1",
            kind: "cancel_requested",
            title: "Cancellation requested",
            detail: "Queued session cancelled by bob.",
            created_by: "user-2",
            created_by_username: "bob",
            payload_json: "{\"status\":\"cancelled\"}",
            created_at: now - 500
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-structured/timeline"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: Array<{
        id: string;
        type: string;
        title: string;
        detail: string | null;
      }>;
    };
    expect(body.events.some((event) => event.id === "step-1" && event.type === "session_created")).toBe(
      true
    );
    expect(
      body.events.some(
        (event) =>
          event.id === "step-2" &&
          event.type === "session_started" &&
          event.detail === "refs/heads/agent/session-structured"
      )
    ).toBe(true);
    expect(
      body.events.some(
        (event) => event.id === "step-3" && event.type === "session_completed" && event.title === "Session completed"
      )
    ).toBe(true);
    expect(
      body.events.some((event) => event.type === "log" && event.detail === "Analyzing repository")
    ).toBe(true);
    expect(
      body.events.some(
        (event) => event.type === "intervention" && event.title === "Cancellation requested"
      )
    ).toBe(true);
  });

  it("cancels a queued agent session before it starts running", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    let sessionReadCount = 0;
    let runReadCount = 0;

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () => {
          sessionReadCount += 1;
          return buildAgentSessionRow({
            id: "session-cancel",
            linked_run_id: "run-2",
            status: sessionReadCount >= 2 ? "cancelled" : "queued",
            completed_at: sessionReadCount >= 2 ? Date.now() : null
          });
        }
      },
      {
        when: "WHERE r.repository_id = ? AND r.id = ?",
        first: () => {
          runReadCount += 1;
          return buildActionRunRow({
            id: "run-2",
            run_number: 2,
            status: runReadCount >= 2 ? "cancelled" : "queued",
            completed_at: runReadCount >= 2 ? Date.now() : null
          });
        }
      },
      {
        when: "SET status = 'cancelled', completed_at = ?, updated_at = ?",
        run: () => ({
          success: true,
          meta: {
            changes: 1
          }
        })
      },
      {
        when: "INSERT INTO agent_session_interventions",
        run: () => ({ success: true })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-cancel/cancel", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: { status: string };
      run: { status: string } | null;
    };
    expect(body.session.status).toBe("cancelled");
    expect(body.run?.status).toBe("cancelled");
  });

  it("allows collaborators to create actions workflows", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "INSERT INTO action_workflows",
        run: () => ({ success: true })
      },
      {
        when: "FROM action_workflows",
        first: () => ({
          id: "workflow-1",
          repository_id: "repo-1",
          name: "CI",
          trigger_event: "pull_request_created",
          agent_type: "codex",
          prompt: "请执行测试并修复失败。",
          push_branch_regex: null,
          push_tag_regex: null,
          enabled: 1,
          created_by: "user-2",
          created_at: Date.now(),
          updated_at: Date.now()
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/workflows", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "CI",
          triggerEvent: "pull_request_created",
          agentType: "codex",
          prompt: "请执行测试并修复失败。"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      workflow: { name: string; trigger_event: string; agent_type: string; prompt: string };
    };
    expect(body.workflow.name).toBe("CI");
    expect(body.workflow.trigger_event).toBe("pull_request_created");
    expect(body.workflow.agent_type).toBe("codex");
    expect(body.workflow.prompt).toBe("请执行测试并修复失败。");
  });
});
