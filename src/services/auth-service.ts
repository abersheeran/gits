import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { AccessTokenContext, AuthUser } from "../types";

export const ACTIONS_SYSTEM_USER_ID = "actions-system-user";
export const ACTIONS_SYSTEM_USERNAME = "actions";
export const ACTIONS_SYSTEM_EMAIL = "actions@system.local";

type UserRow = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
};

type AccessTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  token_prefix: string;
  is_internal: number;
  display_as_actions: number;
  revoked_at: number | null;
  expires_at: number | null;
  username: string;
};

export type AccessTokenMetadata = {
  id: string;
  token_prefix: string;
  name: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
};

export class AuthService {
  constructor(
    private readonly db: D1Database,
    private readonly jwtSecret: string
  ) {}

  private get jwtSecretKey(): Uint8Array {
    return new TextEncoder().encode(this.jwtSecret);
  }

  private static readonly ACTIONS_PASSWORD_HASH = "!";

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async createUser(input: {
    username: string;
    email: string;
    password: string;
  }): Promise<AuthUser> {
    const id = crypto.randomUUID();
    const passwordHash = await this.hashPassword(input.password);
    const createdAt = Date.now();

    await this.db
      .prepare(
        `INSERT INTO users (id, username, email, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, input.username, input.email, passwordHash, createdAt)
      .run();

    return {
      id,
      username: input.username
    };
  }

  async verifyUserCredentials(
    usernameOrEmail: string,
    password: string
  ): Promise<AuthUser | null> {
    const normalizedInput = usernameOrEmail.trim();
    const lowerInput = normalizedInput.toLowerCase();
    const row = await this.db
      .prepare(
        `SELECT id, username, email, password_hash
         FROM users
         WHERE username = ? OR lower(email) = ?
         LIMIT 1`
      )
      .bind(normalizedInput, lowerInput)
      .first<UserRow>();

    if (!row) {
      return null;
    }

    const valid = await this.verifyPassword(password, row.password_hash);
    if (!valid) {
      return null;
    }

    return {
      id: row.id,
      username: row.username
    };
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    const row = await this.db
      .prepare(`SELECT id, username FROM users WHERE id = ? LIMIT 1`)
      .bind(userId)
      .first<AuthUser>();
    return row ?? null;
  }

  async getOrCreateActionsUser(): Promise<AuthUser> {
    const byId = await this.getUserById(ACTIONS_SYSTEM_USER_ID);
    if (byId) {
      return byId;
    }

    const byUsername = await this.db
      .prepare(`SELECT id, username FROM users WHERE username = ? LIMIT 1`)
      .bind(ACTIONS_SYSTEM_USERNAME)
      .first<AuthUser>();
    if (byUsername) {
      return byUsername;
    }

    await this.db
      .prepare(
        `INSERT INTO users (id, username, email, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        ACTIONS_SYSTEM_USER_ID,
        ACTIONS_SYSTEM_USERNAME,
        ACTIONS_SYSTEM_EMAIL,
        AuthService.ACTIONS_PASSWORD_HASH,
        Date.now()
      )
      .run()
      .catch(() => undefined);

    const created =
      (await this.getUserById(ACTIONS_SYSTEM_USER_ID)) ??
      (await this.db
        .prepare(`SELECT id, username FROM users WHERE username = ? LIMIT 1`)
        .bind(ACTIONS_SYSTEM_USERNAME)
        .first<AuthUser>());
    if (!created) {
      throw new Error("Failed to create actions system user");
    }
    return created;
  }

  async createSessionToken(user: AuthUser): Promise<string> {
    return new SignJWT({ username: user.username })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(this.jwtSecretKey);
  }

  async verifySessionToken(token: string): Promise<AuthUser | null> {
    try {
      const payload = await jwtVerify(token, this.jwtSecretKey, {
        algorithms: ["HS256"]
      });
      const userId = payload.payload.sub;
      const username = payload.payload.username;

      if (typeof userId !== "string" || typeof username !== "string") {
        return null;
      }

      const user = await this.getUserById(userId);
      if (!user) {
        return null;
      }

      if (user.username !== username) {
        return null;
      }

      return user;
    } catch {
      return null;
    }
  }

  async createAccessToken(input: {
    userId: string;
    name: string;
    expiresAt?: number;
    internal?: boolean;
    displayAsActions?: boolean;
  }): Promise<{ tokenId: string; token: string }> {
    const tokenId = crypto.randomUUID();
    const random = crypto.randomUUID().replaceAll("-", "");
    const token = `gts_${random}`;
    const tokenPrefix = token.slice(0, 12);
    const tokenHash = await bcrypt.hash(token, 12);
    const createdAt = Date.now();

    await this.db
      .prepare(
        `INSERT INTO access_tokens (
          id, user_id, token_hash, token_prefix, name, is_internal, display_as_actions, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tokenId,
        input.userId,
        tokenHash,
        tokenPrefix,
        input.name,
        input.internal ? 1 : 0,
        input.displayAsActions ? 1 : 0,
        createdAt,
        input.expiresAt ?? null
      )
      .run();

    return {
      tokenId,
      token
    };
  }

  async verifyAccessTokenWithMetadata(
    token: string
  ): Promise<{ user: AuthUser; context: AccessTokenContext } | null> {
    if (!token) {
      return null;
    }

    const prefix = token.slice(0, 12);
    const now = Date.now();
    const candidates = await this.db
      .prepare(
        `SELECT
          t.id,
          t.user_id,
          t.token_hash,
          t.token_prefix,
          t.is_internal,
          t.display_as_actions,
          t.revoked_at,
          t.expires_at,
          u.username
         FROM access_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_prefix = ?
           AND t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > ?)`
      )
      .bind(prefix, now)
      .all<AccessTokenRow>();

    for (const row of candidates.results) {
      const valid = await bcrypt.compare(token, row.token_hash);
      if (!valid) {
        continue;
      }

      await this.db
        .prepare(
          `UPDATE access_tokens
           SET last_used_at = ?
           WHERE id = ?`
        )
        .bind(now, row.id)
        .run();

      return {
        user: {
          id: row.user_id,
          username: row.username
        },
        context: {
          tokenId: row.id,
          isInternal: row.is_internal === 1,
          displayAsActions: row.display_as_actions === 1
        }
      };
    }

    return null;
  }

  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    const verified = await this.verifyAccessTokenWithMetadata(token);
    return verified?.user ?? null;
  }

  async listAccessTokens(userId: string): Promise<AccessTokenMetadata[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          token_prefix,
          name,
          created_at,
          expires_at,
         last_used_at,
         revoked_at
         FROM access_tokens
         WHERE user_id = ? AND is_internal = 0
         ORDER BY created_at DESC`
      )
      .bind(userId)
      .all<AccessTokenMetadata>();
    return rows.results;
  }

  async revokeAccessToken(userId: string, tokenId: string): Promise<boolean> {
    const now = Date.now();
    const row = await this.db
      .prepare(
        `SELECT id
         FROM access_tokens
         WHERE id = ? AND user_id = ?
         LIMIT 1`
      )
      .bind(tokenId, userId)
      .first<{ id: string }>();
    if (!row) {
      return false;
    }

    await this.db
      .prepare(
        `UPDATE access_tokens
         SET revoked_at = ?
         WHERE id = ?`
      )
      .bind(now, tokenId)
      .run();
    return true;
  }
}
