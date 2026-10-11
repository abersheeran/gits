import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler";
import { AuthService } from "../services/auth-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import { MockR2Bucket } from "../test-utils/mock-r2";
import {
  createMockRepositoryObjectNamespace
} from "../test-utils/mock-repository-object-namespace";
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

  it("challenges anonymous access to private upload-pack info/refs", async () => {
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

it("returns 413 for a chunked receive-pack that crosses the configured limit", async () => {
  const verify = vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue({
    id: "user-1",
    username: "alice"
  });
  try {
    const env = createPrivateRepositoryEnv("alice", "demo");
    env.RECEIVE_PACK_MAX_BODY_BYTES = "16";
    env.REPOSITORY_OBJECTS = createMockRepositoryObjectNamespace(() => env);
    let remaining = 128;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!remaining) {
          controller.close();
          return;
        }
        controller.enqueue(new TextEncoder().encode("0034".repeat(4)));
        remaining -= 16;
      }
    });
    const response = await createApp().fetch(
      new Request("http://localhost/alice/demo/git-receive-pack", {
        method: "POST",
        duplex: "half",
        body,
        headers: {
          authorization: `Basic ${Buffer.from("alice:pat-ok").toString("base64")}`,
          "content-type": "application/x-git-receive-pack-request"
        }
      }),
      env
    );
    expect(response.status).toBe(413);
  } finally {
    verify.mockRestore();
  }
});
