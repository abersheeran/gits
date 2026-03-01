import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler";
import { AuthService } from "../services/auth-service";
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

function buildRepositoryRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "repo-1",
    owner_id: "owner-1",
    owner_username: "alice",
    name: "demo",
    description: "demo repo",
    is_private: 1,
    created_at: Date.now(),
    ...(overrides ?? {})
  };
}

describe("API repository lifecycle and permission matrix", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rolls back storage rename when metadata update hits unique conflict", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const renameSpy = vi
      .spyOn(StorageService.prototype, "renameRepository")
      .mockResolvedValue(undefined);
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "UPDATE repositories",
        run: () => {
          throw new Error("UNIQUE constraint failed: repositories.owner_id, repositories.name");
        }
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "renamed"
        })
      }),
      env
    );

    expect(response.status).toBe(409);
    expect(renameSpy).toHaveBeenCalledTimes(2);
    expect(renameSpy.mock.calls[0]).toEqual(["alice", "demo", "renamed"]);
    expect(renameSpy.mock.calls[1]).toEqual(["alice", "renamed", "demo"]);
  });

  it("updates repository metadata and storage path for owner", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const renameSpy = vi
      .spyOn(StorageService.prototype, "renameRepository")
      .mockResolvedValue(undefined);
    let updateParams: unknown[] = [];
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "UPDATE repositories",
        run: (params) => {
          updateParams = params;
          return { success: true };
        }
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "renamed",
          description: "new description",
          isPrivate: false
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith("alice", "demo", "renamed");
    expect(updateParams).toEqual(["renamed", "new description", 0, "repo-1"]);
  });

  it("deletes repository storage and metadata for owner", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const deleteStorageSpy = vi
      .spyOn(StorageService.prototype, "deleteRepository")
      .mockResolvedValue(undefined);
    let deleted = false;
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "DELETE FROM repositories",
        run: () => {
          deleted = true;
          return { success: true };
        }
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo", {
        method: "DELETE",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(deleteStorageSpy).toHaveBeenCalledWith("alice", "demo");
    expect(deleted).toBe(true);
  });

  it("allows private repository branch listing for read collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const listBranchesSpy = vi
      .spyOn(StorageService.prototype, "listHeadRefs")
      .mockResolvedValue([{ name: "refs/heads/main", oid: "0123456789abcdef0123456789abcdef01234567" }]);
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/branches", {
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(listBranchesSpy).toHaveBeenCalledWith("alice", "demo");
  });

  it("blocks collaborator administration for non-admin users", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "write" })
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/collaborators", {
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );

    expect(response.status).toBe(403);
  });

  it("creates collaborator membership and prevents owner removal", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    let upsertParams: unknown[] = [];
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "SELECT id, username FROM users WHERE username = ? LIMIT 1",
        first: (params) => {
          if (params[0] === "bob") {
            return { id: "user-2", username: "bob" };
          }
          if (params[0] === "alice") {
            return { id: "owner-1", username: "alice" };
          }
          return null;
        }
      },
      {
        when: "INSERT INTO repository_collaborators",
        run: (params) => {
          upsertParams = params;
          return { success: true };
        }
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const createResponse = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/collaborators", {
        method: "PUT",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          username: "bob",
          permission: "write"
        })
      }),
      env
    );

    expect(createResponse.status).toBe(200);
    expect(upsertParams[0]).toBe("repo-1");
    expect(upsertParams[1]).toBe("user-2");
    expect(upsertParams[2]).toBe("write");
    expect(typeof upsertParams[3]).toBe("number");

    const removeOwnerResponse = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/collaborators/alice", {
        method: "DELETE",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );

    expect(removeOwnerResponse.status).toBe(400);
  });
});
