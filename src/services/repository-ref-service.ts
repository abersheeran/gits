export type RepositoryRef = {
  repository_id: string;
  ref_name: string;
  oid: string;
  is_default: number;
  updated_at: number;
};

export class RepositoryRefService {
  constructor(private readonly db: D1Database) {}

  /**
   * Full sync: upsert all given refs and delete stale ones.
   * Called after push, branch create/delete, set-default-branch, init.
   * `defaultBranch` is the full ref like "refs/heads/main" or null.
   */
  async syncRefs(
    repositoryId: string,
    refs: { name: string; oid: string }[],
    defaultBranch: string | null
  ): Promise<void> {
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];

    statements.push(
      this.db.prepare("DELETE FROM repository_refs WHERE repository_id = ?").bind(repositoryId)
    );

    for (const ref of refs) {
      const isDefault = ref.name === defaultBranch ? 1 : 0;
      statements.push(
        this.db
          .prepare(
            "INSERT INTO repository_refs (repository_id, ref_name, oid, is_default, updated_at) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(repositoryId, ref.name, ref.oid, isDefault, now)
      );
    }

    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  /**
   * List all head refs for a repository (from D1 cache).
   */
  async listHeadRefs(repositoryId: string): Promise<{ name: string; oid: string }[]> {
    const result = await this.db
      .prepare("SELECT ref_name, oid FROM repository_refs WHERE repository_id = ? ORDER BY ref_name")
      .bind(repositoryId)
      .all<{ ref_name: string; oid: string }>();

    return (result.results ?? []).map((row) => ({ name: row.ref_name, oid: row.oid }));
  }

  /**
   * Resolve the default branch target (ref + sha) from D1 cache.
   * Returns { ref: null, sha: null } if no default branch is set.
   */
  async resolveDefaultBranchTarget(
    repositoryId: string
  ): Promise<{ ref: string | null; sha: string | null }> {
    const row = await this.db
      .prepare(
        "SELECT ref_name, oid FROM repository_refs WHERE repository_id = ? AND is_default = 1 LIMIT 1"
      )
      .bind(repositoryId)
      .first<{ ref_name: string; oid: string }>();

    if (!row) {
      return { ref: null, sha: null };
    }

    return { ref: row.ref_name, sha: row.oid };
  }

  /**
   * Delete all refs for a repository (used when deleting a repo).
   */
  async deleteAllRefs(repositoryId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM repository_refs WHERE repository_id = ?")
      .bind(repositoryId)
      .run();
  }
}
