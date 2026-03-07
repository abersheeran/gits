import type {
  ReactionContent,
  ReactionSubjectType,
  ReactionSummary,
  RepositoryLabelRecord,
  RepositoryMilestoneRecord,
  RepositoryUserSummary
} from "../types";

type SubjectReactionRow = {
  subject_id: string;
  content: ReactionContent;
  count: number;
  viewer_reacted: number;
};

type SubjectLabelRow = RepositoryLabelRecord & {
  subject_id: string;
};

type SubjectUserRow = RepositoryUserSummary & {
  subject_id: string;
};

type SubjectMilestoneRow = RepositoryMilestoneRecord & {
  subject_id: string;
};

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function rowsToReactionMap(rows: SubjectReactionRow[]): Record<string, ReactionSummary[]> {
  const output: Record<string, ReactionSummary[]> = {};
  for (const row of rows) {
    if (!output[row.subject_id]) {
      output[row.subject_id] = [];
    }
    const subjectReactions = output[row.subject_id];
    if (!subjectReactions) {
      continue;
    }
    subjectReactions.push({
      content: row.content,
      count: Number(row.count),
      viewer_reacted: Number(row.viewer_reacted) > 0
    });
  }
  return output;
}

function rowsToLabelMap(rows: SubjectLabelRow[]): Record<string, RepositoryLabelRecord[]> {
  const output: Record<string, RepositoryLabelRecord[]> = {};
  for (const row of rows) {
    if (!output[row.subject_id]) {
      output[row.subject_id] = [];
    }
    const subjectLabels = output[row.subject_id];
    if (!subjectLabels) {
      continue;
    }
    subjectLabels.push({
      id: row.id,
      repository_id: row.repository_id,
      name: row.name,
      color: row.color,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at
    });
  }
  return output;
}

function rowsToUserMap(rows: SubjectUserRow[]): Record<string, RepositoryUserSummary[]> {
  const output: Record<string, RepositoryUserSummary[]> = {};
  for (const row of rows) {
    if (!output[row.subject_id]) {
      output[row.subject_id] = [];
    }
    const subjectUsers = output[row.subject_id];
    if (!subjectUsers) {
      continue;
    }
    subjectUsers.push({
      id: row.id,
      username: row.username
    });
  }
  return output;
}

function rowsToMilestoneMap(
  rows: SubjectMilestoneRow[]
): Record<string, RepositoryMilestoneRecord | null> {
  const output: Record<string, RepositoryMilestoneRecord | null> = {};
  for (const row of rows) {
    output[row.subject_id] = {
      id: row.id,
      repository_id: row.repository_id,
      title: row.title,
      description: row.description,
      state: row.state,
      due_at: row.due_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      closed_at: row.closed_at
    };
  }
  return output;
}

export class RepositoryMetadataService {
  constructor(private readonly db: D1Database) {}

