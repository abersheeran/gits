import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

export const GITS_PLATFORM_MCP_TOOL_ISSUE_REPLY = "gits_issue_reply";
export const GITS_PLATFORM_MCP_TOOL_CREATE_PULL_REQUEST = "gits_create_pull_request";

type ApiResponse = {
  status: number;
  bodyText: string;
};

type PlatformMcpDefaults = {
  owner?: string | null;
  repo?: string | null;
  issueNumber?: number | null;
};

type CreatePlatformMcpServerInput = {
  apiBaseUrl: string;
  forwardedHeaders?: HeadersInit;
  defaults?: PlatformMcpDefaults;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  const normalized = apiBaseUrl.trim();
  if (!normalized) {
    throw new Error("Platform MCP server requires a non-empty API base URL.");
  }
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function resolveRepository(
  input: { owner?: string | undefined; repo?: string | undefined },
  defaults: PlatformMcpDefaults
): { owner: string; repo: string } {
  const owner = normalizeText(input.owner) ?? normalizeText(defaults.owner);
  const repo = normalizeText(input.repo) ?? normalizeText(defaults.repo);
  if (!owner || !repo) {
    throw new Error("Missing repository context. Provide owner/repo in tool args or MCP URL defaults.");
  }
  return { owner, repo };
}

function resolveIssueNumber(
  issueNumber: number | undefined,
  defaults: PlatformMcpDefaults
): number {
  const resolved = normalizePositiveInteger(issueNumber) ?? normalizePositiveInteger(defaults.issueNumber);
  if (!resolved) {
    throw new Error("Missing issue number. Provide issueNumber in tool args or MCP URL defaults.");
  }
  return resolved;
}

async function postJson(input: {
  apiBaseUrl: string;
  path: string;
  forwardedHeaders?: HeadersInit | undefined;
  body: unknown;
}): Promise<ApiResponse> {
  const headers = new Headers(input.forwardedHeaders);
  headers.set("content-type", "application/json");

  const response = await fetch(`${input.apiBaseUrl}${input.path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  });

  return {
    status: response.status,
    bodyText: await response.text()
  };
}

function buildErrorResult(message: string): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}

function buildTextResult(text: string) {
  return {
    content: [{ type: "text" as const, text }]
  };
}

export function collectPlatformMcpForwardHeaders(source: Headers): Headers {
  const headers = new Headers();
  const authorization = normalizeText(source.get("authorization"));
  const cookie = normalizeText(source.get("cookie"));
  if (authorization) {
    headers.set("authorization", authorization);
  }
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return headers;
}

export function createPlatformMcpServer(input: CreatePlatformMcpServerInput): McpServer {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const defaults: PlatformMcpDefaults = {
    owner: normalizeText(input.defaults?.owner),
    repo: normalizeText(input.defaults?.repo),
    issueNumber: normalizePositiveInteger(input.defaults?.issueNumber)
  };

  const server = new McpServer({
    name: "gits-platform-api",
    version: "1.0.0"
  });

  server.registerTool(
    GITS_PLATFORM_MCP_TOOL_ISSUE_REPLY,
    {
      description: "Reply to a repository issue by creating a comment through the Gits platform API.",
      inputSchema: {
        body: z.string().min(1).describe("Issue comment body"),
        issueNumber: z.number().int().positive().optional().describe("Issue number, e.g. 123"),
        owner: z.string().min(1).optional().describe("Repository owner username"),
        repo: z.string().min(1).optional().describe("Repository name")
      }
    },
    async ({ body, issueNumber, owner, repo }) => {
      try {
        const repository = resolveRepository({ owner, repo }, defaults);
        const resolvedIssueNumber = resolveIssueNumber(issueNumber, defaults);
        const response = await postJson({
          apiBaseUrl,
          path: `/api/repos/${repository.owner}/${repository.repo}/issues/${resolvedIssueNumber}/comments`,
          forwardedHeaders: input.forwardedHeaders,
          body: { body }
        });

        if (response.status < 200 || response.status >= 300) {
          return buildErrorResult(
            `Issue reply failed with HTTP ${response.status}: ${response.bodyText || "(empty response)"}`
          );
        }

        return buildTextResult(response.bodyText || `Created comment on issue #${resolvedIssueNumber}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResult(`Issue reply failed: ${message}`);
      }
    }
  );

  server.registerTool(
    GITS_PLATFORM_MCP_TOOL_CREATE_PULL_REQUEST,
    {
      description: "Create a pull request through the Gits platform API, optionally linking closing issues.",
      inputSchema: {
        title: z.string().min(1).describe("Pull request title"),
        body: z.string().optional().describe("Pull request body"),
        baseRef: z.string().min(1).describe("Base branch name, e.g. main"),
        headRef: z.string().min(1).describe("Head branch name, e.g. fix/issue-123"),
        closeIssueNumbers: z.array(z.number().int().positive()).optional(),
        owner: z.string().min(1).optional().describe("Repository owner username"),
        repo: z.string().min(1).optional().describe("Repository name")
      }
    },
    async ({ title, body, baseRef, headRef, closeIssueNumbers, owner, repo }) => {
      try {
        const repository = resolveRepository({ owner, repo }, defaults);
        const response = await postJson({
          apiBaseUrl,
          path: `/api/repos/${repository.owner}/${repository.repo}/pulls`,
          forwardedHeaders: input.forwardedHeaders,
          body: {
            title,
            ...(body !== undefined ? { body } : {}),
            baseRef,
            headRef,
            ...(closeIssueNumbers ? { closeIssueNumbers } : {})
          }
        });

        if (response.status < 200 || response.status >= 300) {
          return buildErrorResult(
            `Create pull request failed with HTTP ${response.status}: ${response.bodyText || "(empty response)"}`
          );
        }

        return buildTextResult(response.bodyText || `Created pull request ${headRef} -> ${baseRef}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return buildErrorResult(`Create pull request failed: ${message}`);
      }
    }
  );

  return server;
}
