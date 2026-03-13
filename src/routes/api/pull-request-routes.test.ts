import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthService
} from "../../services/auth-service";

import {
  PullRequestMergeConflictError
} from "../../services/pull-request-merge-service";

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
  buildAgentSessionRow,
  buildPullRequestReviewThreadCommentRow,
  buildPullRequestReviewThreadRow,
  buildRepositoryRow,
  createApp,
  createBaseEnv
} from "./test-helpers";

describe("API pull request routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("rejects removed pull request label and milestone fields", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });

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
          headRef: "feature",
          milestoneId: "milestone-1"
        })
      }),
      createBaseEnv(createMockD1Database([]))
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Pull request labels, milestones, assignees, and reviewers have been removed; use draft state instead."
    );
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
        when: "RETURNING session_number_seq AS session_number",
        first: () => ({ session_number: 7 })
      },
      {
        when: "INSERT INTO agent_sessions",
        run: (params) => {
          insertedPrompt = String(params[10] ?? "");
          return { success: true };
        }
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-thread-resume",
            session_number: 7,
            source_number: 1,
            origin: "pull_request_resume",
            prompt: insertedPrompt || "placeholder",
            workflow_id: "workflow-interactive",
            workflow_name: "__agent_session_internal__codex",
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
      session: { id: string; session_number: number; status: string; origin: string };
    };
    expect(body.session.id).toBe("session-thread-resume");
    expect(body.session.session_number).toBe(7);
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
            status: "running",
            active_attempt_id: "attempt-pr-provenance",
            latest_attempt_id: "attempt-pr-provenance",
            created_at: now - 10_000,
            updated_at: now - 5_000
          })
        ]
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-pr-provenance",
            source_number: 1,
            origin: "pull_request_resume",
            status: "running",
            active_attempt_id: "attempt-pr-provenance",
            latest_attempt_id: "attempt-pr-provenance",
            created_at: now - 10_000,
            updated_at: now - 5_000
          })
      },
      {
        when: "FROM agent_session_attempts",
        first: () => ({
          id: "attempt-pr-provenance",
          session_id: "session-pr-provenance",
          repository_id: "repo-1",
          attempt_number: 1,
          status: "running",
          instance_type: "lite",
          promoted_from_instance_type: null,
          container_instance: "agent-session-session-pr-provenance-attempt-1",
          exit_code: null,
          failure_reason: null,
          failure_stage: null,
          created_at: now - 10_000,
          claimed_at: now - 9_500,
          started_at: now - 9_000,
          completed_at: null,
          updated_at: now - 5_000
        }),
        all: () => [
          {
            id: "attempt-pr-provenance",
            session_id: "session-pr-provenance",
            repository_id: "repo-1",
            attempt_number: 1,
            status: "running",
            instance_type: "lite",
            promoted_from_instance_type: null,
            container_instance: "agent-session-session-pr-provenance-attempt-1",
            exit_code: null,
            failure_reason: null,
            failure_stage: null,
            created_at: now - 10_000,
            claimed_at: now - 9_500,
            started_at: now - 9_000,
            completed_at: null,
            updated_at: now - 5_000
          }
        ]
      },
      {
        when: "FROM agent_session_attempt_artifacts",
        all: () => [
          {
            id: "artifact-pr-1",
            attempt_id: "attempt-pr-provenance",
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
        when: "FROM agent_session_attempt_events",
        all: () => [
          {
            id: 1,
            attempt_id: "attempt-pr-provenance",
            session_id: "session-pr-provenance",
            repository_id: "repo-1",
            type: "warning",
            stream: "system",
            message: "platform MCP missing",
            payload_json: "{\"kind\":\"mcp_setup_warning\"}",
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
        sourceContext: { type: string; number: number | null; title: string | null; url: string | null };
        attempts: Array<{ id: string; attempt_number: number }>;
        latestAttempt: { id: string; attempt_number: number } | null;
        artifacts: Array<{ kind: string; title: string }>;
        events: Array<{ type: string; message: string | null }>;
        validationSummary: { status: string | null; headline: string };
      } | null;
    };
    expect(body.latestSession?.session.id).toBe("session-pr-provenance");
    expect(body.latestSession?.session.origin).toBe("pull_request_resume");
    expect(body.latestSession?.sourceContext.type).toBe("pull_request");
    expect(body.latestSession?.sourceContext.number).toBe(1);
    expect(body.latestSession?.sourceContext.title).toBe("Improve README");
    expect(body.latestSession?.sourceContext.url).toBe("/repo/alice/demo/pulls/1");
    expect(body.latestSession?.attempts[0]?.attempt_number).toBe(1);
    expect(body.latestSession?.latestAttempt?.id).toBe("attempt-pr-provenance");
    expect(body.latestSession?.artifacts[0]?.kind).toBe("stdout");
    expect(body.latestSession?.events[0]?.type).toBe("warning");
    expect(body.latestSession?.events[0]?.message).toBe("platform MCP missing");
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
            status: "success",
            active_attempt_id: "attempt-pr-batch",
            latest_attempt_id: "attempt-pr-batch",
            created_at: now - 8_000,
            updated_at: now - 4_000
          })
        ]
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-pr-batch",
            source_number: 1,
            origin: "pull_request_resume",
            status: "success",
            active_attempt_id: "attempt-pr-batch",
            latest_attempt_id: "attempt-pr-batch",
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
        when: "FROM agent_session_attempts",
        first: () => ({
          id: "attempt-pr-batch",
          session_id: "session-pr-batch",
          repository_id: "repo-1",
          attempt_number: 1,
          status: "success",
          instance_type: "lite",
          promoted_from_instance_type: null,
          container_instance: "agent-session-session-pr-batch-attempt-1",
          exit_code: 0,
          failure_reason: null,
          failure_stage: null,
          created_at: now - 8_000,
          claimed_at: now - 7_500,
          started_at: now - 7_000,
          completed_at: now - 4_000,
          updated_at: now - 4_000
        }),
        all: () => [
          {
            id: "attempt-pr-batch",
            session_id: "session-pr-batch",
            repository_id: "repo-1",
            attempt_number: 1,
            status: "success",
            instance_type: "lite",
            promoted_from_instance_type: null,
            container_instance: "agent-session-session-pr-batch-attempt-1",
            exit_code: 0,
            failure_reason: null,
            failure_stage: null,
            created_at: now - 8_000,
            claimed_at: now - 7_500,
            started_at: now - 7_000,
            completed_at: now - 4_000,
            updated_at: now - 4_000
          }
        ]
      },
      {
        when: "FROM agent_session_attempt_artifacts",
        all: () => [
          {
            id: "artifact-pr-batch",
            attempt_id: "attempt-pr-batch",
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
        when: "FROM agent_session_attempt_events",
        all: () => [
          {
            id: 1,
            attempt_id: "attempt-pr-batch",
            session_id: "session-pr-batch",
            repository_id: "repo-1",
            type: "result_reported",
            stream: "system",
            message: "Runner reported final result.",
            payload_json:
              "{\"exitCode\":0,\"durationMs\":1250,\"stdoutChars\":24,\"stderrChars\":0}",
            created_at: now - 3_000
          }
        ]
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
          sourceContext: { type: string; number: number | null; title: string | null };
          latestAttempt: { id: string; exit_code: number | null } | null;
          artifacts: Array<{ title: string }>;
          events: Array<{ type: string }>;
          validationSummary: { status: string | null; headline: string };
        } | null;
      }>;
    };

    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.sourceNumber).toBe(1);
    expect(body.items[0]?.latestSession?.session.id).toBe("session-pr-batch");
    expect(body.items[0]?.latestSession?.sourceContext.type).toBe("pull_request");
    expect(body.items[0]?.latestSession?.sourceContext.number).toBe(1);
    expect(body.items[0]?.latestSession?.sourceContext.title).toBe("Improve README");
    expect(body.items[0]?.latestSession?.latestAttempt?.id).toBe("attempt-pr-batch");
    expect(body.items[0]?.latestSession?.latestAttempt?.exit_code).toBe(0);
    expect(body.items[0]?.latestSession?.artifacts[0]?.title).toBe("Runner stdout");
    expect(body.items[0]?.latestSession?.events[0]?.type).toBe("result_reported");
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
});
