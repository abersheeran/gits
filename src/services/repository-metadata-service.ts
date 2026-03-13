export class RepositoryMetadataService {
  constructor(private readonly db: D1Database) {}

  async listIssueMetadata(input: {
    repositoryId: string;
    issueIds: string[];
  }): Promise<{
    commentCountByIssueId: Record<string, number>;
  }> {
    const issueIds = [...new Set(input.issueIds.filter((id) => id.length > 0))];
    if (issueIds.length === 0) {
      return { commentCountByIssueId: {} };
    }

    const placeholders = issueIds.map(() => "?").join(", ");
    const commentRows = await this.db
      .prepare(
        `SELECT issue_id, COUNT(*) AS count
         FROM issue_comments
         WHERE repository_id = ? AND issue_id IN (${placeholders})
         GROUP BY issue_id`
      )
      .bind(input.repositoryId, ...issueIds)
      .all<{ issue_id: string; count: number }>();

    const commentCountByIssueId: Record<string, number> = {};
    for (const row of commentRows.results) {
      commentCountByIssueId[row.issue_id] = Number(row.count);
    }

    return { commentCountByIssueId };
  }
}
