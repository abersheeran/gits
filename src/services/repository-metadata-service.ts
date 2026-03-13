import type { RepositoryUserSummary } from "../types";

type SubjectUserRow = RepositoryUserSummary & {
  subject_id: string;
};

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function rowsToUserMap(rows: SubjectUserRow[]): Record<string, RepositoryUserSummary[]> {
  const output: Record<string, RepositoryUserSummary[]> = {};
  for (const row of rows) {
    if (!output[row.subject_id]) {
      output[row.subject_id] = [];
    }
    output[row.subject_id]?.push({
      id: row.id,
      username: row.username
    });
  }
  return output;
}

export class RepositoryMetadataService {
  constructor(private readonly db: D1Database) {}

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
      | "issue_assignees"
      | "pull_request_assignees"
      | "pull_request_review_requests",
    subjectColumn: "issue_id" | "pull_request_id",
    subjectId: string,
    valueColumn: "user_id" | "reviewer_id",
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

  async listIssueMetadata(input: {
    repositoryId: string;
    issueIds: string[];
  }): Promise<{
    commentCountByIssueId: Record<string, number>;
    assigneesByIssueId: Record<string, RepositoryUserSummary[]>;
  }> {
    const issueIds = uniqueValues(input.issueIds);
    if (issueIds.length === 0) {
      return {
        commentCountByIssueId: {},
        assigneesByIssueId: {}
      };
    }

    const [commentRows, assigneeRows] = await Promise.all([
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
            ia.issue_id AS subject_id,
            u.id,
            u.username
           FROM issue_assignees ia
           JOIN users u ON u.id = ia.user_id
           WHERE ia.issue_id IN (${placeholders(issueIds.length)})
           ORDER BY u.username COLLATE NOCASE ASC`
        )
        .bind(...issueIds)
        .all<SubjectUserRow>()
    ]);

    const commentCountByIssueId: Record<string, number> = {};
    for (const row of commentRows.results) {
      commentCountByIssueId[row.issue_id] = Number(row.count);
    }

    return {
      commentCountByIssueId,
      assigneesByIssueId: rowsToUserMap(assigneeRows.results)
    };
  }

  async listPullRequestMetadata(input: {
    repositoryId: string;
    pullRequestIds: string[];
  }): Promise<{
    assigneesByPullRequestId: Record<string, RepositoryUserSummary[]>;
    requestedReviewersByPullRequestId: Record<string, RepositoryUserSummary[]>;
  }> {
    const pullRequestIds = uniqueValues(input.pullRequestIds);
    if (pullRequestIds.length === 0) {
      return {
        assigneesByPullRequestId: {},
        requestedReviewersByPullRequestId: {}
      };
    }

    const [assigneeRows, reviewerRows] = await Promise.all([
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
        .all<SubjectUserRow>()
    ]);

    return {
      assigneesByPullRequestId: rowsToUserMap(assigneeRows.results),
      requestedReviewersByPullRequestId: rowsToUserMap(reviewerRows.results)
    };
  }
}
