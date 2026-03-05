import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

type ApiResponse = {
  status: number;
  bodyText: string;
};

const TOOL_NAME_ISSUE_REPLY = "gits_issue_reply";
const TOOL_NAME_CREATE_PR = "gits_create_pull_request";
const DEFAULT_TIMEOUT_MS = 15_000;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim() ?? "";
  return value ? value : null;
}

function parseOptionalPositiveInt(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function resolveRepository(input: { owner?: string; repo?: string }): { owner: string; repo: string } {
  const defaultOwner = readOptionalEnv("GITS_REPOSITORY_OWNER");
  const defaultRepo = readOptionalEnv("GITS_REPOSITORY_NAME");

  const owner = input.owner?.trim() || defaultOwner;
  const repo = input.repo?.trim() || defaultRepo;
  if (!owner || !repo) {
    throw new Error(
      "Missing repository context. Provide owner/repo in tool args or set GITS_REPOSITORY_OWNER and GITS_REPOSITORY_NAME"
    );
  }
  return { owner, repo };
}

async function postJson(input: {
  apiBaseUrl: string;
  path: string;
  token: string;
  body: unknown;
}): Promise<ApiResponse> {
  const normalizedBase = input.apiBaseUrl.endsWith("/")
    ? input.apiBaseUrl.slice(0, -1)
    : input.apiBaseUrl;
  const url = `${normalizedBase}${input.path}`;

  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input.body),
    signal: timeoutSignal
  });

  const bodyText = await response.text();

  return {
    status: response.status,
    bodyText
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

async function main(): Promise<void> {
  const apiBaseUrl = readRequiredEnv("GITS_PLATFORM_API_BASE");
  const issueReplyToken = readOptionalEnv("GITS_ISSUE_REPLY_TOKEN");
  const prCreateToken = readOptionalEnv("GITS_PR_CREATE_TOKEN");
  const defaultIssueNumber = parseOptionalPositiveInt(readOptionalEnv("GITS_TRIGGER_ISSUE_NUMBER"));

  const server = new McpServer({
    name: "gits-platform-api",
    version: "1.0.0"
  });

  if (issueReplyToken) {
    server.registerTool(
      TOOL_NAME_ISSUE_REPLY,
      {
        description:
          "Reply to a repository issue by creating a comment through the Gits platform API.",
        inputSchema: {
          body: z.string().min(1).describe("Issue comment body"),
          issueNumber: z.number().int().positive().optional().describe("Issue number, e.g. 123"),
          owner: z.string().min(1).optional().describe("Repository owner username"),
          repo: z.string().min(1).optional().describe("Repository name")
        }
      },
      async ({ body, issueNumber, owner, repo }) => {
        try {
          const repository = resolveRepository({ owner, repo });
          const resolvedIssueNumber = issueNumber ?? defaultIssueNumber;
          if (!resolvedIssueNumber) {
            return buildErrorResult(
              "Missing issue number. Provide issueNumber in args or set GITS_TRIGGER_ISSUE_NUMBER."
            );
          }

          const response = await postJson({
            apiBaseUrl,
            path: `/api/repos/${repository.owner}/${repository.repo}/issues/${resolvedIssueNumber}/comments`,
            token: issueReplyToken,
            body: { body }
          });

          if (response.status < 200 || response.status >= 300) {
            return buildErrorResult(
              `Issue reply failed with HTTP ${response.status}: ${response.bodyText || "(empty response)"}`
            );
          }

          return {
            content: [
              {
                type: "text" as const,
                text: response.bodyText || `Created comment on issue #${resolvedIssueNumber}`
              }
            ]
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return buildErrorResult(`Issue reply failed: ${message}`);
        }
      }
    );
  }

  if (prCreateToken) {
    server.registerTool(
      TOOL_NAME_CREATE_PR,
      {
        description:
          "Create a pull request through the Gits platform API, optionally linking closing issues.",
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
          const repository = resolveRepository({ owner, repo });
          const response = await postJson({
            apiBaseUrl,
            path: `/api/repos/${repository.owner}/${repository.repo}/pulls`,
            token: prCreateToken,
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

          return {
            content: [
              {
                type: "text" as const,
                text: response.bodyText || `Created pull request ${headRef} -> ${baseRef}`
              }
            ]
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return buildErrorResult(`Create pull request failed: ${message}`);
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`gits-platform-mcp server failed: ${message}`);
  process.exit(1);
});
