import type { IssueCommentRecord, IssueRecord, IssueState } from "../types";

export type IssueListState = IssueState | "all";

export class IssueService {
  constructor(private readonly db: D1Database) {}

  private normalizeIssueNumbers(numbers: number[]): number[] {
    return Array.from(new Set(numbers)).sort((a, b) => a - b);
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
    limit = 50
  ): Promise<IssueRecord[]> {
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    if (state === "all") {
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
            i.created_at,
            i.updated_at,
            i.closed_at
           FROM issues i
           JOIN users u ON u.id = i.author_id
           WHERE i.repository_id = ?
           ORDER BY i.number DESC
           LIMIT ?`
        )
        .bind(repositoryId, normalizedLimit)
        .all<IssueRecord>();
      return rows.results;
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
          i.created_at,
          i.updated_at,
          i.closed_at
         FROM issues i
         JOIN users u ON u.id = i.author_id
         WHERE i.repository_id = ? AND i.state = ?
         ORDER BY i.number DESC
         LIMIT ?`
      )
      .bind(repositoryId, state, normalizedLimit)
      .all<IssueRecord>();
    return rows.results;
  }

  async findIssueByNumber(repositoryId: string, number: number): Promise<IssueRecord | null> {
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
          i.created_at,
          i.updated_at,
          i.closed_at
         FROM issues i
         JOIN users u ON u.id = i.author_id
         WHERE i.repository_id = ? AND i.number = ?
         LIMIT 1`
      )
      .bind(repositoryId, number)
      .first<IssueRecord>();
    return row ?? null;
  }

  async listIssueComments(repositoryId: string, issueNumber: number): Promise<IssueCommentRecord[]> {
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
      .all<IssueCommentRecord>();
    return rows.results;
  }

  async createIssue(input: {
    repositoryId: string;
    authorId: string;
    title: string;
    body?: string;
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
          created_at,
          updated_at,
          closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.repositoryId,
        number,
        input.authorId,
        input.title,
        input.body ?? "",
        "open",
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

    const created = await this.db
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
      .first<IssueCommentRecord>();
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

    const placeholders = normalized.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `SELECT number
         FROM issues
         WHERE repository_id = ? AND number IN (${placeholders})`
      )
      .bind(repositoryId, ...normalized)
      .all<{ number: number }>();

    return rows.results.map((item) => item.number).sort((a, b) => a - b);
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
