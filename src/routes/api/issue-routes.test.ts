import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthService
} from "../../services/auth-service";

import {
  RepositoryObjectClient
} from "../../services/repository-object";

import {
  WorkflowTaskFlowService
} from "../../services/workflow-task-flow-service";

import {
  createMockD1Database
} from "../../test-utils/mock-d1";

import {
  buildActionRunRow,
  buildAgentSessionRow,
  buildRepositoryRow,
  createApp,
  createBaseEnv
} from "./test-helpers";

describe("API issue routes", () => {
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
});
