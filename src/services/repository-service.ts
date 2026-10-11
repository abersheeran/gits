import type { RemoteRow } from "./github/types";
import type {
  CollaboratorPermission, RepositoryListRecord, RepositoryRecord
} from "../types";

export class RepositoryService {
  constructor(private readonly db: D1Database) {}

  async findMirror(repositoryId: string): Promise<RemoteRow | null> {
    return this.db.prepare("SELECT * FROM github_repositories WHERE repository_id = ?")
      .bind(repositoryId).first<RemoteRow>();
  }

  async findCollaboratorPermission(
    repositoryId: string,
    userId: string
  ): Promise<CollaboratorPermission | null> {
    const membership = await this.db
      .prepare(
        `SELECT permission
         FROM repository_collaborators
         WHERE repository_id = ? AND user_id = ?
         LIMIT 1`
      )
      .bind(repositoryId, userId)
      .first<{ permission: CollaboratorPermission }>();

    return membership?.permission ?? null;
  }

  async listPublicRepositories(limit = 50): Promise<RepositoryListRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT DISTINCT
          r.id,
          r.owner_id,
          u.username AS owner_username,
          r.name,
          r.description,
          r.is_private,
          r.created_at,
          EXISTS(SELECT 1 FROM github_repositories g WHERE g.repository_id = r.id) AS is_mirror
         FROM repositories r
         JOIN users u ON u.id = r.owner_id
         WHERE r.is_private = 0
         ORDER BY r.created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<RepositoryListRecord>();

    return rows.results;
  }

  async listRepositoriesForUser(userId: string): Promise<RepositoryListRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT DISTINCT
          r.id,
          r.owner_id,
          u.username AS owner_username,
          r.name,
          r.description,
          r.is_private,
          r.created_at,
          EXISTS(SELECT 1 FROM github_repositories g WHERE g.repository_id = r.id) AS is_mirror
         FROM repositories r
         JOIN users u ON u.id = r.owner_id
         LEFT JOIN repository_collaborators rc ON rc.repository_id = r.id
         WHERE r.owner_id = ? OR rc.user_id = ?
         ORDER BY r.created_at DESC`
      )
      .bind(userId, userId)
      .all<RepositoryListRecord>();

    return rows.results;
  }

  async createRepository(input: {
    ownerId: string;
    name: string;
    description?: string;
    isPrivate: boolean;
  }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO repositories (
          id, owner_id, name, description, is_private, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.ownerId,
        input.name,
        input.description ?? null,
        input.isPrivate ? 1 : 0,
        now
      )
      .run();

    return { id };
  }

  async findRepository(owner: string, repo: string): Promise<RepositoryRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          r.id,
          r.owner_id,
          u.username AS owner_username,
          r.name,
          r.description,
          r.is_private,
          r.created_at
         FROM repositories r
         JOIN users u ON u.id = r.owner_id
         WHERE u.username = ? AND r.name = ?
         LIMIT 1`
      )
      .bind(owner, repo)
      .first<RepositoryRecord>();

    return row ?? null;
  }

  async findViewerPermission(
    repo: RepositoryRecord,
    userId?: string
  ): Promise<"owner" | CollaboratorPermission | null> {
    if (!userId) {
      return null;
    }

    if (repo.owner_id === userId) {
      return "owner";
    }

    return this.findCollaboratorPermission(repo.id, userId);
  }

  async canReadRepository(repo: RepositoryRecord, userId?: string): Promise<boolean> {
    if (repo.is_private === 0) {
      return true;
    }

    if (!userId) {
      return false;
    }

    if (repo.owner_id === userId) {
      return true;
    }

    const permission = await this.findCollaboratorPermission(repo.id, userId);
    return permission !== null;
  }

  async canWriteRepository(repo: RepositoryRecord, userId?: string): Promise<boolean> {
    if (!userId) {
      return false;
    }

    if (repo.owner_id === userId) {
      return true;
    }

    const permission = await this.findCollaboratorPermission(repo.id, userId);
    return permission === "write" || permission === "admin";
  }

  async canAdminRepository(repo: RepositoryRecord, userId?: string): Promise<boolean> {
    if (!userId) {
      return false;
    }

    if (repo.owner_id === userId) {
      return true;
    }

    const permission = await this.findCollaboratorPermission(repo.id, userId);
    return permission === "admin";
  }

  async findUserByUsername(username: string): Promise<{ id: string; username: string } | null> {
    const row = await this.db
      .prepare(`SELECT id, username FROM users WHERE username = ? LIMIT 1`)
      .bind(username)
      .first<{ id: string; username: string }>();
    return row ?? null;
  }

  async listCollaborators(
    repositoryId: string
  ): Promise<Array<{ user_id: string; username: string; permission: string; created_at: number }>> {
    const rows = await this.db
      .prepare(
        `SELECT
          rc.user_id,
          u.username,
          rc.permission,
          rc.created_at
         FROM repository_collaborators rc
         JOIN users u ON u.id = rc.user_id
         WHERE rc.repository_id = ?
         ORDER BY rc.created_at ASC`
      )
      .bind(repositoryId)
      .all<{ user_id: string; username: string; permission: string; created_at: number }>();
    return rows.results;
  }

  async upsertCollaborator(input: {
    repositoryId: string;
    userId: string;
    permission: "read" | "write" | "admin";
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO repository_collaborators (repository_id, user_id, permission, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(repository_id, user_id) DO UPDATE SET permission = excluded.permission`
      )
      .bind(input.repositoryId, input.userId, input.permission, Date.now())
      .run();
  }

  async removeCollaborator(repositoryId: string, userId: string): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM repository_collaborators
         WHERE repository_id = ? AND user_id = ?`
      )
      .bind(repositoryId, userId)
      .run();
  }

  async updateRepository(
    repositoryId: string,
    patch: {
      name?: string;
      description?: string | null;
      isPrivate?: boolean;
    }
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      updates.push("name = ?");
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      updates.push("description = ?");
      params.push(patch.description);
    }
    if (patch.isPrivate !== undefined) {
      updates.push("is_private = ?");
      params.push(patch.isPrivate ? 1 : 0);
    }
    if (updates.length === 0) {
      return;
    }

    await this.db
      .prepare(`UPDATE repositories SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...params, repositoryId)
      .run();
  }

  async deleteRepositoryById(repositoryId: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM repositories WHERE id = ?`)
      .bind(repositoryId)
      .run();
  }
}
