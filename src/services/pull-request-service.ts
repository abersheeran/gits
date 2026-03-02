import type {
  PullRequestRecord,
  PullRequestReviewDecision,
  PullRequestReviewRecord,
  PullRequestState
} from "../types";

export type PullRequestListState = PullRequestState | "all";

export class DuplicateOpenPullRequestError extends Error {
  constructor() {
    super("An open pull request already exists for this head/base pair");
    this.name = "DuplicateOpenPullRequestError";
  }
}

export class PullRequestService {
  constructor(private readonly db: D1Database) {}

  private async nextPullRequestNumber(repositoryId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO repository_counters (repository_id, issue_number_seq, pull_number_seq)
         VALUES (?, 0, 1)
         ON CONFLICT(repository_id)
         DO UPDATE SET pull_number_seq = pull_number_seq + 1
         RETURNING pull_number_seq AS pull_number`
      )
      .bind(repositoryId)
      .first<{ pull_number: number }>();

    if (!row) {
      throw new Error("Unable to allocate pull request number");
    }
    return row.pull_number;
  }

  async listPullRequests(
    repositoryId: string,
    state: PullRequestListState,
    limit = 50
  ): Promise<PullRequestRecord[]> {
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    if (state === "all") {
      const rows = await this.db
        .prepare(
          `SELECT
            pr.id,
            pr.repository_id,
            pr.number,
            pr.author_id,
            u.username AS author_username,
            pr.title,
            pr.body,
            pr.state,
            pr.base_ref,
            pr.head_ref,
            pr.base_oid,
            pr.head_oid,
            pr.merge_commit_oid,
            pr.created_at,
            pr.updated_at,
            pr.closed_at,
            pr.merged_at
           FROM pull_requests pr
           JOIN users u ON u.id = pr.author_id
           WHERE pr.repository_id = ?
           ORDER BY pr.number DESC
           LIMIT ?`
        )
        .bind(repositoryId, normalizedLimit)
        .all<PullRequestRecord>();
      return rows.results;
    }

    const rows = await this.db
      .prepare(
        `SELECT
          pr.id,
          pr.repository_id,
          pr.number,
          pr.author_id,
          u.username AS author_username,
          pr.title,
          pr.body,
          pr.state,
          pr.base_ref,
          pr.head_ref,
          pr.base_oid,
          pr.head_oid,
          pr.merge_commit_oid,
          pr.created_at,
          pr.updated_at,
          pr.closed_at,
          pr.merged_at
         FROM pull_requests pr
         JOIN users u ON u.id = pr.author_id
         WHERE pr.repository_id = ? AND pr.state = ?
         ORDER BY pr.number DESC
         LIMIT ?`
      )
      .bind(repositoryId, state, normalizedLimit)
      .all<PullRequestRecord>();
    return rows.results;
  }

  async findPullRequestByNumber(
    repositoryId: string,
    number: number
  ): Promise<PullRequestRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          pr.id,
          pr.repository_id,
          pr.number,
          pr.author_id,
          u.username AS author_username,
          pr.title,
          pr.body,
          pr.state,
          pr.base_ref,
          pr.head_ref,
          pr.base_oid,
          pr.head_oid,
          pr.merge_commit_oid,
          pr.created_at,
          pr.updated_at,
          pr.closed_at,
          pr.merged_at
         FROM pull_requests pr
         JOIN users u ON u.id = pr.author_id
         WHERE pr.repository_id = ? AND pr.number = ?
         LIMIT 1`
      )
      .bind(repositoryId, number)
      .first<PullRequestRecord>();
    return row ?? null;
  }

  async createPullRequest(input: {
    repositoryId: string;
    authorId: string;
    title: string;
    body?: string;
    baseRef: string;
    headRef: string;
    baseOid: string;
    headOid: string;
  }): Promise<PullRequestRecord> {
    const duplicate = await this.db
      .prepare(
        `SELECT number
         FROM pull_requests
         WHERE repository_id = ? AND state = 'open' AND base_ref = ? AND head_ref = ?
         LIMIT 1`
      )
      .bind(input.repositoryId, input.baseRef, input.headRef)
      .first<{ number: number }>();
    if (duplicate) {
      throw new DuplicateOpenPullRequestError();
    }

    const number = await this.nextPullRequestNumber(input.repositoryId);
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO pull_requests (
          id,
          repository_id,
          number,
          author_id,
          title,
          body,
          state,
          base_ref,
          head_ref,
          base_oid,
          head_oid,
          merge_commit_oid,
          created_at,
          updated_at,
          closed_at,
          merged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.repositoryId,
        number,
        input.authorId,
        input.title,
        input.body ?? "",
        "open",
        input.baseRef,
        input.headRef,
        input.baseOid,
        input.headOid,
        null,
        now,
        now,
        null,
        null
      )
      .run();

    const created = await this.findPullRequestByNumber(input.repositoryId, number);
    if (!created) {
      throw new Error("Created pull request not found");
    }
    return created;
  }

  async updatePullRequest(
    repositoryId: string,
    number: number,
    patch: {
      title?: string;
      body?: string;
      state?: PullRequestState;
      mergeCommitOid?: string | null;
    }
  ): Promise<PullRequestRecord | null> {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) {
      updates.push("title = ?");
      params.push(patch.title);
    }
    if (patch.body !== undefined) {
      updates.push("body = ?");
      params.push(patch.body);
    }
    if (patch.state !== undefined) {
      updates.push("state = ?");
      params.push(patch.state);
      if (patch.state === "open") {
        updates.push("closed_at = ?");
        params.push(null);
        updates.push("merged_at = ?");
        params.push(null);
        updates.push("merge_commit_oid = ?");
        params.push(null);
      } else if (patch.state === "closed") {
        updates.push("closed_at = ?");
        params.push(Date.now());
        updates.push("merged_at = ?");
        params.push(null);
      } else {
        updates.push("closed_at = ?");
        params.push(Date.now());
        updates.push("merged_at = ?");
        params.push(Date.now());
        updates.push("merge_commit_oid = ?");
        params.push(patch.mergeCommitOid ?? null);
      }
    }
    if (updates.length === 0) {
      return this.findPullRequestByNumber(repositoryId, number);
    }

    updates.push("updated_at = ?");
    params.push(Date.now());
    await this.db
      .prepare(
        `UPDATE pull_requests
         SET ${updates.join(", ")}
         WHERE repository_id = ? AND number = ?`
      )
      .bind(...params, repositoryId, number)
      .run();

    return this.findPullRequestByNumber(repositoryId, number);
  }

  async countOpenPullRequests(repositoryId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM pull_requests
         WHERE repository_id = ? AND state = 'open'`
      )
      .bind(repositoryId)
      .first<{ count: number }>();

    return Number(row?.count ?? 0);
  }

  async listPullRequestReviews(
    repositoryId: string,
    pullRequestNumber: number
  ): Promise<PullRequestReviewRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          r.id,
          r.repository_id,
          r.pull_request_id,
          r.pull_request_number,
          r.reviewer_id,
          u.username AS reviewer_username,
          r.decision,
          r.body,
          r.created_at
         FROM pull_request_reviews r
         JOIN users u ON u.id = r.reviewer_id
         WHERE r.repository_id = ? AND r.pull_request_number = ?
         ORDER BY r.created_at ASC`
      )
      .bind(repositoryId, pullRequestNumber)
      .all<PullRequestReviewRecord>();

    return rows.results;
  }

  async summarizePullRequestReviews(repositoryId: string, pullRequestNumber: number): Promise<{
    approvals: number;
    changeRequests: number;
    comments: number;
  }> {
    const row = await this.db
      .prepare(
        `SELECT
          SUM(CASE WHEN decision = 'approve' THEN 1 ELSE 0 END) AS approvals,
          SUM(CASE WHEN decision = 'request_changes' THEN 1 ELSE 0 END) AS change_requests,
          SUM(CASE WHEN decision = 'comment' THEN 1 ELSE 0 END) AS comments
         FROM pull_request_reviews
         WHERE repository_id = ? AND pull_request_number = ?`
      )
      .bind(repositoryId, pullRequestNumber)
      .first<{ approvals: number | null; change_requests: number | null; comments: number | null }>();

    return {
      approvals: Number(row?.approvals ?? 0),
      changeRequests: Number(row?.change_requests ?? 0),
      comments: Number(row?.comments ?? 0)
    };
  }

  async createPullRequestReview(input: {
    repositoryId: string;
    pullRequestId: string;
    pullRequestNumber: number;
    reviewerId: string;
    decision: PullRequestReviewDecision;
    body?: string;
  }): Promise<PullRequestReviewRecord> {
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO pull_request_reviews (
          id,
          repository_id,
          pull_request_id,
          pull_request_number,
          reviewer_id,
          decision,
          body,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.repositoryId,
        input.pullRequestId,
        input.pullRequestNumber,
        input.reviewerId,
        input.decision,
        input.body ?? "",
        now
      )
      .run();

    const created = await this.db
      .prepare(
        `SELECT
          r.id,
          r.repository_id,
          r.pull_request_id,
          r.pull_request_number,
          r.reviewer_id,
          u.username AS reviewer_username,
          r.decision,
          r.body,
          r.created_at
         FROM pull_request_reviews r
         JOIN users u ON u.id = r.reviewer_id
         WHERE r.id = ?
         LIMIT 1`
      )
      .bind(id)
      .first<PullRequestReviewRecord>();

    if (!created) {
      throw new Error("Created pull request review not found");
    }
    return created;
  }
}
