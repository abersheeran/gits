import { RepositoryMetadataService } from "./repository-metadata-service";
import type {
  PullRequestRecord,
  PullRequestReviewDecision,
  PullRequestReviewRecord,
  PullRequestState
} from "../types";

export type PullRequestListState = PullRequestState | "all";

type BasePullRequestRow = {
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
  draft: number;
  milestone_id: string | null;
  merge_commit_oid: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  merged_at: number | null;
};

type BasePullRequestReviewRow = {
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

export type PaginatedPullRequestResult = {
  items: PullRequestRecord[];
  total: number;
  page: number;
  per_page: number;
  has_next_page: boolean;
};

export class DuplicateOpenPullRequestError extends Error {
  constructor() {
    super("An open pull request already exists for this head/base pair");
    this.name = "DuplicateOpenPullRequestError";
  }
}

export class PullRequestService {
  private readonly metadataService: RepositoryMetadataService;

  constructor(private readonly db: D1Database) {
    this.metadataService = new RepositoryMetadataService(db);
  }

  private normalizeIssueNumbers(numbers: number[]): number[] {
    return Array.from(new Set(numbers)).sort((a, b) => a - b);
  }

  private normalizeListInput(
    input?: number | { limit?: number; page?: number; viewerId?: string }
  ): { limit: number; page: number; offset: number; viewerId?: string } {
    const resolved =
      typeof input === "number"
        ? { limit: input }
        : (input ?? {});
    const limit = Math.min(Math.max(resolved.limit ?? 50, 1), 100);
    const page = Math.max(resolved.page ?? 1, 1);
    return {
      limit,
      page,
      offset: (page - 1) * limit,
      ...(resolved.viewerId ? { viewerId: resolved.viewerId } : {})
    };
  }

  private async hydratePullRequests(
    repositoryId: string,
    rows: BasePullRequestRow[],
    viewerId?: string
  ): Promise<PullRequestRecord[]> {
    const metadata = await this.metadataService.listPullRequestMetadata({
      repositoryId,
      pullRequestIds: rows.map((row) => row.id),
      ...(viewerId ? { viewerId } : {})
    });

    return rows.map((row) => ({
      id: row.id,
      repository_id: row.repository_id,
      number: row.number,
      author_id: row.author_id,
      author_username: row.author_username,
      title: row.title,
      body: row.body,
      state: row.state,
      draft: row.draft === 1,
      base_ref: row.base_ref,
      head_ref: row.head_ref,
      base_oid: row.base_oid,
      head_oid: row.head_oid,
      labels: metadata.labelsByPullRequestId[row.id] ?? [],
      assignees: metadata.assigneesByPullRequestId[row.id] ?? [],
      requested_reviewers: metadata.requestedReviewersByPullRequestId[row.id] ?? [],
      milestone: metadata.milestoneByPullRequestId[row.id] ?? null,
      reactions: metadata.reactionsByPullRequestId[row.id] ?? [],
      merge_commit_oid: row.merge_commit_oid,
      created_at: row.created_at,
      updated_at: row.updated_at,
      closed_at: row.closed_at,
      merged_at: row.merged_at
    }));
  }

  private async hydratePullRequestReviews(
    repositoryId: string,
    rows: BasePullRequestReviewRow[],
    viewerId?: string
  ): Promise<PullRequestReviewRecord[]> {
    const reactionsByReviewId = await this.metadataService.listPullRequestReviewReactions(
      repositoryId,
      rows.map((row) => row.id),
      viewerId
    );
    return rows.map((row) => ({
      id: row.id,
      repository_id: row.repository_id,
      pull_request_id: row.pull_request_id,
      pull_request_number: row.pull_request_number,
      reviewer_id: row.reviewer_id,
      reviewer_username: row.reviewer_username,
      decision: row.decision,
      body: row.body,
      reactions: reactionsByReviewId[row.id] ?? [],
      created_at: row.created_at
    }));
  }

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
    input?: number | { limit?: number; page?: number; viewerId?: string }
  ): Promise<PaginatedPullRequestResult> {
    const { limit, page, offset, viewerId } = this.normalizeListInput(input);

    const countRow =
      state === "all"
        ? await this.db
            .prepare(
              `SELECT COUNT(*) AS count
               FROM pull_requests
               WHERE repository_id = ?`
            )
            .bind(repositoryId)
            .first<{ count: number }>()
        : await this.db
            .prepare(
              `SELECT COUNT(*) AS count
               FROM pull_requests
               WHERE repository_id = ? AND state = ?`
            )
            .bind(repositoryId, state)
            .first<{ count: number }>();

    const rows =
      state === "all"
        ? await this.db
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
                pr.draft,
                pr.milestone_id,
                pr.merge_commit_oid,
                pr.created_at,
                pr.updated_at,
                pr.closed_at,
                pr.merged_at
               FROM pull_requests pr
               JOIN users u ON u.id = pr.author_id
               WHERE pr.repository_id = ?
               ORDER BY pr.number DESC
               LIMIT ? OFFSET ?`
            )
            .bind(repositoryId, limit, offset)
            .all<BasePullRequestRow>()
        : await this.db
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
                pr.draft,
                pr.milestone_id,
                pr.merge_commit_oid,
                pr.created_at,
                pr.updated_at,
                pr.closed_at,
                pr.merged_at
               FROM pull_requests pr
               JOIN users u ON u.id = pr.author_id
               WHERE pr.repository_id = ? AND pr.state = ?
               ORDER BY pr.number DESC
               LIMIT ? OFFSET ?`
            )
            .bind(repositoryId, state, limit, offset)
            .all<BasePullRequestRow>();

    const items = await this.hydratePullRequests(repositoryId, rows.results, viewerId);
    const total = Number(countRow?.count ?? 0);
    return {
      items,
      total,
      page,
      per_page: limit,
      has_next_page: offset + items.length < total
    };
  }

  async findPullRequestByNumber(
    repositoryId: string,
    number: number,
    viewerId?: string
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
          pr.draft,
          pr.milestone_id,
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
      .first<BasePullRequestRow>();
    if (!row) {
      return null;
    }
    const [pullRequest] = await this.hydratePullRequests(repositoryId, [row], viewerId);
    return pullRequest ?? null;
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
    draft?: boolean;
    milestoneId?: string | null;
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
          draft,
          milestone_id,
          merge_commit_oid,
          created_at,
          updated_at,
          closed_at,
          merged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        input.draft ? 1 : 0,
        input.milestoneId ?? null,
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
      baseOid?: string;
      headOid?: string;
      milestoneId?: string | null;
      draft?: boolean;
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
    if (patch.baseOid !== undefined) {
      updates.push("base_oid = ?");
      params.push(patch.baseOid);
    }
    if (patch.headOid !== undefined) {
      updates.push("head_oid = ?");
      params.push(patch.headOid);
    }
    if (patch.draft !== undefined) {
      updates.push("draft = ?");
      params.push(patch.draft ? 1 : 0);
    }
    if (patch.milestoneId !== undefined) {
      updates.push("milestone_id = ?");
      params.push(patch.milestoneId);
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
    pullRequestNumber: number,
    viewerId?: string
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
      .all<BasePullRequestReviewRow>();

    return this.hydratePullRequestReviews(repositoryId, rows.results, viewerId);
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

    const row = await this.db
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
      .first<BasePullRequestReviewRow>();

    if (!row) {
      throw new Error("Created pull request review not found");
    }
    const [created] = await this.hydratePullRequestReviews(input.repositoryId, [row]);
    if (!created) {
      throw new Error("Created pull request review not found");
    }
    return created;
  }

  async listPullRequestClosingIssueNumbers(
    repositoryId: string,
    pullRequestNumber: number
  ): Promise<number[]> {
    const rows = await this.db
      .prepare(
        `SELECT issue_number
         FROM pull_request_closing_issues
         WHERE repository_id = ? AND pull_request_number = ?
         ORDER BY issue_number ASC`
      )
      .bind(repositoryId, pullRequestNumber)
      .all<{ issue_number: number }>();

    return rows.results.map((item) => item.issue_number);
  }

  async replacePullRequestClosingIssueNumbers(input: {
    repositoryId: string;
    pullRequestId: string;
    pullRequestNumber: number;
    issueNumbers: number[];
  }): Promise<number[]> {
    await this.db
      .prepare(
        `DELETE FROM pull_request_closing_issues
         WHERE repository_id = ? AND pull_request_id = ?`
      )
      .bind(input.repositoryId, input.pullRequestId)
      .run();

    const issueNumbers = this.normalizeIssueNumbers(input.issueNumbers);
    if (issueNumbers.length === 0) {
      return [];
    }

    const now = Date.now();
    for (const issueNumber of issueNumbers) {
      await this.db
        .prepare(
          `INSERT INTO pull_request_closing_issues (
            id,
            repository_id,
            pull_request_id,
            pull_request_number,
            issue_number,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          input.repositoryId,
          input.pullRequestId,
          input.pullRequestNumber,
          issueNumber,
          now
        )
        .run();
    }

    return issueNumbers;
  }
}
