import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler";
import { AuthService } from "../services/auth-service";
import {
  GITS_PLATFORM_MCP_TOOL_CREATE_PULL_REQUEST,
  GITS_PLATFORM_MCP_TOOL_ISSUE_REPLY
} from "../services/platform-mcp-service";
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
    REPOSITORY_OBJECTS: {
      getByName: vi.fn()
    } as unknown as DurableObjectNamespace,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787"
  };
}

function createFetchBridge(app: Hono<AppEnv>, env: AppEnv["Bindings"]) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    return app.fetch(request, env);
  };
}

describe("/api/mcp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires authentication before serving MCP requests", async () => {
    const app = createApp();
    const env = createBaseEnv(createMockD1Database([]));

    const response = await app.fetch(new Request("http://localhost/api/mcp"), env);

    expect(response.status).toBe(401);
  });

  it("allows authenticated MCP clients to initialize and list tools", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue(null);
    vi.spyOn(AuthService.prototype, "verifyAccessTokenWithMetadata").mockResolvedValue({
      user: {
        id: "user-1",
        username: "alice"
      },
      context: {
        tokenId: "tok-1",
        isInternal: false,
        displayAsActions: false
      }
    });

    const app = createApp();
    const env = createBaseEnv(createMockD1Database([]));
    const client = new Client({
      name: "api-mcp-test-client",
      version: "1.0.0"
    });
    const transport = new StreamableHTTPClientTransport(
      new URL("http://localhost/api/mcp?owner=alice&repo=demo"),
      {
        fetch: createFetchBridge(app, env),
        requestInit: {
          headers: {
            authorization: "Bearer gts_local"
          }
        }
      }
    );

    try {
      await client.connect(transport);
      const response = await client.listTools();
      expect(response.tools.map((tool) => tool.name)).toEqual([
        GITS_PLATFORM_MCP_TOOL_ISSUE_REPLY,
        GITS_PLATFORM_MCP_TOOL_CREATE_PULL_REQUEST
      ]);
    } finally {
      await client.close();
    }
  });
});
