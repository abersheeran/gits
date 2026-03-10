import { describe, expect, it } from "vitest";
import { createMockD1Database } from "../test-utils/mock-d1";
import { PullRequestService } from "./pull-request-service";

describe("PullRequestService", () => {
  it("summarizes only the latest decision for each reviewer", async () => {
    const service = new PullRequestService(
      createMockD1Database([
        {
          when: "FROM pull_request_reviews",
          all: () => [
            {
              id: "review-1",
              reviewer_id: "reviewer-1",
              decision: "request_changes",
              created_at: 10
            },
            {
              id: "review-2",
              reviewer_id: "reviewer-1",
              decision: "approve",
              created_at: 20
            },
            {
              id: "review-3",
              reviewer_id: "reviewer-2",
              decision: "comment",
              created_at: 15
            }
          ]
        }
      ])
    );

    const summary = await service.summarizePullRequestReviews("repo-1", 7);

    expect(summary).toEqual({
      approvals: 1,
      changeRequests: 0,
      comments: 1
    });
  });

  it("keeps the newest reviewer decision across multiple reviewers", async () => {
    const service = new PullRequestService(
      createMockD1Database([
        {
          when: "FROM pull_request_reviews",
          all: () => [
            {
              id: "review-1",
              reviewer_id: "reviewer-1",
              decision: "comment",
              created_at: 5
            },
            {
              id: "review-2",
              reviewer_id: "reviewer-2",
              decision: "request_changes",
              created_at: 6
            },
            {
              id: "review-3",
              reviewer_id: "reviewer-1",
              decision: "approve",
              created_at: 8
            },
            {
              id: "review-4",
              reviewer_id: "reviewer-3",
              decision: "comment",
              created_at: 9
            },
            {
              id: "review-5",
              reviewer_id: "reviewer-2",
              decision: "approve",
              created_at: 11
            }
          ]
        }
      ])
    );

    const summary = await service.summarizePullRequestReviews("repo-1", 8);

    expect(summary).toEqual({
      approvals: 2,
      changeRequests: 0,
      comments: 1
    });
  });

  it("breaks timestamp ties by the newest review id", async () => {
    const service = new PullRequestService(
      createMockD1Database([
        {
          when: "FROM pull_request_reviews",
          all: () => [
            {
              id: "review-1",
              reviewer_id: "reviewer-1",
              decision: "approve",
              created_at: 10
            },
            {
              id: "review-2",
              reviewer_id: "reviewer-1",
              decision: "request_changes",
              created_at: 10
            }
          ]
        }
      ])
    );

    const summary = await service.summarizePullRequestReviews("repo-1", 9);

    expect(summary).toEqual({
      approvals: 0,
      changeRequests: 1,
      comments: 0
    });
  });

  it("includes a placeholder for hunk headers when creating review threads", async () => {
    const preparedSql: string[] = [];
    const now = Date.now();
    const db = {
      prepare(sql: string) {
        preparedSql.push(sql);
        return {
          bind(...params: unknown[]) {
            return {
              run: async () => ({ success: true, meta: { params } }),
              first: async <T>() => {
                if (sql.includes("WHERE t.repository_id = ? AND t.pull_request_number = ? AND t.id = ?")) {
                  return {
                    id: "thread-1",
                    repository_id: "repo-1",
                    pull_request_id: "pr-1",
                    pull_request_number: 1,
                    author_id: "user-1",
                    author_username: "alice",
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
                    hunk_header: "@@ -12,1 +12,1 @@",
                    status: "open",
                    resolved_by: null,
                    resolved_by_username: null,
                    created_at: now,
                    updated_at: now,
                    resolved_at: null
                  } as T;
                }
                return null;
              },
              all: async <T>() => {
                if (sql.includes("FROM pull_request_review_thread_comments c")) {
                  return {
                    results: [
                      {
                        id: "comment-1",
                        repository_id: "repo-1",
                        pull_request_id: "pr-1",
                        pull_request_number: 1,
                        thread_id: "thread-1",
                        author_id: "user-1",
                        author_username: "alice",
                        body: "Please handle null path.",
                        suggested_start_line: 12,
                        suggested_end_line: 12,
                        suggested_side: "head",
                        suggested_code: "const value = normalizePath(path);",
                        created_at: now,
                        updated_at: now
                      }
                    ] as T[]
                  };
                }
                return { results: [] as T[] };
              }
            };
          }
        };
      }
    } as unknown as D1Database;

    const service = new PullRequestService(db);

    await service.createPullRequestReviewThread({
      repositoryId: "repo-1",
      pullRequestId: "pr-1",
      pullRequestNumber: 1,
      authorId: "user-1",
      path: "src/app.ts",
      line: 12,
      side: "head",
      body: "Please handle null path.",
      baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      headOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      startSide: "head",
      startLine: 12,
      endSide: "head",
      endLine: 12,
      hunkHeader: "@@ -12,1 +12,1 @@",
      suggestion: {
        side: "head",
        start_line: 12,
        end_line: 12,
        code: "const value = normalizePath(path);"
      }
    });

    const insertSql = preparedSql.find((sql) => sql.includes("INSERT INTO pull_request_review_threads"));

    expect(insertSql).toContain(
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)"
    );
  });
});
