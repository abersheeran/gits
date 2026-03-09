import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../services/auth-service";
import { RepositoryObjectClient } from "../../services/repository-object";
import { createMockD1Database } from "../../test-utils/mock-d1";
import { buildRepositoryRow, createApp, createBaseEnv } from "./test-helpers";

describe("API repository admin routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes Git storage when creating repository", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-1",
      username: "alice"
    });
    const initializeSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "initializeRepository")
      .mockResolvedValue(undefined);
    const db = createMockD1Database([
      {
        when: "INSERT INTO repositories",
        run: () => ({ success: true })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "demo"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    expect(initializeSpy).toHaveBeenCalledWith({
      repositoryId: expect.any(String),
      owner: "alice",
      repo: "demo"
    });
  });

  it("rolls back storage rename when metadata update hits unique conflict", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const renameSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "renameRepository")
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
    expect(renameSpy.mock.calls[0]).toEqual([
      {
        repositoryId: "repo-1",
        owner: "alice",
        repo: "demo",
        nextRepo: "renamed"
      }
    ]);
    expect(renameSpy.mock.calls[1]).toEqual([
      {
        repositoryId: "repo-1",
        owner: "alice",
        repo: "renamed",
        nextRepo: "demo"
      }
    ]);
  });

  it("updates repository metadata and storage path for owner", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const renameSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "renameRepository")
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
    expect(renameSpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo",
      nextRepo: "renamed"
    });
    expect(updateParams).toEqual(["renamed", "new description", 0, "repo-1"]);
  });

  it("deletes repository storage and metadata for owner", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const deleteStorageSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "deleteRepository")
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
    expect(deleteStorageSpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo"
    });
    expect(deleted).toBe(true);
  });

  it("allows private repository branch listing for read collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const listBranchesSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "listHeadRefs")
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
    expect(listBranchesSpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo"
    });
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

  it("creates a branch for repository owner", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const createBranchSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "createBranch")
      .mockResolvedValue({
        defaultBranch: "main",
        branches: [
          { name: "refs/heads/main", oid: "0123456789abcdef0123456789abcdef01234567" },
          { name: "refs/heads/feature/test", oid: "0123456789abcdef0123456789abcdef01234567" }
        ]
      });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/branches", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          branchName: "feature/test",
          sourceOid: "0123456789abcdef0123456789abcdef01234567"
        })
      }),
      env
    );

    expect(response.status).toBe(201);
    expect(createBranchSpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo",
      branchName: "refs/heads/feature/test",
      sourceOid: "0123456789abcdef0123456789abcdef01234567"
    });
  });

  it("updates default branch for repository owner", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const setDefaultBranchSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "setDefaultBranch")
      .mockResolvedValue({
        defaultBranch: "develop",
        branches: [
          { name: "refs/heads/main", oid: "0123456789abcdef0123456789abcdef01234567" },
          { name: "refs/heads/develop", oid: "89abcdef012345670123456789abcdef01234567" }
        ]
      });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/default-branch", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          branchName: "develop"
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(setDefaultBranchSpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo",
      branchName: "refs/heads/develop"
    });
  });

  it("deletes a branch for repository owner", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const deleteBranchSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "deleteBranch")
      .mockResolvedValue({
        defaultBranch: "main",
        branches: [{ name: "refs/heads/main", oid: "0123456789abcdef0123456789abcdef01234567" }]
      });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      }
    ]);

    const app = createApp();
    const env = createBaseEnv(db);
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/branches/feature%2Ftest", {
        method: "DELETE",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(deleteBranchSpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo",
      branchName: "refs/heads/feature/test"
    });
  });
