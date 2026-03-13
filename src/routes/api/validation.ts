import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mustSessionUser, optionalSession, requireSession } from "../../middleware/auth";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../../services/action-runner-prompt-tokens";
import {
  containsActionsMention,
  scheduleActionRunExecution,
  triggerInteractiveAgentSession,
  triggerActionWorkflows,
  triggerMentionActionRun
} from "../../services/action-trigger-service";
import { ACTION_CONTAINER_INSTANCE_TYPES } from "../../services/action-container-instance-types";
import { ActionLogStorageService } from "../../services/action-log-storage-service";
import { AgentSessionService } from "../../services/agent-session-service";
import { buildAgentSessionValidationSummary } from "../../services/agent-session-validation-summary";
import { ActionsService } from "../../services/actions-service";
import { AuthService } from "../../services/auth-service";
import { RepositoryMetadataService } from "../../services/repository-metadata-service";
import {
  collectPlatformMcpForwardHeaders,
  createPlatformMcpServer
} from "../../services/platform-mcp-service";
import {
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError,
  type RepositoryCompareResult,
  type RepositoryDiffHunk
} from "../../services/repository-browser-service";
import { IssueService, type IssueListState } from "../../services/issue-service";
import {
  PullRequestMergeBranchNotFoundError,
  PullRequestMergeConflictError,
  PullRequestMergeNotSupportedError
} from "../../services/pull-request-merge-service";
import {
  DuplicateOpenPullRequestError,
  PullRequestService,
  type PullRequestListState
} from "../../services/pull-request-service";
import { enrichPullRequestReviewThreads } from "../../services/pull-request-review-thread-anchor-service";
import { createRepositoryObjectClient } from "../../services/repository-object";
import { RepositoryService } from "../../services/repository-service";
import { WorkflowTaskFlowService } from "../../services/workflow-task-flow-service";
import type {
  ActionAgentType,
  ActionContainerInstanceType,
  ActionWorkflowTrigger,
  AgentSessionExecutionSourceType,
  AgentSessionRecord,
  AgentSessionSourceType,
  AppEnv,
  IssueCommentRecord,
  IssueRecord,
  IssueState,
  IssueTaskStatus,
  PullRequestReviewDecision,
  PullRequestReviewThreadRecord,
  PullRequestReviewThreadSide,
  PullRequestState,
  RepositoryRecord
} from "../../types";


export type RegisterInput = {
  username: string;
  email: string;
  password: string;
};

export type LoginInput = {
  usernameOrEmail: string;
  password: string;
};

export type CreateRepoInput = {
  name: string;
  description?: string;
  isPrivate?: boolean;
};

export type CreateTokenInput = {
  name: string;
  expiresAt?: number;
};

export type CreateIssueInput = {
  title: string;
  body?: string;
  acceptanceCriteria?: string;
  assigneeUserIds?: string[];
};

export type UpdateIssueInput = {
  title?: string;
  body?: string;
  state?: IssueState;
  taskStatus?: IssueTaskStatus;
  acceptanceCriteria?: string;
  assigneeUserIds?: string[];
};

export type CreateIssueCommentInput = {
  body: string;
};

export type CreatePullRequestInput = {
  title: string;
  body?: string;
  baseRef: string;
  headRef: string;
  closeIssueNumbers?: number[];
  draft?: boolean;
  assigneeUserIds?: string[];
  requestedReviewerIds?: string[];
};

export type UpdatePullRequestInput = {
  title?: string;
  body?: string;
  state?: PullRequestState;
  closeIssueNumbers?: number[];
  draft?: boolean;
  assigneeUserIds?: string[];
  requestedReviewerIds?: string[];
};

export type CreatePullRequestReviewInput = {
  decision: PullRequestReviewDecision;
  body?: string;
};

export type CreatePullRequestReviewThreadInput = {
  path: string;
  baseOid: string;
  headOid: string;
  startSide: PullRequestReviewThreadSide;
  startLine: number;
  endSide: PullRequestReviewThreadSide;
  endLine: number;
  hunkHeader: string;
  body?: string;
  suggestedCode?: string;
};

export type CreatePullRequestReviewThreadCommentInput = {
  body?: string;
  suggestedCode?: string;
};

export type CreateActionWorkflowInput = {
  name: string;
  triggerEvent: ActionWorkflowTrigger;
  agentType: ActionAgentType;
  prompt: string;
  pushBranchRegex?: string | null;
  pushTagRegex?: string | null;
  enabled?: boolean;
};

export type UpdateActionWorkflowInput = {
  name?: string;
  triggerEvent?: ActionWorkflowTrigger;
  agentType?: ActionAgentType;
  prompt?: string;
  pushBranchRegex?: string | null;
  pushTagRegex?: string | null;
  enabled?: boolean;
};

