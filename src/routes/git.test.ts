import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler";
import { AuthService } from "../services/auth-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import { MockR2Bucket } from "../test-utils/mock-r2";
import type { AppEnv } from "../types";
import gitRoutes from "./git";

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route("/", gitRoutes);
  return app;
}

function createEnv(): AppEnv["Bindings"] {
  return {
    DB: createMockD1Database([]),
    GIT_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787"
  };
}

function createPrivateRepositoryEnv(owner: string, repo: string): AppEnv["Bindings"] {
  return {
    DB: createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: (params) => {
          if (params[0] !== owner || params[1] !== repo) {
            return null;
          }
          return {
            id: "repo-private-1",
            owner_id: "user-1",
            owner_username: owner,
            name: repo,
            description: "private repo",
            is_private: 1,
            created_at: Date.now()
          };
        }
      }
    ]),
    GIT_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787"
  };
}

describe("Git routes validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid service query", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/info/refs?service=bad-service"),
      createEnv()
    );
    expect(response.status).toBe(400);
  });

  it("returns 401 challenge for private upload-pack info/refs when credentials are missing", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/info/refs?service=git-upload-pack"),
      createPrivateRepositoryEnv("alice", "demo")
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="Git service"');
  });

  it("returns 415 for upload-pack with invalid content type", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "text/plain"
        },
        body: "hello"
      }),
      createEnv()
    );
    expect(response.status).toBe(415);
  });

  it("returns 401 challenge for private upload-pack when credentials are missing", async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body: "0000"
      }),
      createPrivateRepositoryEnv("alice", "demo")
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="Git service"');
  });

  it("returns 413 when upload-pack body exceeds configured limit", async () => {
    const app = createApp();
    const env = {
      ...createEnv(),
      UPLOAD_PACK_MAX_BODY_BYTES: "4"
    };
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request",
          "content-length": "20"
        },
        body: "123456"
      }),
      env
    );
    expect(response.status).toBe(413);
  });

  it("returns 415 for receive-pack with invalid content type", async () => {
    vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue({
      id: "u1",
      username: "alice"
    });

    const app = createApp();
    const auth = Buffer.from("alice:pat-ok", "utf8").toString("base64");
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-receive-pack", {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "text/plain"
        },
        body: "hello"
      }),
      createEnv()
    );
    expect(response.status).toBe(415);
  });

  it("returns 413 when receive-pack body exceeds configured limit", async () => {
    vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue({
      id: "u1",
      username: "alice"
    });

    const app = createApp();
    const auth = Buffer.from("alice:pat-ok", "utf8").toString("base64");
    const env = {
      ...createEnv(),
      RECEIVE_PACK_MAX_BODY_BYTES: "4"
    };
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-receive-pack", {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-git-receive-pack-request",
          "content-length": "20"
        },
        body: "123456"
      }),
      env
    );
    expect(response.status).toBe(413);
  });
});
