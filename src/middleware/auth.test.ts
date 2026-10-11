import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../services/auth-service";
import type { AppEnv } from "../types";
import { optionalSession, requireGitBasicAuth } from "./auth";

function createEnv(): AppEnv["Bindings"] {
  return {
    DB: {} as D1Database,
    GIT_BUCKET: {} as R2Bucket,
  };
}

function createApp() {
  const app = new Hono<AppEnv>();
  app.use("*", optionalSession);
  app.get("/me", (c) => c.json({ user: c.get("sessionUser") ?? null }));
  return app;
}

function createGitAuthApp() {
  const app = new Hono<AppEnv>();
  app.get("/git-auth", requireGitBasicAuth, (c) => {
    return c.json({ user: c.get("basicAuthUser") ?? null });
  });
  return app;
}

describe("optionalSession middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a personal access token as bearer credentials", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(null);
    const tokenSpy = vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue({
      id: "u1",
      username: "alice"
    });
    const response = await createApp().fetch(
      new Request("http://localhost/me", {
        headers: { authorization: "Bearer gts_personal" }
      }),
      createEnv()
    );

    expect(response.status).toBe(200);
    expect(tokenSpy).toHaveBeenCalledWith("gts_personal");
    expect(await response.json()).toEqual({ user: { id: "u1", username: "alice" } });
  });

  it("falls back to cookie token when bearer token is invalid", async () => {
    const verifySpy = vi
      .spyOn(AuthService.prototype, "verifySessionToken")
      .mockImplementation(async (token: string) => {
        if (token === "cookie-ok") {
          return { id: "u1", username: "alice" };
        }
        return null;
      });

    const app = createApp();
    const request = new Request("http://localhost/me", {
      headers: {
        authorization: "Bearer bearer-bad",
        cookie: "session=cookie-ok"
      }
    });
    const response = await app.fetch(request, createEnv());

    expect(response.status).toBe(200);
    expect(verifySpy).toHaveBeenCalledTimes(2);
    const body = (await response.json()) as { user: { id: string; username: string } | null };
    expect(body.user?.username).toBe("alice");
  });

  it("ignores empty bearer token and uses cookie token directly", async () => {
    const verifySpy = vi
      .spyOn(AuthService.prototype, "verifySessionToken")
      .mockResolvedValue({ id: "u2", username: "bob" });

    const app = createApp();
    const request = new Request("http://localhost/me", {
      headers: {
        authorization: "Bearer   ",
        cookie: "session=cookie-ok"
      }
    });
    const response = await app.fetch(request, createEnv());

    expect(response.status).toBe(200);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith("cookie-ok");
    const body = (await response.json()) as { user: { id: string; username: string } | null };
    expect(body.user?.username).toBe("bob");
  });
});

describe("requireGitBasicAuth middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns challenge when credentials are missing", async () => {
    const app = createGitAuthApp();
    const response = await app.fetch(new Request("http://localhost/git-auth"), createEnv());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="Git service"');
    await expect(response.text()).resolves.toBe("Authentication required");
  });

  it("rejects when token user does not match basic auth username", async () => {
    vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue({
      id: "u1",
      username: "alice"
    });
    const app = createGitAuthApp();
    const auth = Buffer.from("bob:pat-ok", "utf8").toString("base64");
    const response = await app.fetch(
      new Request("http://localhost/git-auth", {
        headers: {
          authorization: `Basic ${auth}`
        }
      }),
      createEnv()
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="Git service"');
    await expect(response.text()).resolves.toBe("Invalid credentials");
  });

  it("stores authenticated user in context when credentials are valid", async () => {
    vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue({
      id: "u1",
      username: "alice"
    });
    const app = createGitAuthApp();
    const auth = Buffer.from("alice:pat-ok", "utf8").toString("base64");
    const response = await app.fetch(
      new Request("http://localhost/git-auth", {
        headers: {
          authorization: `Basic ${auth}`
        }
      }),
      createEnv()
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string; username: string } | null };
    expect(body.user?.id).toBe("u1");
    expect(body.user?.username).toBe("alice");
  });
});
