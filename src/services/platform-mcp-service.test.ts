import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GITS_PLATFORM_MCP_TOOL_CREATE_PULL_REQUEST,
  GITS_PLATFORM_MCP_TOOL_ISSUE_REPLY,
  createPlatformMcpServer
} from "./platform-mcp-service";

async function connectClient(input?: Parameters<typeof createPlatformMcpServer>[0]) {
  const server = createPlatformMcpServer({
    apiBaseUrl: "http://localhost:8787",
    ...(input ?? {})
  });
  const client = new Client({
    name: "platform-mcp-test-client",
    version: "1.0.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("createPlatformMcpServer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the issue reply and pull request tools", async () => {
    const { client, server } = await connectClient();
    try {
      const response = await client.listTools();
      expect(response.tools.map((tool) => tool.name)).toEqual([
        GITS_PLATFORM_MCP_TOOL_ISSUE_REPLY,
        GITS_PLATFORM_MCP_TOOL_CREATE_PULL_REQUEST
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("forwards issue replies to the platform API with MCP defaults and auth headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"comment":{"id":"comment-1"}}', {
        status: 201,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    const { client, server } = await connectClient({
      forwardedHeaders: {
        authorization: "Bearer gts_local"
      },
      defaults: {
        owner: "alice",
        repo: "demo",
        issueNumber: 42
      }
    });

    try {
      const response = await client.callTool({
        name: GITS_PLATFORM_MCP_TOOL_ISSUE_REPLY,
        arguments: {
          body: "Please share the failing logs."
        }
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8787/api/repos/alice/demo/issues/42/comments",
        expect.objectContaining({
          method: "POST",
          headers: expect.any(Headers),
          body: JSON.stringify({
            body: "Please share the failing logs."
          }),
          signal: expect.any(AbortSignal)
        })
      );
      const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
      expect(new Headers(requestHeaders).get("authorization")).toBe("Bearer gts_local");
      expect(new Headers(requestHeaders).get("content-type")).toBe("application/json");
      expect(response.isError).toBeFalsy();
      expect(response.content).toEqual([
        {
          type: "text",
          text: '{"comment":{"id":"comment-1"}}'
        }
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a tool error when required issue context is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { client, server } = await connectClient({
      forwardedHeaders: {
        authorization: "Bearer gts_local"
      }
    });

    try {
      const response = await client.callTool({
        name: GITS_PLATFORM_MCP_TOOL_ISSUE_REPLY,
        arguments: {
          body: "Need more details."
        }
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(response.isError).toBe(true);
      expect(response.content).toEqual([
        {
          type: "text",
          text: "Issue reply failed: Missing repository context. Provide owner/repo in tool args or MCP URL defaults."
        }
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("forwards pull request creation requests with optional closeIssueNumbers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"pullRequest":{"number":7}}', {
        status: 201,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    const { client, server } = await connectClient({
      forwardedHeaders: {
        cookie: "session=test"
      },
      defaults: {
        owner: "alice",
        repo: "demo"
      }
    });

    try {
      const response = await client.callTool({
        name: GITS_PLATFORM_MCP_TOOL_CREATE_PULL_REQUEST,
        arguments: {
          title: "fix: handle missing mcp auth",
          body: "Closes #42",
          baseRef: "main",
          headRef: "fix/mcp-auth",
          closeIssueNumbers: [42]
        }
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8787/api/repos/alice/demo/pulls",
        expect.objectContaining({
          method: "POST",
          headers: expect.any(Headers),
          body: JSON.stringify({
            title: "fix: handle missing mcp auth",
            body: "Closes #42",
            baseRef: "main",
            headRef: "fix/mcp-auth",
            closeIssueNumbers: [42]
          }),
          signal: expect.any(AbortSignal)
        })
      );
      const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
      expect(new Headers(requestHeaders).get("cookie")).toBe("session=test");
      expect(response.isError).toBeFalsy();
      expect(response.content).toEqual([
        {
          type: "text",
          text: '{"pullRequest":{"number":7}}'
        }
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
