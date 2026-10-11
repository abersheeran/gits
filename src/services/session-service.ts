import type { AuthUser } from "../types";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
export type SessionMetadata = {
  id: string;
  user_agent: string;
  ip_address: string | null;
  created_at: number;
  last_used_at: number;
  expires_at: number;
};
export type SessionContext = { userAgent?: string; ipAddress?: string };

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class SessionService {
  constructor(private readonly db: D1Database) {}

  async create(user: AuthUser, context: SessionContext = {}): Promise<string> {
    const token = `gss_${randomToken()}`;
    const now = Date.now();
    await this.db.batch([
      this.db.prepare("DELETE FROM user_sessions WHERE user_id = ? AND expires_at <= ?")
        .bind(user.id, now),
      this.db.prepare(`INSERT INTO user_sessions
        (id, user_id, token_hash, user_agent, ip_address, created_at, last_used_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), user.id, await hashToken(token),
          (context.userAgent ?? "").slice(0, 512), context.ipAddress?.slice(0, 64) ?? null,
          now, now, now + SESSION_MAX_AGE * 1000)
    ]);
    return token;
  }

  async verify(token: string): Promise<(AuthUser & { sessionId: string }) | null> {
    if (!/^gss_[a-f0-9]{64}$/.test(token)) return null;
    const now = Date.now();
    // Read D1 on every request; never cache revocable credentials.
    const row = await this.db.prepare(`SELECT u.id, u.username, s.id AS sessionId, s.last_used_at
      FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`)
      .bind(await hashToken(token), now)
      .first<AuthUser & { sessionId: string; last_used_at: number }>();
    if (!row) return null;
    // Activity is approximate to the minute without a write on every read.
    if (row.last_used_at <= now - 60_000) {
      await this.db.prepare(`UPDATE user_sessions SET last_used_at = ?
        WHERE id = ? AND last_used_at <= ?`).bind(now, row.sessionId, now - 60_000).run();
    }
    return { id: row.id, username: row.username, sessionId: row.sessionId };
  }

  async list(userId: string, currentId: string, page: number) {
    const rows = await this.db.prepare(`SELECT id, user_agent, ip_address,
      created_at, last_used_at, expires_at FROM user_sessions
      WHERE user_id = ? AND expires_at > ?
      ORDER BY (id = ?) DESC, created_at DESC, id DESC LIMIT 21 OFFSET ?`)
      .bind(userId, Date.now(), currentId, (page - 1) * 20).all<SessionMetadata>();
    return {
      sessions: rows.results.slice(0, 20).map((row) => ({ ...row, current: row.id === currentId })),
      hasNext: rows.results.length > 20
    };
  }

  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM user_sessions WHERE user_id = ? AND id = ?")
      .bind(userId, sessionId).run();
    return result.meta.changes > 0;
  }

  async revokeOthers(userId: string, currentId: string): Promise<void> {
    await this.db.prepare("DELETE FROM user_sessions WHERE user_id = ? AND id != ?")
      .bind(userId, currentId).run();
  }
}
