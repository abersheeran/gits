import { RepositoryMetadataService } from "./repository-metadata-service";
import type {
  PullRequestRecord,
  PullRequestReviewDecision,
  PullRequestReviewRecord,
  PullRequestReviewThreadCommentRecord,
  PullRequestReviewThreadRecord,
  PullRequestReviewThreadSide,
  PullRequestReviewThreadSuggestionRecord,
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

type BasePullRequestReviewThreadRow = {
  id: string;
  repository_id: string;
  pull_request_id: string;
  pull_request_number: number;
  author_id: string;
  author_username: string;
  path: string;
  line: number;
  side: PullRequestReviewThreadSide;
  body: string;
  base_oid: string | null;
  head_oid: string | null;
  start_side: PullRequestReviewThreadSide | null;
  start_line: number | null;
  end_side: PullRequestReviewThreadSide | null;
  end_line: number | null;
  hunk_header: string | null;
  status: "open" | "resolved";
  resolved_by: string | null;
  resolved_by_username: string | null;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
};

type BasePullRequestReviewThreadCommentRow = {
  id: string;
  repository_id: string;
  pull_request_id: string;
  pull_request_number: number;
  thread_id: string;
  author_id: string;
  author_username: string;
  body: string;
  suggested_start_line: number | null;
  suggested_end_line: number | null;
  suggested_side: PullRequestReviewThreadSide | null;
  suggested_code: string | null;
  created_at: number;
  updated_at: number;
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
      assignees: metadata.assigneesByPullRequestId[row.id] ?? [],
      requested_reviewers: metadata.requestedReviewersByPullRequestId[row.id] ?? [],
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

  private buildPullRequestReviewThreadSuggestion(
    row: Pick<
      BasePullRequestReviewThreadCommentRow,
      "suggested_start_line" | "suggested_end_line" | "suggested_side" | "suggested_code"
    >
  ): PullRequestReviewThreadSuggestionRecord | null {
    if (
      row.suggested_start_line === null ||
      row.suggested_end_line === null ||
      row.suggested_side === null ||
      row.suggested_code === null
    ) {
      return null;
    }

    return {
      side: row.suggested_side,
      start_line: row.suggested_start_line,
      end_line: row.suggested_end_line,
      code: row.suggested_code
    };
  }

  private hydratePullRequestReviewThreadComments(
    rows: BasePullRequestReviewThreadCommentRow[]
  ): PullRequestReviewThreadCommentRecord[] {
    return rows.map((row) => ({
      id: row.id,
      repository_id: row.repository_id,
      pull_request_id: row.pull_request_id,
      pull_request_number: row.pull_request_number,
      thread_id: row.thread_id,
      author_id: row.author_id,
      author_username: row.author_username,
      body: row.body,
      suggestion: this.buildPullRequestReviewThreadSuggestion(row),
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  private buildLegacyPullRequestReviewThreadComment(
    row: BasePullRequestReviewThreadRow
  ): PullRequestReviewThreadCommentRecord {
    return {
      id: `legacy-${row.id}`,
      repository_id: row.repository_id,
      pull_request_id: row.pull_request_id,
      pull_request_number: row.pull_request_number,
      thread_id: row.id,
      author_id: row.author_id,
      author_username: row.author_username,
      body: row.body,
      suggestion: null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private hydratePullRequestReviewThreads(
    rows: BasePullRequestReviewThreadRow[],
    commentsByThreadId = new Map<string, PullRequestReviewThreadCommentRecord[]>()
  ): PullRequestReviewThreadRecord[] {
    return rows.map((row) => {
      const comments = commentsByThreadId.get(row.id);
      return {
        id: row.id,
        repository_id: row.repository_id,
        pull_request_id: row.pull_request_id,
        pull_request_number: row.pull_request_number,
        author_id: row.author_id,
        author_username: row.author_username,
        path: row.path,
        line: row.line,
        side: row.side,
        body: row.body,
        base_oid: row.base_oid,
        head_oid: row.head_oid,
        start_side: row.start_side ?? row.side,
        start_line: row.start_line ?? row.line,
        end_side: row.end_side ?? row.side,
        end_line: row.end_line ?? row.line,
        hunk_header: row.hunk_header,
        status: row.status,
        resolved_by: row.resolved_by,
        resolved_by_username: row.resolved_by_username,
        comments:
          comments && comments.length > 0
            ? comments
            : [this.buildLegacyPullRequestReviewThreadComment(row)],
        created_at: row.created_at,
        updated_at: row.updated_at,
        resolved_at: row.resolved_at
      };
    });
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
          merge_commit_oid,
          created_at,
          updated_at,
          closed_at,
          merged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          reviewer_id,
          decision,
          created_at
         FROM pull_request_reviews
         WHERE repository_id = ? AND pull_request_number = ?
         ORDER BY created_at ASC, id ASC`
      )
      .bind(repositoryId, pullRequestNumber)
      .all<Pick<BasePullRequestReviewRow, "id" | "reviewer_id" | "decision" | "created_at">>();

    const latestByReviewer = new Map<
      string,
      Pick<BasePullRequestReviewRow, "id" | "reviewer_id" | "decision" | "created_at">
    >();
    for (const row of rows.results) {
      const current = latestByReviewer.get(row.reviewer_id);
      if (
        !current ||
        row.created_at > current.created_at ||
        (row.created_at === current.created_at && row.id > current.id)
      ) {
        latestByReviewer.set(row.reviewer_id, row);
      }
    }

    let approvals = 0;
    let changeRequests = 0;
    let comments = 0;
    for (const review of latestByReviewer.values()) {
      if (review.decision === "approve") {
        approvals += 1;
      } else if (review.decision === "request_changes") {
        changeRequests += 1;
      } else {
        comments += 1;
      }
    }

    return { approvals, changeRequests, comments };
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

  private async listPullRequestReviewThreadCommentRows(
    repositoryId: string,
    pullRequestNumber: number,
    threadIds: readonly string[]
  ): Promise<BasePullRequestReviewThreadCommentRow[]> {
    if (threadIds.length === 0) {
      return [];
    }

    const placeholders = Array.from(new Set(threadIds))
      .map(() => "?")
      .join(", ");
    const rows = await this.db
      .prepare(
        `SELECT
          c.id,
          c.repository_id,
          c.pull_request_id,
          c.pull_request_number,
          c.thread_id,
          c.author_id,
          author.username AS author_username,
          c.body,
          c.suggested_start_line,
          c.suggested_end_line,
          c.suggested_side,
          c.suggested_code,
          c.created_at,
          c.updated_at
         FROM pull_request_review_thread_comments c
         JOIN users author ON author.id = c.author_id
         WHERE c.repository_id = ? AND c.pull_request_number = ? AND c.thread_id IN (${placeholders})
         ORDER BY c.created_at ASC`
      )
      .bind(repositoryId, pullRequestNumber, ...Array.from(new Set(threadIds)))
      .all<BasePullRequestReviewThreadCommentRow>();

    return rows.results;
  }

  private async loadCommentsByThreadId(
    repositoryId: string,
    pullRequestNumber: number,
    threadIds: readonly string[]
  ): Promise<Map<string, PullRequestReviewThreadCommentRecord[]>> {
    const rows = await this.listPullRequestReviewThreadCommentRows(
      repositoryId,
      pullRequestNumber,
      threadIds
    );
    const comments = this.hydratePullRequestReviewThreadComments(rows);
    const byThreadId = new Map<string, PullRequestReviewThreadCommentRecord[]>();

    for (const comment of comments) {
      const existing = byThreadId.get(comment.thread_id) ?? [];
      existing.push(comment);
      byThreadId.set(comment.thread_id, existing);
    }

    return byThreadId;
  }

  async findPullRequestReviewThreadCommentById(input: {
    repositoryId: string;
    pullRequestNumber: number;
    threadId: string;
    commentId: string;
  }): Promise<PullRequestReviewThreadCommentRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          c.id,
          c.repository_id,
          c.pull_request_id,
          c.pull_request_number,
          c.thread_id,
          c.author_id,
          author.username AS author_username,
          c.body,
          c.suggested_start_line,
          c.suggested_end_line,
          c.suggested_side,
          c.suggested_code,
          c.created_at,
          c.updated_at
         FROM pull_request_review_thread_comments c
         JOIN users author ON author.id = c.author_id
         WHERE c.repository_id = ? AND c.pull_request_number = ? AND c.thread_id = ? AND c.id = ?
         LIMIT 1`
      )
      .bind(input.repositoryId, input.pullRequestNumber, input.threadId, input.commentId)
      .first<BasePullRequestReviewThreadCommentRow>();

    if (!row) {
      return null;
    }

    const [comment] = this.hydratePullRequestReviewThreadComments([row]);
    return comment ?? null;
  }

  async listPullRequestReviewThreads(
    repositoryId: string,
    pullRequestNumber: number
  ): Promise<PullRequestReviewThreadRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          t.id,
          t.repository_id,
          t.pull_request_id,
          t.pull_request_number,
          t.author_id,
          author.username AS author_username,
          t.path,
          t.line,
          t.side,
          t.body,
          t.base_oid,
          t.head_oid,
          t.start_side,
          t.start_line,
          t.end_side,
          t.end_line,
          t.hunk_header,
          t.status,
          t.resolved_by,
          resolver.username AS resolved_by_username,
          t.created_at,
          t.updated_at,
          t.resolved_at
         FROM pull_request_review_threads t
         JOIN users author ON author.id = t.author_id
         LEFT JOIN users resolver ON resolver.id = t.resolved_by
         WHERE t.repository_id = ? AND t.pull_request_number = ?
         ORDER BY
           CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
           t.created_at ASC`
      )
      .bind(repositoryId, pullRequestNumber)
      .all<BasePullRequestReviewThreadRow>();

    const commentsByThreadId = await this.loadCommentsByThreadId(
      repositoryId,
      pullRequestNumber,
      rows.results.map((row) => row.id)
    );

    return this.hydratePullRequestReviewThreads(rows.results, commentsByThreadId);
  }

  async findPullRequestReviewThreadById(
    repositoryId: string,
    pullRequestNumber: number,
    threadId: string
  ): Promise<PullRequestReviewThreadRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          t.id,
          t.repository_id,
          t.pull_request_id,
          t.pull_request_number,
          t.author_id,
          author.username AS author_username,
          t.path,
          t.line,
          t.side,
          t.body,
          t.base_oid,
          t.head_oid,
          t.start_side,
          t.start_line,
          t.end_side,
          t.end_line,
          t.hunk_header,
          t.status,
          t.resolved_by,
          resolver.username AS resolved_by_username,
          t.created_at,
          t.updated_at,
          t.resolved_at
         FROM pull_request_review_threads t
         JOIN users author ON author.id = t.author_id
         LEFT JOIN users resolver ON resolver.id = t.resolved_by
         WHERE t.repository_id = ? AND t.pull_request_number = ? AND t.id = ?
         LIMIT 1`
      )
      .bind(repositoryId, pullRequestNumber, threadId)
      .first<BasePullRequestReviewThreadRow>();

    if (!row) {
      return null;
    }
    const commentsByThreadId = await this.loadCommentsByThreadId(repositoryId, pullRequestNumber, [row.id]);
    const [thread] = this.hydratePullRequestReviewThreads([row], commentsByThreadId);
    return thread ?? null;
  }

  async createPullRequestReviewThread(input: {
    repositoryId: string;
    pullRequestId: string;
    pullRequestNumber: number;
    authorId: string;
    path: string;
    line: number;
    side: PullRequestReviewThreadSide;
    body: string;
    baseOid?: string | null;
    headOid?: string | null;
    startSide?: PullRequestReviewThreadSide;
    startLine?: number;
    endSide?: PullRequestReviewThreadSide;
    endLine?: number;
    hunkHeader?: string | null;
    suggestion?: PullRequestReviewThreadSuggestionRecord | null;
  }): Promise<PullRequestReviewThreadRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const startSide = input.startSide ?? input.side;
    const startLine = input.startLine ?? input.line;
    const endSide = input.endSide ?? input.side;
    const endLine = input.endLine ?? input.line;
    await this.db
      .prepare(
        `INSERT INTO pull_request_review_threads (
          id,
          repository_id,
          pull_request_id,
          pull_request_number,
          author_id,
          path,
          line,
          side,
          body,
          base_oid,
          head_oid,
          start_side,
          start_line,
          end_side,
          end_line,
          hunk_header,
          status,
          resolved_by,
          created_at,
          updated_at,
          resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.repositoryId,
        input.pullRequestId,
        input.pullRequestNumber,
        input.authorId,
        input.path,
        input.line,
        input.side,
        input.body,
        input.baseOid ?? null,
        input.headOid ?? null,
        startSide,
        startLine,
        endSide,
        endLine,
        input.hunkHeader ?? null,
        null,
        now,
        now,
        null
      )
      .run();

    await this.insertPullRequestReviewThreadComment({
      repositoryId: input.repositoryId,
      pullRequestId: input.pullRequestId,
      pullRequestNumber: input.pullRequestNumber,
      threadId: id,
      authorId: input.authorId,
      body: input.body,
      suggestion: input.suggestion ?? null,
      createdAt: now,
      updatedAt: now
    });

    const created = await this.findPullRequestReviewThreadById(
      input.repositoryId,
      input.pullRequestNumber,
      id
    );
    if (!created) {
      throw new Error("Created pull request review thread not found");
    }
    return created;
  }

  private async insertPullRequestReviewThreadComment(input: {
    repositoryId: string;
    pullRequestId: string;
    pullRequestNumber: number;
    threadId: string;
    authorId: string;
    body: string;
    suggestion?: PullRequestReviewThreadSuggestionRecord | null;
    createdAt?: number;
    updatedAt?: number;
    commentId?: string;
  }): Promise<string> {
    const now = input.createdAt ?? Date.now();
    const updatedAt = input.updatedAt ?? now;
    const id = input.commentId ?? crypto.randomUUID();

    await this.db
      .prepare(
        `INSERT INTO pull_request_review_thread_comments (
          id,
          repository_id,
          pull_request_id,
          pull_request_number,
          thread_id,
          author_id,
          body,
          suggested_start_line,
          suggested_end_line,
          suggested_side,
          suggested_code,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.repositoryId,
        input.pullRequestId,
        input.pullRequestNumber,
        input.threadId,
        input.authorId,
        input.body,
        input.suggestion?.start_line ?? null,
        input.suggestion?.end_line ?? null,
        input.suggestion?.side ?? null,
        input.suggestion?.code ?? null,
        now,
        updatedAt
      )
      .run();

    await this.db
      .prepare(
        `UPDATE pull_request_review_threads
         SET updated_at = ?
         WHERE repository_id = ? AND pull_request_number = ? AND id = ?`
      )
      .bind(updatedAt, input.repositoryId, input.pullRequestNumber, input.threadId)
      .run();

    return id;
  }

  async createPullRequestReviewThreadComment(input: {
    repositoryId: string;
    pullRequestId: string;
    pullRequestNumber: number;
    threadId: string;
    authorId: string;
    body: string;
    suggestion?: PullRequestReviewThreadSuggestionRecord | null;
    createdAt?: number;
    updatedAt?: number;
  }): Promise<PullRequestReviewThreadCommentRecord> {
    const id = await this.insertPullRequestReviewThreadComment(input);

    const comment = await this.findPullRequestReviewThreadCommentById({
      repositoryId: input.repositoryId,
      pullRequestNumber: input.pullRequestNumber,
      threadId: input.threadId,
      commentId: id
    });
    if (!comment) {
      throw new Error("Created pull request review thread comment not found");
    }
    return comment;
  }

  async resolvePullRequestReviewThread(input: {
    repositoryId: string;
    pullRequestNumber: number;
    threadId: string;
    resolvedBy: string;
  }): Promise<PullRequestReviewThreadRecord | null> {
    const now = Date.now();
    await this.db
      .prepare(
        `UPDATE pull_request_review_threads
         SET status = 'resolved',
             resolved_by = ?,
             resolved_at = ?,
             updated_at = ?
         WHERE repository_id = ? AND pull_request_number = ? AND id = ?`
      )
      .bind(
        input.resolvedBy,
        now,
        now,
        input.repositoryId,
        input.pullRequestNumber,
        input.threadId
      )
      .run();

    return this.findPullRequestReviewThreadById(
      input.repositoryId,
      input.pullRequestNumber,
      input.threadId
    );
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
