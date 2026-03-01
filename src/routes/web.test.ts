import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import { AuthService } from "../services/auth-service";
import { RepositoryBrowserService } from "../services/repository-browser-service";
import { RepositoryService } from "../services/repository-service";
import { StorageService } from "../services/storage-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import type { AppEnv, RepositoryRecord } from "../types";

function createEnv(): AppEnv["Bindings"] {
  return {
    DB: createMockD1Database([]),
    GIT_BUCKET: {} as R2Bucket,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "auto"
  };
}

function createFormRequest(
  url: string,
  values: Record<string, string>,
  options?: { method?: string; bearerToken?: string }
): Request {
  const body = new URLSearchParams(values);
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded"
  });
  if (options?.bearerToken) {
    headers.set("authorization", `Bearer ${options.bearerToken}`);
  }

  return new Request(url, {
    method: options?.method ?? "POST",
    headers,
    body
  });
}

const baseUser = {
  id: "user-1",
  username: "alice"
};

const baseRepository: RepositoryRecord = {
  id: "repo-1",
  owner_id: "user-1",
  owner_username: "alice",
  name: "demo",
  description: "demo repository",
  is_private: 0,
  created_at: Date.now()
};

describe("web routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders home page with public repositories", async () => {
    vi.spyOn(RepositoryService.prototype, "listPublicRepositories").mockResolvedValue([baseRepository]);

    const response = await app.fetch(new Request("http://localhost/"), createEnv());

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Public Repositories");
    expect(html).toContain("alice/demo");
  });

  it("redirects /dashboard to login when session is missing", async () => {
    const response = await app.fetch(new Request("http://localhost/dashboard"), createEnv());

    expect(response.status).toBe(303);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("/auth/login")).toBe(true);
    expect(location).toContain("error=");
  });

  it("logs in from form and sets session cookie", async () => {
    vi.spyOn(AuthService.prototype, "verifyUserCredentials").mockResolvedValue(baseUser);
    vi.spyOn(AuthService.prototype, "createSessionToken").mockResolvedValue("session-token");

    const request = createFormRequest("http://localhost/auth/login", {
      usernameOrEmail: "alice",
      password: "Password123"
    });
    const response = await app.fetch(request, createEnv());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/dashboard?success=");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=session-token");
  });

  it("validates register form and shows message for short password", async () => {
    const request = createFormRequest("http://localhost/auth/register", {
      username: "alice",
      email: "alice@example.com",
      password: "short"
    });
    const response = await app.fetch(request, createEnv());

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("密码至少 8 位");
  });

  it("creates repository from dashboard form", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(baseUser);
    const createRepositorySpy = vi
      .spyOn(RepositoryService.prototype, "createRepository")
      .mockResolvedValue({ id: "repo-created" });
    const initializeSpy = vi.spyOn(StorageService.prototype, "initializeRepository").mockResolvedValue();

    const request = createFormRequest(
      "http://localhost/dashboard/repos",
      {
        name: "demo",
        description: "demo repo",
        isPrivate: "1"
      },
      { bearerToken: "session-ok" }
    );
    const response = await app.fetch(request, createEnv());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/alice/demo?success=");
    expect(createRepositorySpy).toHaveBeenCalledWith({
      ownerId: "user-1",
      name: "demo",
      description: "demo repo",
      isPrivate: true
    });
    expect(initializeSpy).toHaveBeenCalledWith("alice", "demo");
  });

  it("updates repository settings and renames repository", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(baseUser);
    vi.spyOn(RepositoryService.prototype, "findRepository").mockResolvedValue(baseRepository);
    const renameSpy = vi.spyOn(StorageService.prototype, "renameRepository").mockResolvedValue();
    const updateSpy = vi.spyOn(RepositoryService.prototype, "updateRepository").mockResolvedValue();

    const request = createFormRequest(
      "http://localhost/dashboard/repos/alice/demo/settings",
      {
        name: "demo-renamed",
        description: "new desc",
        isPrivate: "1"
      },
      { bearerToken: "session-ok" }
    );
    const response = await app.fetch(request, createEnv());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "/dashboard/repos/alice/demo-renamed/settings?success="
    );
    expect(renameSpy).toHaveBeenCalledWith("alice", "demo", "demo-renamed");
    expect(updateSpy).toHaveBeenCalledWith(
      "repo-1",
      expect.objectContaining({
        name: "demo-renamed",
        description: "new desc",
        isPrivate: true
      })
    );
  });

  it("renders repository detail page with commits and readme", async () => {
    vi.spyOn(RepositoryService.prototype, "findRepository").mockResolvedValue(baseRepository);
    vi.spyOn(RepositoryService.prototype, "canReadRepository").mockResolvedValue(true);
    vi.spyOn(RepositoryBrowserService.prototype, "getRepositoryDetail").mockResolvedValue({
      defaultBranch: "main",
      selectedRef: "refs/heads/main",
      headOid: "a".repeat(40),
      branches: [{ name: "main", oid: "a".repeat(40) }],
      readme: {
        path: "README.md",
        content: "# Demo"
      }
    });
    vi.spyOn(RepositoryBrowserService.prototype, "listCommitHistory").mockResolvedValue({
      ref: "refs/heads/main",
      commits: [
        {
          oid: "b".repeat(40),
          message: "initial commit",
          author: {
            name: "alice",
            email: "alice@example.com",
            timestamp: 1700000000,
            timezoneOffset: 0
          },
          committer: {
            name: "alice",
            email: "alice@example.com",
            timestamp: 1700000000,
            timezoneOffset: 0
          },
          parents: []
        }
      ]
    });

    const response = await app.fetch(new Request("http://localhost/alice/demo"), createEnv());

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("README.md");
    expect(html).toContain("initial commit");
    expect(html).toContain("http://localhost/alice/demo.git");
  });

  it("creates access token from dashboard tokens page", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(baseUser);
    vi.spyOn(AuthService.prototype, "createAccessToken").mockResolvedValue({
      tokenId: "tok-1",
      token: "gts_1234567890"
    });
    vi.spyOn(AuthService.prototype, "listAccessTokens").mockResolvedValue([
      {
        id: "tok-1",
        token_prefix: "gts_123456",
        name: "laptop",
        created_at: Date.now(),
        expires_at: null,
        last_used_at: null,
        revoked_at: null
      }
    ]);

    const request = createFormRequest(
      "http://localhost/dashboard/tokens",
      {
        name: "laptop",
        expiresAt: ""
      },
      { bearerToken: "session-ok" }
    );
    const response = await app.fetch(request, createEnv());

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("gts_1234567890");
    expect(html).toContain("Token 创建成功");
  });

  it("adds collaborator from dashboard collaborator form", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(baseUser);
    vi.spyOn(RepositoryService.prototype, "findRepository").mockResolvedValue(baseRepository);
    vi.spyOn(RepositoryService.prototype, "canAdminRepository").mockResolvedValue(true);
    vi.spyOn(RepositoryService.prototype, "listCollaborators").mockResolvedValue([]);
    vi.spyOn(RepositoryService.prototype, "findUserByUsername").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const upsertSpy = vi.spyOn(RepositoryService.prototype, "upsertCollaborator").mockResolvedValue();

    const request = createFormRequest(
      "http://localhost/dashboard/repos/alice/demo/collaborators",
      {
        username: "bob",
        permission: "write"
      },
      { bearerToken: "session-ok" }
    );
    const response = await app.fetch(request, createEnv());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "/dashboard/repos/alice/demo/collaborators?success="
    );
    expect(upsertSpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      userId: "user-2",
      permission: "write"
    });
  });
});
