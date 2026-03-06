import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler";
import { AuthService } from "../services/auth-service";
import {
  PullRequestMergeConflictError,
  PullRequestMergeService
} from "../services/pull-request-merge-service";
import { StorageService } from "../services/storage-service";
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
          body: "Steps to reproduce"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      issue: { number: number; title: string; state: string };
    };
    expect(body.issue.number).toBe(1);
    expect(body.issue.title).toBe("Need bugfix");
    expect(body.issue.state).toBe("open");
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
    vi.spyOn(StorageService.prototype, "readHead").mockResolvedValue("ref: refs/heads/main\n");
    vi.spyOn(StorageService.prototype, "listHeadRefs").mockResolvedValue([
      { name: "refs/heads/main", oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    ]);
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
          createdRunPrompt = String(params[14] ?? "");
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
    vi.spyOn(StorageService.prototype, "listHeadRefs").mockResolvedValue([
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

  it("lists issues for readable repositories", async () => {
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
    const body = (await response.json()) as { issues: Array<{ number: number; title: string }> };
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]?.number).toBe(1);
    expect(body.issues[0]?.title).toBe("Issue one");
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
        when: "SUM(CASE WHEN decision = 'approve'",
        first: () => ({
          approvals: 1,
          change_requests: 0,
          comments: 0
        })
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
  });

  it("allows marking closing issues when creating pull requests", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(StorageService.prototype, "listHeadRefs").mockResolvedValue([
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
    vi.spyOn(PullRequestMergeService.prototype, "squashMergePullRequest").mockResolvedValue({
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
          closedIssueNumbers.push(Number(params[4]));
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
    expect(closedIssueNumbers.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("returns conflict when squash merge cannot be applied", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    vi.spyOn(PullRequestMergeService.prototype, "squashMergePullRequest").mockRejectedValue(
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