export type DispatchActionWorkflowInput = {
  ref?: string;
  sha?: string;
};

export type UpdateActionsGlobalConfigInput = {
  codexConfigFileContent?: string | null;
  claudeCodeConfigFileContent?: string | null;
};

export type UpdateRepositoryActionsConfigInput = {
  instanceType?: ActionContainerInstanceType | null;
  codexConfigFileContent?: string | null;
  claudeCodeConfigFileContent?: string | null;
};

export type TriggerRepositoryAgentInput = {
  agentType?: ActionAgentType;
  prompt?: string;
  threadId?: string;
};

export const USERNAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,30}[A-Za-z0-9])?$/;
export const REPO_NAME_REGEX = /^[A-Za-z0-9._-]{1,100}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const COMMIT_OID_REGEX = /^[0-9a-f]{40}$/i;
export const MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH = 120_000;
export const RESERVED_USERNAMES = new Set(["actions"]);

export async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON payload" });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HTTPException(400, { message: "JSON body must be an object" });
  }
  return parsed as Record<string, unknown>;
}

export function assertString(
  value: unknown,
  field: string,
  options?: { trim?: boolean }
): string {
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' is required` });
  }
  const trim = options?.trim ?? true;
  const normalized = trim ? value.trim() : value;
  if (!normalized) {
    throw new HTTPException(400, { message: `Field '${field}' is required` });
  }
  return normalized;
}

export function assertOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new HTTPException(400, { message: `Field '${field}' must be a boolean` });
  }
  return value;
}

export function assertOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string` });
  }
  return value.trim();
}

export function assertOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HTTPException(400, { message: `Field '${field}' must be an array` });
  }
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new HTTPException(400, {
        message: `Field '${field}' must contain non-empty strings`
      });
    }
    values.push(item.trim());
  }
  return Array.from(new Set(values));
}

export function assertOptionalNullablePositiveInteger(
  value: unknown,
  field: string
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new HTTPException(400, {
      message: `Field '${field}' must be a positive integer or null`
    });
  }
  return Number(value);
}

export function assertOptionalHexColor(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
    throw new HTTPException(400, {
      message: `Field '${field}' must be a 6-digit hex color`
    });
  }
  const normalized = value.trim();
  return normalized.startsWith("#") ? normalized.toLowerCase() : `#${normalized.toLowerCase()}`;
}

export function assertUsername(value: string): void {
  if (!USERNAME_REGEX.test(value)) {
    throw new HTTPException(400, {
      message:
        "Invalid username. Use letters/numbers and ._- only, length 1-32, no leading/trailing punctuation."
    });
  }
  if (RESERVED_USERNAMES.has(value.toLowerCase())) {
    throw new HTTPException(400, {
      message: "This username is reserved"
    });
  }
}

export function assertRepositoryName(value: string): void {
  if (!REPO_NAME_REGEX.test(value) || value.endsWith(".git")) {
    throw new HTTPException(400, {
      message: "Invalid repository name. Use letters/numbers and ._- only, length 1-100."
    });
  }
}

export function assertEmail(value: string): void {
  if (!EMAIL_REGEX.test(value)) {
    throw new HTTPException(400, { message: "Invalid email format" });
  }
}

export function parseLimit(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.min(Math.max(parsed, 1), 100);
}

