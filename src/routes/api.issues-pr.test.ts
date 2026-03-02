import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler";
import { AuthService } from "../services/auth-service";
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
});