  async listLabels(repositoryId: string): Promise<RepositoryLabelRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          repository_id,
          name,
          color,
          description,
          created_at,
          updated_at
         FROM repository_labels
         WHERE repository_id = ?
         ORDER BY name COLLATE NOCASE ASC`
      )
      .bind(repositoryId)
      .all<RepositoryLabelRecord>();
    return rows.results;
  }

  async findLabelById(
    repositoryId: string,
    labelId: string
  ): Promise<RepositoryLabelRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          id,
          repository_id,
          name,
          color,
          description,
          created_at,
          updated_at
         FROM repository_labels
         WHERE repository_id = ? AND id = ?
         LIMIT 1`
      )
      .bind(repositoryId, labelId)
      .first<RepositoryLabelRecord>();
    return row ?? null;
  }

  async createLabel(input: {
    repositoryId: string;
    name: string;
    color: string;
    description?: string | null;
  }): Promise<RepositoryLabelRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO repository_labels (
          id,
          repository_id,
          name,
          color,
          description,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, input.repositoryId, input.name, input.color, input.description ?? null, now, now)
      .run();

    const created = await this.findLabelById(input.repositoryId, id);
    if (!created) {
      throw new Error("Created label not found");
    }
    return created;
  }

  async updateLabel(
    repositoryId: string,
    labelId: string,
    patch: {
      name?: string;
      color?: string;
      description?: string | null;
    }
  ): Promise<RepositoryLabelRecord | null> {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      updates.push("name = ?");
      params.push(patch.name);
    }
    if (patch.color !== undefined) {
      updates.push("color = ?");
      params.push(patch.color);
    }
    if (patch.description !== undefined) {
      updates.push("description = ?");
      params.push(patch.description);
    }
    if (updates.length === 0) {
      return this.findLabelById(repositoryId, labelId);
    }
    updates.push("updated_at = ?");
    params.push(Date.now());
    await this.db
      .prepare(
        `UPDATE repository_labels
         SET ${updates.join(", ")}
         WHERE repository_id = ? AND id = ?`
      )
      .bind(...params, repositoryId, labelId)
      .run();
    return this.findLabelById(repositoryId, labelId);
  }

  async deleteLabel(repositoryId: string, labelId: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM repository_labels WHERE repository_id = ? AND id = ?`)
      .bind(repositoryId, labelId)
      .run();
  }

  async listMilestones(repositoryId: string): Promise<RepositoryMilestoneRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          repository_id,
          title,
          description,
          state,
          due_at,
          created_at,
          updated_at,
          closed_at
         FROM repository_milestones
         WHERE repository_id = ?
         ORDER BY
           CASE state WHEN 'open' THEN 0 ELSE 1 END,
           updated_at DESC,
           created_at DESC`
      )
      .bind(repositoryId)
      .all<RepositoryMilestoneRecord>();
    return rows.results;
  }

  async findMilestoneById(
    repositoryId: string,
    milestoneId: string
  ): Promise<RepositoryMilestoneRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          id,
          repository_id,
          title,
          description,
          state,
          due_at,
          created_at,
          updated_at,
          closed_at
         FROM repository_milestones
         WHERE repository_id = ? AND id = ?
         LIMIT 1`
      )
      .bind(repositoryId, milestoneId)
      .first<RepositoryMilestoneRecord>();
    return row ?? null;
  }

  async createMilestone(input: {
    repositoryId: string;
    title: string;
    description?: string;
    dueAt?: number | null;
  }): Promise<RepositoryMilestoneRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO repository_milestones (
          id,
          repository_id,
          title,
          description,
          state,
          due_at,
          created_at,
          updated_at,
          closed_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, NULL)`
      )
      .bind(id, input.repositoryId, input.title, input.description ?? "", input.dueAt ?? null, now, now)
      .run();
    const created = await this.findMilestoneById(input.repositoryId, id);
    if (!created) {
      throw new Error("Created milestone not found");
    }
    return created;
  }

  async updateMilestone(
    repositoryId: string,
    milestoneId: string,
    patch: {
      title?: string;
      description?: string;
      dueAt?: number | null;
      state?: "open" | "closed";
    }
  ): Promise<RepositoryMilestoneRecord | null> {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) {
      updates.push("title = ?");
      params.push(patch.title);
    }
    if (patch.description !== undefined) {
      updates.push("description = ?");
      params.push(patch.description);
    }
    if (patch.dueAt !== undefined) {
      updates.push("due_at = ?");
      params.push(patch.dueAt);
    }
    if (patch.state !== undefined) {
      updates.push("state = ?");
      params.push(patch.state);
      updates.push("closed_at = ?");
      params.push(patch.state === "closed" ? Date.now() : null);
    }
    if (updates.length === 0) {
      return this.findMilestoneById(repositoryId, milestoneId);
    }
    updates.push("updated_at = ?");
    params.push(Date.now());
    await this.db
      .prepare(
        `UPDATE repository_milestones
         SET ${updates.join(", ")}
         WHERE repository_id = ? AND id = ?`
      )
      .bind(...params, repositoryId, milestoneId)
      .run();
    return this.findMilestoneById(repositoryId, milestoneId);
  }

  async deleteMilestone(repositoryId: string, milestoneId: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM repository_milestones WHERE repository_id = ? AND id = ?`)
      .bind(repositoryId, milestoneId)
      .run();
  }

  async replaceIssueLabels(issueId: string, labelIds: string[]): Promise<void> {
    await this.replaceMapping("issue_labels", "issue_id", issueId, "label_id", labelIds);
  }

  async replacePullRequestLabels(pullRequestId: string, labelIds: string[]): Promise<void> {
    await this.replaceMapping(
      "pull_request_labels",
      "pull_request_id",
      pullRequestId,
      "label_id",
      labelIds
    );
  }

  async replaceIssueAssignees(issueId: string, userIds: string[]): Promise<void> {
    await this.replaceMapping("issue_assignees", "issue_id", issueId, "user_id", userIds);
  }

  async replacePullRequestAssignees(
    pullRequestId: string,
    userIds: string[]
  ): Promise<void> {
    await this.replaceMapping(
      "pull_request_assignees",
      "pull_request_id",
      pullRequestId,
      "user_id",
      userIds
    );
  }

  async replacePullRequestReviewRequests(
    pullRequestId: string,
    reviewerIds: string[]
  ): Promise<void> {
    await this.replaceMapping(
      "pull_request_review_requests",
      "pull_request_id",
      pullRequestId,
      "reviewer_id",
      reviewerIds
    );
  }

  private async replaceMapping(
    tableName:
      | "issue_labels"
      | "pull_request_labels"
      | "issue_assignees"
      | "pull_request_assignees"
      | "pull_request_review_requests",
    subjectColumn: "issue_id" | "pull_request_id",
    subjectId: string,
    valueColumn: "label_id" | "user_id" | "reviewer_id",
    values: string[]
  ): Promise<void> {
    const nextValues = uniqueValues(values);
    await this.db
      .prepare(`DELETE FROM ${tableName} WHERE ${subjectColumn} = ?`)
      .bind(subjectId)
      .run();

    const now = Date.now();
    for (const value of nextValues) {
      await this.db
        .prepare(
          `INSERT INTO ${tableName} (${subjectColumn}, ${valueColumn}, created_at)
           VALUES (?, ?, ?)`
        )
        .bind(subjectId, value, now)
        .run();
    }
  }

  async summarizeReactions(
    repositoryId: string,
    subjectType: ReactionSubjectType,
    subjectIds: string[],
    viewerId?: string
  ): Promise<Record<string, ReactionSummary[]>> {
    const nextSubjectIds = uniqueValues(subjectIds);
    if (nextSubjectIds.length === 0) {
      return {};
    }
    const rows = await this.db
      .prepare(
        `SELECT
          subject_id,
          content,
          COUNT(*) AS count,
          MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS viewer_reacted
         FROM reactions
         WHERE repository_id = ?
           AND subject_type = ?
           AND subject_id IN (${placeholders(nextSubjectIds.length)})
         GROUP BY subject_id, content
         ORDER BY subject_id ASC, content ASC`
      )
      .bind(viewerId ?? "", repositoryId, subjectType, ...nextSubjectIds)
      .all<SubjectReactionRow>();
    return rowsToReactionMap(rows.results);
  }

  async addReaction(input: {
    repositoryId: string;
    subjectType: ReactionSubjectType;
    subjectId: string;
    userId: string;
    content: ReactionContent;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO reactions (
          id,
          repository_id,
          subject_type,
          subject_id,
          user_id,
          content,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.repositoryId,
        input.subjectType,
        input.subjectId,
        input.userId,
        input.content,
        Date.now()
      )
      .run();
  }

  async removeReaction(input: {
    repositoryId: string;
    subjectType: ReactionSubjectType;
    subjectId: string;
    userId: string;
    content: ReactionContent;
  }): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM reactions
         WHERE repository_id = ?
           AND subject_type = ?
           AND subject_id = ?
           AND user_id = ?
           AND content = ?`
      )
      .bind(
        input.repositoryId,
        input.subjectType,
        input.subjectId,
        input.userId,
        input.content
      )
      .run();
  }

  async listIssueMetadata(input: {
    repositoryId: string;
    issueIds: string[];
    viewerId?: string;
  }): Promise<{
    commentCountByIssueId: Record<string, number>;
    labelsByIssueId: Record<string, RepositoryLabelRecord[]>;
    assigneesByIssueId: Record<string, RepositoryUserSummary[]>;
    milestoneByIssueId: Record<string, RepositoryMilestoneRecord | null>;
    reactionsByIssueId: Record<string, ReactionSummary[]>;
  }> {
    const issueIds = uniqueValues(input.issueIds);
    if (issueIds.length === 0) {
      return {
        commentCountByIssueId: {},
        labelsByIssueId: {},
        assigneesByIssueId: {},
        milestoneByIssueId: {},
        reactionsByIssueId: {}
      };
    }

    const [commentRows, labelRows, assigneeRows, milestoneRows, reactionsByIssueId] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT issue_id, COUNT(*) AS count
             FROM issue_comments
             WHERE repository_id = ? AND issue_id IN (${placeholders(issueIds.length)})
             GROUP BY issue_id`
          )
          .bind(input.repositoryId, ...issueIds)
          .all<{ issue_id: string; count: number }>(),
        this.db
          .prepare(
            `SELECT
              il.issue_id AS subject_id,
              l.id,
              l.repository_id,
              l.name,
              l.color,
              l.description,
              l.created_at,
              l.updated_at
             FROM issue_labels il
             JOIN repository_labels l ON l.id = il.label_id
             WHERE il.issue_id IN (${placeholders(issueIds.length)})
             ORDER BY l.name COLLATE NOCASE ASC`
          )
          .bind(...issueIds)
          .all<SubjectLabelRow>(),
        this.db
          .prepare(
            `SELECT
              ia.issue_id AS subject_id,
              u.id,
              u.username
             FROM issue_assignees ia
             JOIN users u ON u.id = ia.user_id
             WHERE ia.issue_id IN (${placeholders(issueIds.length)})
             ORDER BY u.username COLLATE NOCASE ASC`
          )
          .bind(...issueIds)
          .all<SubjectUserRow>(),
        this.db
          .prepare(
            `SELECT
              i.id AS subject_id,
              m.id,
              m.repository_id,
              m.title,
              m.description,
              m.state,
              m.due_at,
              m.created_at,
              m.updated_at,
              m.closed_at
             FROM issues i
             JOIN repository_milestones m ON m.id = i.milestone_id
             WHERE i.repository_id = ? AND i.id IN (${placeholders(issueIds.length)})`
          )
          .bind(input.repositoryId, ...issueIds)
          .all<SubjectMilestoneRow>(),
        this.summarizeReactions(input.repositoryId, "issue", issueIds, input.viewerId)
      ]);

    const commentCountByIssueId: Record<string, number> = {};
    for (const row of commentRows.results) {
      commentCountByIssueId[row.issue_id] = Number(row.count);
    }

    return {
      commentCountByIssueId,
      labelsByIssueId: rowsToLabelMap(labelRows.results),
      assigneesByIssueId: rowsToUserMap(assigneeRows.results),
      milestoneByIssueId: rowsToMilestoneMap(milestoneRows.results),
      reactionsByIssueId
    };
  }

  async listPullRequestMetadata(input: {
    repositoryId: string;
    pullRequestIds: string[];
    viewerId?: string;
  }): Promise<{
    labelsByPullRequestId: Record<string, RepositoryLabelRecord[]>;
    assigneesByPullRequestId: Record<string, RepositoryUserSummary[]>;
    requestedReviewersByPullRequestId: Record<string, RepositoryUserSummary[]>;
    milestoneByPullRequestId: Record<string, RepositoryMilestoneRecord | null>;
    reactionsByPullRequestId: Record<string, ReactionSummary[]>;
  }> {
    const pullRequestIds = uniqueValues(input.pullRequestIds);
    if (pullRequestIds.length === 0) {
      return {
        labelsByPullRequestId: {},
        assigneesByPullRequestId: {},
        requestedReviewersByPullRequestId: {},
        milestoneByPullRequestId: {},
        reactionsByPullRequestId: {}
      };
    }

    const [labelRows, assigneeRows, reviewerRows, milestoneRows, reactionsByPullRequestId] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT
              pl.pull_request_id AS subject_id,
              l.id,
              l.repository_id,
              l.name,
              l.color,
              l.description,
              l.created_at,
              l.updated_at
             FROM pull_request_labels pl
             JOIN repository_labels l ON l.id = pl.label_id
             WHERE pl.pull_request_id IN (${placeholders(pullRequestIds.length)})
             ORDER BY l.name COLLATE NOCASE ASC`
          )
          .bind(...pullRequestIds)
          .all<SubjectLabelRow>(),
        this.db
          .prepare(
            `SELECT
              pa.pull_request_id AS subject_id,
              u.id,
              u.username
             FROM pull_request_assignees pa
             JOIN users u ON u.id = pa.user_id
             WHERE pa.pull_request_id IN (${placeholders(pullRequestIds.length)})
             ORDER BY u.username COLLATE NOCASE ASC`
          )
          .bind(...pullRequestIds)
          .all<SubjectUserRow>(),
        this.db
          .prepare(
            `SELECT
              prr.pull_request_id AS subject_id,
              u.id,
              u.username
             FROM pull_request_review_requests prr
             JOIN users u ON u.id = prr.reviewer_id
             WHERE prr.pull_request_id IN (${placeholders(pullRequestIds.length)})
             ORDER BY u.username COLLATE NOCASE ASC`
          )
          .bind(...pullRequestIds)
          .all<SubjectUserRow>(),
        this.db
          .prepare(
            `SELECT
              pr.id AS subject_id,
              m.id,
              m.repository_id,
              m.title,
              m.description,
              m.state,
              m.due_at,
              m.created_at,
              m.updated_at,
              m.closed_at
             FROM pull_requests pr
             JOIN repository_milestones m ON m.id = pr.milestone_id
             WHERE pr.repository_id = ? AND pr.id IN (${placeholders(pullRequestIds.length)})`
          )
          .bind(input.repositoryId, ...pullRequestIds)
          .all<SubjectMilestoneRow>(),
        this.summarizeReactions(input.repositoryId, "pull_request", pullRequestIds, input.viewerId)
      ]);

    return {
      labelsByPullRequestId: rowsToLabelMap(labelRows.results),
      assigneesByPullRequestId: rowsToUserMap(assigneeRows.results),
      requestedReviewersByPullRequestId: rowsToUserMap(reviewerRows.results),
      milestoneByPullRequestId: rowsToMilestoneMap(milestoneRows.results),
      reactionsByPullRequestId
    };
  }

  async listIssueCommentReactions(
    repositoryId: string,
    commentIds: string[],
    viewerId?: string
  ): Promise<Record<string, ReactionSummary[]>> {
    return this.summarizeReactions(repositoryId, "issue_comment", commentIds, viewerId);
  }

  async listPullRequestReviewReactions(
    repositoryId: string,
    reviewIds: string[],
    viewerId?: string
  ): Promise<Record<string, ReactionSummary[]>> {
    return this.summarizeReactions(repositoryId, "pull_request_review", reviewIds, viewerId);
  }
}
