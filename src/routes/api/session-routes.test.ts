import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { AuthService } from "../../services/auth-service";
import { hashToken, SessionService, SESSION_MAX_AGE } from "../../services/session-service";
import { sqliteD1 } from "../../test-utils/sqlite-d1";
import type { AppBindings } from "../../types";

let fixture: ReturnType<typeof sqliteD1>;
let service: SessionService;
let env: AppBindings;
const alice = { id: "alice", username: "alice" };
const bob = { id: "bob", username: "bob" };

beforeEach(() => {
  fixture = sqliteD1();
  service = new SessionService(fixture.db);
  env = { DB: fixture.db } as AppBindings;
  for (const user of [alice, bob]) {
    fixture.sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)")
      .run(user.id, user.username, `${user.id}@example.com`, "hash", Date.now());
  }
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); });

function request(path: string, token?: string, method = "GET", headers: Record<string, string> = {}) {
  return app.fetch(new Request(`https://gits.test/api${path}`, {
    method, headers: { ...(token ? { cookie: `session=${token}` } : {}), ...headers }
  }), env);
}
async function id(token: string) { return (await service.verify(token))!.sessionId; }

describe("server-side login sessions", () => {
  it("stores only hashes, rotates each login, and rejects tampering, expiry and old JWTs", async () => {
    const token = await service.create(alice, { userAgent: "Firefox", ipAddress: "192.0.2.1" });
    const other = await service.create(alice);
    expect(other).not.toBe(token);
    const rows = fixture.sqlite.prepare("SELECT * FROM user_sessions").all();
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]).toMatchObject({ token_hash: await hashToken(token), user_agent: "Firefox" });
    expect(Number(rows[0]!.expires_at) - Number(rows[0]!.created_at)).toBe(SESSION_MAX_AGE * 1000);
    expect(await service.verify(`${token}0`)).toBeNull();
    expect(await service.verify("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.signature")).toBeNull();
    fixture.sqlite.prepare("UPDATE user_sessions SET expires_at = ? WHERE token_hash = ?")
      .run(Date.now(), await hashToken(token));
    expect(await service.verify(token)).toBeNull();
    expect(await service.verify(other)).not.toBeNull();
  });

  it("revokes other devices immediately for cookies and Bearer tokens, preserving the current device", async () => {
    const current = await service.create(alice);
    const other = await service.create(alice);
    const foreign = await service.create(bob);
    const response = await request(`/auth/sessions/${await id(other)}`, current, "DELETE");
    expect(response.status).toBe(200);
    expect((await request("/auth/sessions", other)).status).toBe(401);
    expect((await request("/auth/sessions", undefined, "GET", { authorization: `Bearer ${other}` })).status).toBe(401);
    expect(await service.verify(current)).not.toBeNull();
    expect(await service.verify(foreign)).not.toBeNull();
  });

  it("isolates users and rejects revoking the current session through device management", async () => {
    const current = await service.create(alice);
    const foreign = await service.create(bob);
    expect((await request(`/auth/sessions/${await id(foreign)}`, current, "DELETE")).status).toBe(404);
    expect((await request(`/auth/sessions/${await id(current)}`, current, "DELETE")).status).toBe(400);
    expect(await service.verify(foreign)).not.toBeNull();
    const result = await (await request("/auth/sessions", current)).json();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].current).toBe(true);
    expect(JSON.stringify(result)).not.toContain("token_hash");
  });

  it("paginates active sessions and revokes all other devices across pages", async () => {
    const current = await service.create(alice);
    const others = [];
    for (let i = 0; i < 22; i++) others.push(await service.create(alice));
    const foreign = await service.create(bob);
    const first = await (await request("/auth/sessions", current)).json();
    const second = await (await request("/auth/sessions?page=2", current)).json();
    expect(first.sessions).toHaveLength(20);
    expect(first.sessions[0].current).toBe(true);
    expect(first.hasNext).toBe(true);
    expect(second.sessions).toHaveLength(3);
    expect(second.hasNext).toBe(false);
    expect(new Set([...first.sessions, ...second.sessions].map((s) => s.id)).size).toBe(23);
    expect((await request("/auth/sessions", current, "DELETE")).status).toBe(200);
    for (const token of others) expect(await service.verify(token)).toBeNull();
    expect(await service.verify(current)).not.toBeNull();
    expect(await service.verify(foreign)).not.toBeNull();
  });

  it("makes logout idempotent and revokes the actual cookie and bearer sessions", async () => {
    const token = await service.create(alice);
    const bearer = await service.create(alice);
    const result = await request("/auth/logout", token, "POST", { authorization: `Bearer ${bearer}` });
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await service.verify(token)).toBeNull();
    expect(await service.verify(bearer)).toBeNull();
    expect((await request("/auth/logout", token, "POST")).status).toBe(200);
    expect((await request("/auth/logout", undefined, "POST")).status).toBe(200);
  });

  it("blocks PAT session management and cross-origin mutations; disables response caching", async () => {
    const token = await service.create(alice);
    vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue(alice);
    for (const path of ["/auth/sessions", `/auth/sessions/${await id(token)}`]) {
      expect((await request(path, undefined, "DELETE", { authorization: "Bearer gts_pat" })).status).toBe(403);
    }
    for (const headers of [{ origin: "https://evil.test" }, { "sec-fetch-site": "cross-site" }]) {
      expect((await request("/auth/logout", token, "POST", headers)).status).toBe(403);
    }
    const result = await request("/me", token);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ user: alice });
    expect((await request("/auth/sessions?page=-1", token)).status).toBe(400);
  });

  it("creates a fresh session on login with safe cookie attributes and request metadata", async () => {
    vi.spyOn(AuthService.prototype, "verifyUserCredentials").mockResolvedValue(alice);
    const response = await app.fetch(new Request("https://gits.test/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "test-browser",
        "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify({ usernameOrEmail: "alice", password: "password" })
    }), env);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/", "Max-Age=604800"])
      expect(cookie).toContain(attribute);
    expect(fixture.sqlite.prepare("SELECT user_agent, ip_address FROM user_sessions").get())
      .toEqual({ user_agent: "test-browser", ip_address: "192.0.2.1" });
  });
});
