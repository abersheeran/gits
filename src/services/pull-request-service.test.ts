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
});
