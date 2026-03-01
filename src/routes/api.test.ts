import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler";
import { AuthService } from "../services/auth-service";
import { RepositoryService } from "../services/repository-service";
import { StorageService } from "../services/storage-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import type { AppEnv } from "../types";
import apiRoutes from "./api";

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route("/api", apiRoutes);
  return app;
}

function createBaseEnv(db: D1Database): AppEnv["Bindings"] {
  return {
    DB: db,
    GIT_BUCKET: {} as R2Bucket,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787"
  };
}

describe("API validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when request json is not an object", async () => {
    const app = createApp();
    const env = createBaseEnv(createMockD1Database([]));

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]"
    });
    const response = await app.fetch(request, env);

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("JSON body must be an object");
  });

  it("returns 400 for invalid username slug", async () => {
    const app = createApp();
    const env = createBaseEnv(createMockD1Database([]));

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "bad/name",
        email: "dev@example.com",
        password: "Password123"
      })
    });
    const response = await app.fetch(request, env);

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("Invalid username");
  });

  it("returns public repository list", async () => {
    const app = createApp();
    const env = createBaseEnv(createMockD1Database([]));
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

    const response = await app.fetch(new Request("http://localhost/api/public/repos?limit=5"), env);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      repositories: Array<{ owner_username: string; name: string }>;
    };
    expect(body.repositories).toHaveLength(1);
    expect(body.repositories[0]).toEqual(
      expect.objectContaining({
        owner_username: "alice",
        name: "demo"
      })
    );
  });

  it("sets non-secure session cookie for http register requests", async () => {
    const app = createApp();
    const env = createBaseEnv(createMockD1Database([]));
    vi.spyOn(AuthService.prototype, "createUser").mockResolvedValue({
      id: "user-1",
      username: "alice"
    });
    vi.spyOn(AuthService.prototype, "createSessionToken").mockResolvedValue("session-token");

    const response = await app.fetch(
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
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=session-token");
    expect(setCookie.toLowerCase()).not.toContain("secure");
  });

  it("preserves leading/trailing spaces in password before hashing", async () => {
    let insertedHash = "";
    const db = createMockD1Database([
      {
        when: "INSERT INTO users",
        run: (params) => {
          insertedHash = String(params[3] ?? "");
          return { success: true };
        }
      }
    ]);
    const app = createApp();
    const env = createBaseEnv(db);
    const originalPassword = "  KeepSpaces123  ";

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "alice_dev",
        email: "alice@example.com",
        password: originalPassword
      })
    });
    const response = await app.fetch(request, env);

    expect(response.status).toBe(201);
    expect(insertedHash.length).toBeGreaterThan(0);
    await expect(bcrypt.compare(originalPassword, insertedHash)).resolves.toBe(true);
    await expect(bcrypt.compare(originalPassword.trim(), insertedHash)).resolves.toBe(false);
  });

  it("returns branch list for readable repository", async () => {
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => ({
          id: "repo-1",
          owner_id: "user-1",
          owner_username: "alice",
          name: "demo",
          description: "demo",
          is_private: 0,
          created_at: Date.now()
        })
      }
    ]);
    const listBranchesSpy = vi
      .spyOn(StorageService.prototype, "listHeadRefs")
      .mockResolvedValue([{ name: "refs/heads/main", oid: "0123456789abcdef0123456789abcdef01234567" }]);

    const app = createApp();
    const env = createBaseEnv(db);
    const request = new Request("http://localhost/api/repos/alice/demo/branches");
    const response = await app.fetch(request, env);

    expect(response.status).toBe(200);
    expect(listBranchesSpy).toHaveBeenCalledWith("alice", "demo");
    const body = (await response.json()) as {
      branches: Array<{ name: string; oid: string }>;
    };
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0]?.name).toBe("refs/heads/main");
  });

  it("returns 404 for private repository without session", async () => {
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => ({
          id: "repo-2",
          owner_id: "user-2",
          owner_username: "private_owner",
          name: "secret",
          description: null,
          is_private: 1,
          created_at: Date.now()
        })
      }
    ]);
    const app = createApp();
    const env = createBaseEnv(db);
    const request = new Request("http://localhost/api/repos/private_owner/secret/branches");
    const response = await app.fetch(request, env);

    expect(response.status).toBe(404);
  });

  it("initializes Git storage when creating repository", async () => {
    const verifySpy = vi
      .spyOn(AuthService.prototype, "verifySessionToken")
      .mockResolvedValue({ id: "user-1", username: "alice" });
    const initSpy = vi
      .spyOn(StorageService.prototype, "initializeRepository")
      .mockResolvedValue(undefined);
    const db = createMockD1Database([
      {
        when: "INSERT INTO repositories",
        run: () => ({ success: true })
      }
    ]);
    const app = createApp();
    const env = createBaseEnv(db);
    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      headers: {
        authorization: "Bearer session-ok",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: "demo"
      })
    });
    const response = await app.fetch(request, env);

    expect(response.status).toBe(201);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(initSpy).toHaveBeenCalledWith("alice", "demo");
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
    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/auth/tokens", {
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tokens: Array<{ id: string }>;
    };
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]?.id).toBe("tok-1");
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
    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/auth/tokens/tok-1", {
        method: "DELETE",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(updated).toBe(true);
  });
});