export function parsePage(value: string | undefined): number {
  if (!value) {
    return 1;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(parsed, 1);
}

export function assertCollaboratorPermission(value: unknown): "read" | "write" | "admin" {
  const permission = assertString(value, "permission");
  if (permission !== "read" && permission !== "write" && permission !== "admin") {
    throw new HTTPException(400, {
      message: "Field 'permission' must be one of: read, write, admin"
    });
  }
  return permission;
}

export function parseIssueListState(value: string | undefined): IssueListState {
  if (!value || value === "open") {
    return "open";
  }
  if (value === "closed" || value === "all") {
    return value;
  }
  throw new HTTPException(400, {
    message: "Query 'state' must be one of: open, closed, all"
  });
}

export function assertIssueState(value: unknown): IssueState {
  const state = assertString(value, "state");
  if (state !== "open" && state !== "closed") {
    throw new HTTPException(400, {
      message: "Field 'state' must be one of: open, closed"
    });
  }
  return state;
}

export function assertIssueTaskStatus(value: unknown): IssueTaskStatus {
  const taskStatus = assertString(value, "taskStatus");
  if (
    taskStatus !== "open" &&
    taskStatus !== "agent-working" &&
    taskStatus !== "waiting-human" &&
    taskStatus !== "done"
  ) {
    throw new HTTPException(400, {
      message:
        "Field 'taskStatus' must be one of: open, agent-working, waiting-human, done"
    });
  }
  return taskStatus;
}

export function parsePullRequestListState(value: string | undefined): PullRequestListState {
  if (!value || value === "open") {
    return "open";
  }
  if (value === "closed" || value === "merged" || value === "all") {
    return value;
  }
  throw new HTTPException(400, {
    message: "Query 'state' must be one of: open, closed, merged, all"
  });
}

export function assertPullRequestState(value: unknown): PullRequestState {
  const state = assertString(value, "state");
  if (state !== "open" && state !== "closed" && state !== "merged") {
    throw new HTTPException(400, {
      message: "Field 'state' must be one of: open, closed, merged"
    });
  }
  return state;
}

export function assertPullRequestReviewDecision(value: unknown): PullRequestReviewDecision {
  const decision = assertString(value, "decision");
  if (decision !== "comment" && decision !== "approve" && decision !== "request_changes") {
    throw new HTTPException(400, {
      message: "Field 'decision' must be one of: comment, approve, request_changes"
    });
  }
  return decision;
}

export function assertPullRequestReviewThreadSide(value: unknown): PullRequestReviewThreadSide {
  const side = assertString(value, "side");
  if (side !== "base" && side !== "head") {
    throw new HTTPException(400, {
      message: "Field 'side' must be one of: base, head"
    });
  }
  return side;
}

export function assertActionWorkflowTrigger(value: unknown, field: string): ActionWorkflowTrigger {
  const triggerEvent = assertString(value, field);
  if (
    triggerEvent !== "push" &&
    triggerEvent !== "issue_created" &&
    triggerEvent !== "pull_request_created"
  ) {
    throw new HTTPException(400, {
      message: `Field '${field}' must be one of: issue_created, pull_request_created, push`
    });
  }
  return triggerEvent;
}

export function assertActionAgentType(value: unknown, field: string): ActionAgentType {
  const agentType = assertString(value, field);
  if (agentType !== "codex" && agentType !== "claude_code") {
    throw new HTTPException(400, {
      message: `Field '${field}' must be one of: codex, claude_code`
    });
  }
  return agentType;
}

export function assertActionContainerInstanceType(
  value: unknown,
  field: string
): ActionContainerInstanceType {
  if (
    typeof value !== "string" ||
    !ACTION_CONTAINER_INSTANCE_TYPES.includes(value as ActionContainerInstanceType)
  ) {
    throw new HTTPException(400, {
      message: `Field '${field}' must be one of: ${ACTION_CONTAINER_INSTANCE_TYPES.join(", ")}`
    });
  }
  return value as ActionContainerInstanceType;
}

export function assertAgentSessionSourceType(value: string | undefined): AgentSessionSourceType {
  if (value === "issue" || value === "pull_request" || value === "manual") {
    return value;
  }
  throw new HTTPException(400, {
    message: "Query 'sourceType' must be one of: issue, pull_request, manual"
  });
}

export function parseAgentSessionSourceNumbers(value: string | undefined): number[] {
  if (!value) {
    throw new HTTPException(400, { message: "Query 'numbers' is required" });
  }
  const numbers: number[] = [];
  for (const rawPart of value.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    const parsed = Number.parseInt(part, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new HTTPException(400, {
        message: "Query 'numbers' must be a comma-separated list of positive integers"
      });
    }
    numbers.push(parsed);
  }
  if (numbers.length === 0) {
    throw new HTTPException(400, { message: "Query 'numbers' must not be empty" });
  }
  return Array.from(new Set(numbers)).slice(0, 100).sort((a, b) => a - b);
}

export function parseAgentSessionCommentIds(value: string | undefined): string[] {
  if (!value) {
    throw new HTTPException(400, { message: "Query 'commentIds' is required" });
  }
  const ids: string[] = [];
  for (const rawPart of value.split(",")) {
    const id = rawPart.trim();
    if (!id) {
      continue;
    }
    ids.push(id);
  }
  if (ids.length === 0) {
    throw new HTTPException(400, { message: "Query 'commentIds' must not be empty" });
  }
  return Array.from(new Set(ids)).slice(0, 100);
}

export function assertOptionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string or null` });
  }
  return value.trim();
}

export function assertOptionalNullableRawString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string or null` });
  }
  return value;
}

export function assertOptionalRegexPattern(value: unknown, field: string): string | null | undefined {
  const normalized = assertOptionalNullableString(value, field);
  if (normalized === undefined || normalized === null || normalized.length === 0) {
    return normalized ?? null;
  }
  try {
    // Validate regex syntax early so invalid patterns fail fast at workflow creation/update.
    // eslint-disable-next-line no-new
    new RegExp(normalized);
  } catch {
    throw new HTTPException(400, {
      message: `Field '${field}' must be a valid regular expression pattern`
    });
  }
  return normalized;
}

export function assertPositiveInteger(value: string, field: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HTTPException(400, { message: `Field '${field}' must be a positive integer` });
  }
  return parsed;
}

