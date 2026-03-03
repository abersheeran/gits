import { describe, expect, it } from "vitest";
import app from "./app";
import { createMockD1Database } from "./test-utils/mock-d1";
import type { AppEnv } from "./types";

function createBaseEnv(overrides?: Partial<AppEnv["Bindings"]>): AppEnv["Bindings"] {
  return {
    DB: createMockD1Database([]),
    GIT_BUCKET: {} as R2Bucket,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787",
    ...(overrides ?? {})
  };
}

describe("SPA assets fallback", () => {
  it("serves static asset when it exists", async () => {
    const env = createBaseEnv({
      ASSETS: {
        fetch: async () => new Response("console.log('ok')", { status: 200 })
      } as Fetcher
    });

    const response = await app.fetch(new Request("http://localhost/assets/app.js"), env);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("ok");
  });

  it("falls back to index.html for html routes", async () => {
    const visited: string[] = [];
    const env = createBaseEnv({
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          visited.push(pathname);
          if (pathname === "/index.html") {
            return new Response("<html>spa</html>", { status: 200 });
          }
          return new Response("Not Found", { status: 404 });
        }
      } as Fetcher
    });

    const response = await app.fetch(
      new Request("http://localhost/dashboard", {
        headers: {
          accept: "text/html"
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("spa");
    expect(visited).toEqual(["/dashboard", "/index.html"]);
  });

  it("does not fall back to index.html for non-html accept", async () => {
    const visited: string[] = [];
    const env = createBaseEnv({
      ASSETS: {
        fetch: async (request) => {
          visited.push(new URL(request.url).pathname);
          return new Response("Not Found", { status: 404 });
        }
      } as Fetcher
    });

    const response = await app.fetch(
      new Request("http://localhost/dashboard", {
        headers: {
          accept: "application/json"
        }
      }),
      env
    );

    expect(response.status).toBe(404);
    expect(visited).toEqual(["/dashboard"]);
  });

  it("returns 404 when assets binding is missing", async () => {
    const env = createBaseEnv();
    const response = await app.fetch(new Request("http://localhost/dashboard"), env);
    expect(response.status).toBe(404);
  });
});
