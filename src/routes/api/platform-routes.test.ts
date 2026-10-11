import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../services/auth-service";
import { RepositoryService } from "../../services/repository-service";
import { createMockD1Database } from "../../test-utils/mock-d1";
import { createApp, createBaseEnv } from "./test-helpers";

describe("API platform routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 403 when user registration flag is missing", async () => {
    const env = createBaseEnv(createMockD1Database([]));
    delete env.ALLOW_USER_REGISTRATION;

    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice",
          email: "alice@example.com",
          password: "Password123"
        })
      }),
      env
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("User registration is disabled");
  });

  it.each(["false", "0", "", "enabled"])("returns 403 when user registration flag is %j", async (flag) => {
    const env = createBaseEnv(createMockD1Database([]));
    env.ALLOW_USER_REGISTRATION = flag;

    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice",
          email: "alice@example.com",
          password: "Password123"
        })
      }),
      env
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("User registration is disabled");
  });

  it.each(["true", " TRUE "])("allows registration when user registration flag is %j", async (flag) => {
    vi.spyOn(AuthService.prototype, "createUser").mockResolvedValue({
      id: "user-1",
      username: "alice"
    });
    vi.spyOn(AuthService.prototype, "createSessionToken").mockResolvedValue("session-token");

    const env = createBaseEnv(createMockD1Database([]));
    env.ALLOW_USER_REGISTRATION = flag;

    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice",
          email: "alice@example.com",
          password: "Password123"
        })
      }),
      env
    );

    expect(response.status).toBe(201);
  });

  it("returns 400 when request json is not an object", async () => {
    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]"
      }),
      createBaseEnv(createMockD1Database([]))
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("JSON body must be an object");
  });

  it("returns 400 for invalid username slug", async () => {
    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "bad/name",
          email: "dev@example.com",
          password: "Password123"
        })
      }),
      createBaseEnv(createMockD1Database([]))
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid username");
  });

  it("returns public repository list", async () => {
    vi.spyOn(RepositoryService.prototype, "listPublicRepositories").mockResolvedValue([
      {
        id: "repo-1",
        owner_id: "user-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 0,
        created_at: Date.now()
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/public/repos?limit=5"),
      createBaseEnv(createMockD1Database([]))
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as { repositories: Array<{ owner_username: string; name: string }> })
      .toEqual({
        repositories: [
          expect.objectContaining({
            owner_username: "alice",
            name: "demo"
          })
        ]
      });
  });

  it("sets non-secure session cookie for http register requests", async () => {
    vi.spyOn(AuthService.prototype, "createUser").mockResolvedValue({
      id: "user-1",
      username: "alice"
    });
    vi.spyOn(AuthService.prototype, "createSessionToken").mockResolvedValue("session-token");

    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice",
          email: "alice@example.com",
          password: "Password123"
        })
      }),
      createBaseEnv(createMockD1Database([]))
    );

    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=session-token");
    expect(setCookie.toLowerCase()).not.toContain("secure");
  });

  it("preserves leading and trailing spaces in password before hashing", async () => {
    let insertedHash = "";
    const originalPassword = "  KeepSpaces123  ";
    vi.spyOn(AuthService.prototype, "createSessionToken").mockResolvedValue("session-token");
    const db = createMockD1Database([
      {
        when: "INSERT INTO users",
        run: (params) => {
          insertedHash = String(params[3] ?? "");
          return { success: true };
        }
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice_dev",
          email: "alice@example.com",
          password: originalPassword
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    expect(insertedHash.length).toBeGreaterThan(0);
    await expect(bcrypt.compare(originalPassword, insertedHash)).resolves.toBe(true);
    await expect(bcrypt.compare(originalPassword.trim(), insertedHash)).resolves.toBe(false);
  });

  it("lists current user access tokens", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-1",
      username: "alice"
    });
    const db = createMockD1Database([
      {
        when: "FROM access_tokens",
        all: () => [
          {
            id: "tok-1",
            token_prefix: "gts_abc12345",
            name: "local-dev",
            created_at: Date.now(),
            expires_at: null,
            last_used_at: null,
            revoked_at: null
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/tokens", {
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as { tokens: Array<{ id: string }> }).toEqual({
      tokens: [expect.objectContaining({ id: "tok-1" })]
    });
  });

  it("revokes existing access token", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-1",
      username: "alice"
    });
    let updated = false;
    const db = createMockD1Database([
      {
        when: /SELECT\s+id\s+FROM access_tokens/,
        first: () => ({ id: "tok-1" })
      },
      {
        when: "UPDATE access_tokens",
        run: () => {
          updated = true;
          return { success: true };
        }
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/auth/tokens/tok-1", {
        method: "DELETE",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect(updated).toBe(true);
  });
});