export function assertPositiveIntegerInput(value: unknown, field: string): number {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    throw new HTTPException(400, { message: `Field '${field}' must be a positive integer` });
  }

  if (typeof value === "string") {
    return assertPositiveInteger(value, field);
  }

  throw new HTTPException(400, { message: `Field '${field}' must be a positive integer` });
}

export function assertCommitOid(value: unknown, field: string): string {
  const oid = assertString(value, field);
  if (!COMMIT_OID_REGEX.test(oid)) {
    throw new HTTPException(400, { message: `Field '${field}' must be a 40-character commit oid` });
  }
  return oid.toLowerCase();
}

export function assertOptionalSuggestedCode(value: unknown): string | undefined {
  const normalized = assertOptionalString(value, "suggestedCode");
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  return normalized;
}

export function buildPullRequestReviewThreadSuggestion(args: {
  side: PullRequestReviewThreadSide;
  startLine: number;
  endLine: number;
  suggestedCode?: string;
}) {
  if (!args.suggestedCode) {
    return null;
  }
  if (args.side !== "head") {
    throw new HTTPException(400, {
      message: "Suggested changes are only supported for head-side diff ranges"
    });
  }
  return {
    side: args.side,
    start_line: args.startLine,
    end_line: args.endLine,
    code: args.suggestedCode
  };
}

export function getDiffLineNumberForSide(
  line: RepositoryDiffHunk["lines"][number],
  side: PullRequestReviewThreadSide
): number | null {
  return side === "base" ? line.oldLineNumber : line.newLineNumber;
}

export function assertDiffBoundPullRequestThreadInput(args: {
  comparison: RepositoryCompareResult;
  input: CreatePullRequestReviewThreadInput;
}): { line: number; side: PullRequestReviewThreadSide } {
  if (args.input.startSide !== args.input.endSide) {
    throw new HTTPException(400, {
      message: "Review thread ranges must stay on one diff side for this iteration"
    });
  }
  if (args.input.endLine < args.input.startLine) {
    throw new HTTPException(400, {
      message: "Field 'endLine' must be greater than or equal to 'startLine'"
    });
  }

  const compareBaseOid = args.comparison.mergeBaseOid ?? args.comparison.baseOid;
  if (args.input.baseOid !== compareBaseOid || args.input.headOid !== args.comparison.headOid) {
    throw new HTTPException(409, {
      message: "Pull request diff range is stale. Reload the compare view and try again."
    });
  }

  const change = args.comparison.changes.find((item) => item.path === args.input.path);
  if (!change) {
    throw new HTTPException(400, { message: "Review thread path is not part of the current diff" });
  }

  const hunk = change.hunks.find((item) => item.header === args.input.hunkHeader);
  if (!hunk) {
    throw new HTTPException(400, {
      message: "Review thread hunk is not part of the current diff"
    });
  }

  const selectedLines = hunk.lines.filter((line) => {
    if (line.kind === "meta") {
      return false;
    }
    const lineNumber = getDiffLineNumberForSide(line, args.input.startSide);
    return (
      lineNumber !== null &&
      lineNumber >= args.input.startLine &&
      lineNumber <= args.input.endLine
    );
  });

  if (selectedLines.length !== args.input.endLine - args.input.startLine + 1) {
    throw new HTTPException(400, {
      message: "Review thread range must map to a contiguous block within one diff hunk"
    });
  }

  return {
    line: args.input.startLine,
    side: args.input.startSide
  };
}

export function assertOptionalIssueNumberArray(value: unknown, field: string): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HTTPException(400, { message: `Field '${field}' must be an array` });
  }
  const numbers: number[] = [];
  for (const item of value) {
    if (!Number.isInteger(item) || item <= 0) {
      throw new HTTPException(400, {
        message: `Field '${field}' must contain positive integers`
      });
    }
    numbers.push(item);
  }
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

export function normalizeBranchRef(value: unknown, field: string): string {
  const branch = assertString(value, field);
  if (branch.startsWith("refs/heads/")) {
    return branch;
  }
  if (branch.startsWith("refs/")) {
    throw new HTTPException(400, {
      message: `Field '${field}' must be a branch name or refs/heads/*`
    });
  }
  return `refs/heads/${branch}`;
}

export function getOptionalExecutionCtx(source: { executionCtx?: unknown }): ExecutionContext | undefined {
  let executionCtx: unknown;
  try {
    executionCtx = source.executionCtx;
  } catch {
    return undefined;
  }
  if (!executionCtx || typeof executionCtx !== "object") {
    return undefined;
  }
  return executionCtx as ExecutionContext;
}

export function executionCtxArg(source: {
  executionCtx?: unknown;
}): { executionCtx: ExecutionContext } | Record<string, never> {
  const executionCtx = getOptionalExecutionCtx(source);
  return executionCtx ? { executionCtx } : {};
}
