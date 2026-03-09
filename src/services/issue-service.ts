import { RepositoryMetadataService } from "./repository-metadata-service";
import type {
  IssueCommentRecord,
  IssueLinkedPullRequestRecord,
  IssueRecord,
  IssueState,
  IssueTaskStatus
} from "../types";

export type IssueListState = IssueState | "all";

type BaseIssueRow = {
  id: string;
  repository_id: string;
  number: number;
  author_id: string;
  author_username: string;
  title: string;
  body: string;
  state: IssueState;
  task_status: IssueTaskStatus;
  acceptance_criteria: string;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

type BaseIssueCommentRow = {
  id: string;
  repository_id: string;
  issue_id: string;
  issue_number: number;
  author_id: string;
  author_username: string;
  body: string;
  created_at: number;
  updated_at: number;
};

type IssueLinkedPullRequestRow = {
  id: string;
  repository_id: string;
  number: number;
  author_id: string;
  author_username: string;
  title: string;
  state: "open" | "closed" | "merged";
  draft: number;
  base_ref: string;
  head_ref: string;
  merge_commit_oid: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  merged_at: number | null;
};

export type PaginatedIssueResult = {
  items: IssueRecord[];
  total: number;
  page: number;
  per_page: number;
  has_next_page: boolean;
};

export class IssueService {
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

  private async hydrateIssues(
    repositoryId: string,
    rows: BaseIssueRow[],
    viewerId?: string
  ): Promise<IssueRecord[]> {
    const metadata = await this.metadataService.listIssueMetadata({
      repositoryId,
      issueIds: rows.map((row) => row.id),
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
      task_status: row.task_status,
      acceptance_criteria: row.acceptance_criteria,
      comment_count: metadata.commentCountByIssueId[row.id] ?? 0,
      assignees: metadata.assigneesByIssueId[row.id] ?? [],
      reactions: metadata.reactionsByIssueId[row.id] ?? [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      closed_at: row.closed_at
    }));
  }

  private async hydrateIssueComments(
    repositoryId: string,
    rows: BaseIssueCommentRow[],
    viewerId?: string
  ): Promise<IssueCommentRecord[]> {
    const reactionsByCommentId = await this.metadataService.listIssueCommentReactions(
      repositoryId,
      rows.map((row) => row.id),
      viewerId
    );
    return rows.map((row) => ({
      id: row.id,
      repository_id: row.repository_id,
      issue_id: row.issue_id,
      issue_number: row.issue_number,
      author_id: row.author_id,
      author_username: row.author_username,
      body: row.body,
      reactions: reactionsByCommentId[row.id] ?? [],
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  private async nextIssueNumber(repositoryId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO repository_counters (repository_id, issue_number_seq, pull_number_seq)
         VALUES (?, 1, 0)
         ON CONFLICT(repository_id)
         DO UPDATE SET issue_number_seq = issue_number_seq + 1
         RETURNING issue_number_seq AS issue_number`
      )
      .bind(repositoryId)
      .first<{ issue_number: number }>();

    if (!row) {
      throw new Error("Unable to allocate issue number");
    }
    return row.issue_number;
  }

  async listIssues(
    repositoryId: string,
    state: IssueListState,
    input?: number | { limit?: number; page?: number; viewerId?: string }
  ): Promise<PaginatedIssueResult> {
    const { limit, page, offset, viewerId } = this.normalizeListInput(input);

    const countRow =
      state === "all"
        ? await this.db
            .prepare(
              `SELECT COUNT(*) AS count
               FROM issues
               WHERE repository_id = ?`
            )
            .bind(repositoryId)
            .first<{ count: number }>()
        : await this.db
            .prepare(
              `SELECT COUNT(*) AS count
               FROM issues
               WHERE repository_id = ? AND state = ?`
            )
            .bind(repositoryId, state)
            .first<{ count: number }>();

    const rows =
      state === "all"
        ? await this.db
            .prepare(
              `SELECT
                i.id,
                i.repository_id,
                i.number,
                i.author_id,
                u.username AS author_username,
                i.title,
                i.body,
                i.state,
                i.task_status,
                i.acceptance_criteria,
                i.created_at,
                i.updated_at,
                i.closed_at
               FROM issues i
               JOIN users u ON u.id = i.author_id
               WHERE i.repository_id = ?
               ORDER BY i.number DESC
               LIMIT ? OFFSET ?`
            )
            .bind(repositoryId, limit, offset)
            .all<BaseIssueRow>()
        : await this.db
            .prepare(
              `SELECT
                i.id,
                i.repository_id,
                i.number,
                i.author_id,
                u.username AS author_username,
                i.title,
                i.body,
                i.state,
                i.task_status,
                i.acceptance_criteria,
                i.created_at,
                i.updated_at,
                i.closed_at
               FROM issues i
               JOIN users u ON u.id = i.author_id
               WHERE i.repository_id = ? AND i.state = ?
               ORDER BY i.number DESC
               LIMIT ? OFFSET ?`
            )
            .bind(repositoryId, state, limit, offset)
            .all<BaseIssueRow>();

    const items = await this.hydrateIssues(repositoryId, rows.results, viewerId);
    const total = Number(countRow?.count ?? 0);
    return {
      items,
      total,
      page,
      per_page: limit,
      has_next_page: offset + items.length < total
    };
  }

  async findIssueByNumber(
    repositoryId: string,
    number: number,
    viewerId?: string
  ): Promise<IssueRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          i.id,
          i.repository_id,
          i.number,
          i.author_id,
          u.username AS author_username,
          i.title,
          i.body,
          i.state,
          i.task_status,
          i.acceptance_criteria,
          i.created_at,
          i.updated_at,
          i.closed_at
         FROM issues i
         JOIN users u ON u.id = i.author_id
         WHERE i.repository_id = ? AND i.number = ?
         LIMIT 1`
      )
      .bind(repositoryId, number)
      .first<BaseIssueRow>();
    if (!row) {
      return null;
    }
    const [issue] = await this.hydrateIssues(repositoryId, [row], viewerId);
    return issue ?? null;
  }

  async listIssueComments(
    repositoryId: string,
    issueNumber: number,
    viewerId?: string
  ): Promise<IssueCommentRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          c.id,
          c.repository_id,
          c.issue_id,
          c.issue_number,
          c.author_id,
          u.username AS author_username,
          c.body,
          c.created_at,
          c.updated_at
         FROM issue_comments c
         JOIN users u ON u.id = c.author_id
         WHERE c.repository_id = ? AND c.issue_number = ?
         ORDER BY c.created_at ASC, c.id ASC`
      )
      .bind(repositoryId, issueNumber)
      .all<BaseIssueCommentRow>();
    return this.hydrateIssueComments(repositoryId, rows.results, viewerId);
  }

  async createIssue(input: {
    repositoryId: string;
    authorId: string;
    title: string;
    body?: string;
    acceptanceCriteria?: string;
  }): Promise<IssueRecord> {
    const number = await this.nextIssueNumber(input.repositoryId);
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO issues (
          id,
          repository_id,
          number,
          author_id,
          title,
          body,
          state,
          task_status,
          acceptance_criteria,
          created_at,
          updated_at,
          closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.repositoryId,
        number,
        input.authorId,
        input.title,
        input.body ?? "",
        "open",
        "open",
        input.acceptanceCriteria ?? "",
        now,
        now,
        null
      )
      .run();

    const created = await this.findIssueByNumber(input.repositoryId, number);
    if (!created) {
      throw new Error("Created issue not found");
    }
    return created;
  }

  async createIssueComment(input: {
    repositoryId: string;
    issueId: string;
    issueNumber: number;
    authorId: string;
    body: string;
  }): Promise<IssueCommentRecord> {
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO issue_comments (
          id,
          repository_id,
          issue_id,
          issue_number,
          author_id,
          body,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.repositoryId,
        input.issueId,
        input.issueNumber,
        input.authorId,
        input.body,
        now,
        now
      )
      .run();

    const row = await this.db
      .prepare(
        `SELECT
          c.id,
          c.repository_id,
          c.issue_id,
          c.issue_number,
          c.author_id,
          u.username AS author_username,
          c.body,
          c.created_at,
          c.updated_at
         FROM issue_comments c
         JOIN users u ON u.id = c.author_id
         WHERE c.id = ?
         LIMIT 1`
      )
      .bind(id)
      .first<BaseIssueCommentRow>();
    if (!row) {
      throw new Error("Created issue comment not found");
    }
    const [created] = await this.hydrateIssueComments(input.repositoryId, [row]);
    if (!created) {
      throw new Error("Created issue comment not found");
    }
    return created;
  }

  async updateIssue(
    repositoryId: string,
    number: number,
    patch: {
      title?: string;
      body?: string;
      state?: IssueState;
      taskStatus?: IssueTaskStatus;
      acceptanceCriteria?: string;
    }
  ): Promise<IssueRecord | null> {
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
      updates.push("closed_at = ?");
      params.push(patch.state === "closed" ? Date.now() : null);
      if (patch.taskStatus === undefined) {
        updates.push("task_status = ?");
        params.push(patch.state === "closed" ? "done" : "open");
      }
    }
    if (patch.taskStatus !== undefined) {
      updates.push("task_status = ?");
      params.push(patch.taskStatus);
    }
    if (patch.acceptanceCriteria !== undefined) {
      updates.push("acceptance_criteria = ?");
      params.push(patch.acceptanceCriteria);
    }
    if (updates.length === 0) {
      return this.findIssueByNumber(repositoryId, number);
    }

    updates.push("updated_at = ?");
    params.push(Date.now());

    await this.db
      .prepare(
        `UPDATE issues
         SET ${updates.join(", ")}
         WHERE repository_id = ? AND number = ?`
      )
      .bind(...params, repositoryId, number)
      .run();

    return this.findIssueByNumber(repositoryId, number);
  }

  async listLinkedPullRequestsForIssue(
    repositoryId: string,
    issueNumber: number
  ): Promise<IssueLinkedPullRequestRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          pr.id,
          pr.repository_id,
          pr.number,
          pr.author_id,
          u.username AS author_username,
          pr.title,
          pr.state,
          pr.draft,
          pr.base_ref,
          pr.head_ref,
          pr.merge_commit_oid,
          pr.created_at,
          pr.updated_at,
          pr.closed_at,
          pr.merged_at
         FROM pull_request_closing_issues pci
         JOIN pull_requests pr ON pr.id = pci.pull_request_id
         JOIN users u ON u.id = pr.author_id
         WHERE pci.repository_id = ? AND pci.issue_number = ?
         ORDER BY
           CASE pr.state
             WHEN 'open' THEN 0
             WHEN 'merged' THEN 1
             ELSE 2
           END,
           pr.updated_at DESC,
           pr.number DESC`
      )
      .bind(repositoryId, issueNumber)
      .all<IssueLinkedPullRequestRow>();

    return rows.results.map((row) => ({
      id: row.id,
      repository_id: row.repository_id,
      number: row.number,
      author_id: row.author_id,
      author_username: row.author_username,
      title: row.title,
      state: row.state,
      draft: Number(row.draft) === 1,
      base_ref: row.base_ref,
      head_ref: row.head_ref,
      merge_commit_oid: row.merge_commit_oid,
      created_at: row.created_at,
      updated_at: row.updated_at,
      closed_at: row.closed_at,
      merged_at: row.merged_at
    }));
  }

  async countOpenIssues(repositoryId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM issues
         WHERE repository_id = ? AND state = 'open'`
      )
      .bind(repositoryId)
      .first<{ count: number }>();

    return Number(row?.count ?? 0);
  }

  async listIssueNumbers(repositoryId: string, numbers: number[]): Promise<number[]> {
    const normalized = this.normalizeIssueNumbers(numbers);
    if (normalized.length === 0) {
      return [];
    }

    const rows = await this.db
      .prepare(
        `SELECT number
         FROM issues
         WHERE repository_id = ? AND number IN (${Array.from({ length: normalized.length }, () => "?").join(", ")})`
      )
      .bind(repositoryId, ...normalized)
      .all<{ number: number }>();

    return rows.results.map((item) => item.number).sort((a, b) => a - b);
  }

  async listIssuesByNumbers(
    repositoryId: string,
    numbers: number[],
    viewerId?: string
  ): Promise<IssueRecord[]> {
    const normalized = this.normalizeIssueNumbers(numbers);
    if (normalized.length === 0) {
      return [];
    }

    const rows = await this.db
      .prepare(
        `SELECT
          i.id,
          i.repository_id,
          i.number,
          i.author_id,
          u.username AS author_username,
          i.title,
          i.body,
          i.state,
          i.task_status,
          i.acceptance_criteria,
          i.created_at,
          i.updated_at,
          i.closed_at
         FROM issues i
         JOIN users u ON u.id = i.author_id
         WHERE i.repository_id = ? AND i.number IN (${Array.from(
           { length: normalized.length },
           () => "?"
         ).join(", ")})
         ORDER BY i.number ASC`
      )
      .bind(repositoryId, ...normalized)
      .all<BaseIssueRow>();

    return this.hydrateIssues(repositoryId, rows.results, viewerId);
  }

  async closeIssuesByNumbers(repositoryId: string, numbers: number[]): Promise<void> {
    const normalized = this.normalizeIssueNumbers(numbers);
    for (const issueNumber of normalized) {
      const issue = await this.findIssueByNumber(repositoryId, issueNumber);
      if (!issue || issue.state === "closed") {
        continue;
      }
      await this.updateIssue(repositoryId, issueNumber, { state: "closed" });
    }
  }
}
