import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { mustSessionUser, optionalSession, requireSession } from "../middleware/auth";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../services/action-runner-prompt-tokens";
import { buildActionRunLifecycleLines } from "../services/action-run-log-format";
import {
  containsActionsMention,
  createLinkedAgentSessionForRun,
  scheduleActionRunExecution,
  triggerInteractiveAgentSession,
  triggerActionWorkflows,
  triggerMentionActionRun
} from "../services/action-trigger-service";
import {
  ACTION_CONTAINER_INSTANCE_TYPES,
  getActionRunnerNamespace
} from "../services/action-container-instance-types";
import { AgentSessionService } from "../services/agent-session-service";
import { ActionsService } from "../services/actions-service";
import { AuthService } from "../services/auth-service";
import { RepositoryMetadataService } from "../services/repository-metadata-service";
import {
  RepositoryBrowserService,
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError,
  type RepositoryCompareResult,
  type RepositoryDiffHunk
} from "../services/repository-browser-service";
import { IssueService, type IssueListState } from "../services/issue-service";
import {
  PullRequestMergeBranchNotFoundError,
  PullRequestMergeConflictError,
  PullRequestMergeNotSupportedError,
  PullRequestMergeService
} from "../services/pull-request-merge-service";
import {
  DuplicateOpenPullRequestError,
  PullRequestService,
  type PullRequestListState
} from "../services/pull-request-service";
import { RepositoryService } from "../services/repository-service";
import { StorageService } from "../services/storage-service";
import type {
  ActionAgentType,
  ActionContainerInstanceType,
  ActionRunRecord,
  ActionRunSourceType,
  ActionWorkflowTrigger,
  AgentSessionRecord,
  AgentSessionSourceType,
  AppEnv,
  IssueCommentRecord,
  IssueState,
  IssueTaskStatus,
  MilestoneState,
  PullRequestReviewDecision,
  PullRequestReviewThreadRecord,
  PullRequestReviewThreadSide,
  PullRequestState,
  ReactionContent,
  ReactionSubjectType,
  RepositoryRecord
} from "../types";

type RegisterInput = {
  username: string;
  email: string;
  password: string;
};

type LoginInput = {
  usernameOrEmail: string;
  password: string;
};

type CreateRepoInput = {
  name: string;
  description?: string;
  isPrivate?: boolean;
};

type CreateTokenInput = {
  name: string;
  expiresAt?: number;
};

type CreateIssueInput = {
  title: string;
  body?: string;
  acceptanceCriteria?: string;
  labelIds?: string[];
  assigneeUserIds?: string[];
  milestoneId?: string | null;
};

type UpdateIssueInput = {
  title?: string;
  body?: string;
  state?: IssueState;
  taskStatus?: IssueTaskStatus;
  acceptanceCriteria?: string;
  labelIds?: string[];
  assigneeUserIds?: string[];
  milestoneId?: string | null;
};

type CreateIssueCommentInput = {
  body: string;
};

type CreatePullRequestInput = {
  title: string;
  body?: string;
  baseRef: string;
  headRef: string;
  closeIssueNumbers?: number[];
  draft?: boolean;
  labelIds?: string[];
  assigneeUserIds?: string[];
  requestedReviewerIds?: string[];
  milestoneId?: string | null;
};

type UpdatePullRequestInput = {
  title?: string;
  body?: string;
  state?: PullRequestState;
  closeIssueNumbers?: number[];
  draft?: boolean;
  labelIds?: string[];
  assigneeUserIds?: string[];
  requestedReviewerIds?: string[];
  milestoneId?: string | null;
};

type CreatePullRequestReviewInput = {
  decision: PullRequestReviewDecision;
  body?: string;
};

type CreatePullRequestReviewThreadInput = {
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

type CreatePullRequestReviewThreadCommentInput = {
  body?: string;
  suggestedCode?: string;
};

type CreateActionWorkflowInput = {
  name: string;
  triggerEvent: ActionWorkflowTrigger;
  agentType: ActionAgentType;
  prompt: string;
  pushBranchRegex?: string | null;
  pushTagRegex?: string | null;
  enabled?: boolean;
};

type UpdateActionWorkflowInput = {
  name?: string;
  triggerEvent?: ActionWorkflowTrigger;
  agentType?: ActionAgentType;
  prompt?: string;
  pushBranchRegex?: string | null;
  pushTagRegex?: string | null;
  enabled?: boolean;
};

type DispatchActionWorkflowInput = {
  ref?: string;
  sha?: string;
};

type UpdateActionsGlobalConfigInput = {
  codexConfigFileContent?: string | null;
  claudeCodeConfigFileContent?: string | null;
};

type UpdateRepositoryActionsConfigInput = {
  instanceType?: ActionContainerInstanceType | null;
  codexConfigFileContent?: string | null;
  claudeCodeConfigFileContent?: string | null;
};

type TriggerRepositoryAgentInput = {
  agentType?: ActionAgentType;
  prompt?: string;
  threadId?: string;
};

type CreateRepositoryLabelInput = {
  name: string;
  color: string;
  description?: string | null;
};

type UpdateRepositoryLabelInput = {
  name?: string;
  color?: string;
  description?: string | null;
};

type CreateRepositoryMilestoneInput = {
  title: string;
  description?: string;
  dueAt?: number | null;
};

type UpdateRepositoryMilestoneInput = {
  title?: string;
  description?: string;
  dueAt?: number | null;
  state?: MilestoneState;
};

const USERNAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,30}[A-Za-z0-9])?$/;
const REPO_NAME_REGEX = /^[A-Za-z0-9._-]{1,100}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMIT_OID_REGEX = /^[0-9a-f]{40}$/i;
const MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH = 120_000;
const RESERVED_USERNAMES = new Set(["actions"]);

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
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

function assertString(
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

function assertOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new HTTPException(400, { message: `Field '${field}' must be a boolean` });
  }
  return value;
}

function assertOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string` });
  }
  return value.trim();
}

function assertOptionalStringArray(value: unknown, field: string): string[] | undefined {
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

function assertOptionalNullablePositiveInteger(
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

function assertOptionalHexColor(value: unknown, field: string): string | undefined {
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

function assertMilestoneState(value: unknown): MilestoneState {
  const state = assertString(value, "state");
  if (state !== "open" && state !== "closed") {
    throw new HTTPException(400, {
      message: "Field 'state' must be one of: open, closed"
    });
  }
  return state;
}

function assertReactionContent(value: unknown): ReactionContent {
  const content = assertString(value, "content");
  if (
    content !== "+1" &&
    content !== "-1" &&
    content !== "laugh" &&
    content !== "hooray" &&
    content !== "confused" &&
    content !== "heart" &&
    content !== "rocket" &&
    content !== "eyes"
  ) {
    throw new HTTPException(400, {
      message:
        "Field 'content' must be one of: +1, -1, laugh, hooray, confused, heart, rocket, eyes"
    });
  }
  return content;
}

function assertReactionSubjectType(value: unknown): ReactionSubjectType {
  const subjectType = assertString(value, "subjectType");
  if (
    subjectType !== "issue" &&
    subjectType !== "issue_comment" &&
    subjectType !== "pull_request" &&
    subjectType !== "pull_request_review"
  ) {
    throw new HTTPException(400, {
      message:
        "Field 'subjectType' must be one of: issue, issue_comment, pull_request, pull_request_review"
    });
  }
  return subjectType;
}

function assertUsername(value: string): void {
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

function assertRepositoryName(value: string): void {
  if (!REPO_NAME_REGEX.test(value) || value.endsWith(".git")) {
    throw new HTTPException(400, {
      message: "Invalid repository name. Use letters/numbers and ._- only, length 1-100."
    });
  }
}

function assertEmail(value: string): void {
  if (!EMAIL_REGEX.test(value)) {
    throw new HTTPException(400, { message: "Invalid email format" });
  }
}

function parseLimit(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.min(Math.max(parsed, 1), 100);
}

function parsePage(value: string | undefined): number {
  if (!value) {
    return 1;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(parsed, 1);
}

function assertCollaboratorPermission(value: unknown): "read" | "write" | "admin" {
  const permission = assertString(value, "permission");
  if (permission !== "read" && permission !== "write" && permission !== "admin") {
    throw new HTTPException(400, {
      message: "Field 'permission' must be one of: read, write, admin"
    });
  }
  return permission;
}

function parseIssueListState(value: string | undefined): IssueListState {
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

function assertIssueState(value: unknown): IssueState {
  const state = assertString(value, "state");
  if (state !== "open" && state !== "closed") {
    throw new HTTPException(400, {
      message: "Field 'state' must be one of: open, closed"
    });
  }
  return state;
}

function assertIssueTaskStatus(value: unknown): IssueTaskStatus {
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

function parsePullRequestListState(value: string | undefined): PullRequestListState {
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

function assertPullRequestState(value: unknown): PullRequestState {
  const state = assertString(value, "state");
  if (state !== "open" && state !== "closed" && state !== "merged") {
    throw new HTTPException(400, {
      message: "Field 'state' must be one of: open, closed, merged"
    });
  }
  return state;
}

function assertPullRequestReviewDecision(value: unknown): PullRequestReviewDecision {
  const decision = assertString(value, "decision");
  if (decision !== "comment" && decision !== "approve" && decision !== "request_changes") {
    throw new HTTPException(400, {
      message: "Field 'decision' must be one of: comment, approve, request_changes"
    });
  }
  return decision;
}

function assertPullRequestReviewThreadSide(value: unknown): PullRequestReviewThreadSide {
  const side = assertString(value, "side");
  if (side !== "base" && side !== "head") {
    throw new HTTPException(400, {
      message: "Field 'side' must be one of: base, head"
    });
  }
  return side;
}

function assertActionWorkflowTrigger(value: unknown, field: string): ActionWorkflowTrigger {
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

function assertActionAgentType(value: unknown, field: string): ActionAgentType {
  const agentType = assertString(value, field);
  if (agentType !== "codex" && agentType !== "claude_code") {
    throw new HTTPException(400, {
      message: `Field '${field}' must be one of: codex, claude_code`
    });
  }
  return agentType;
}

function assertActionContainerInstanceType(
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

function assertActionRunSourceType(value: string | undefined): ActionRunSourceType {
  if (value === "issue" || value === "pull_request") {
    return value;
  }
  throw new HTTPException(400, {
    message: "Query 'sourceType' must be one of: issue, pull_request"
  });
}

function assertAgentSessionSourceType(value: string | undefined): AgentSessionSourceType {
  if (value === "issue" || value === "pull_request" || value === "manual") {
    return value;
  }
  throw new HTTPException(400, {
    message: "Query 'sourceType' must be one of: issue, pull_request, manual"
  });
}

function parseActionRunSourceNumbers(value: string | undefined): number[] {
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

function parseActionRunCommentIds(value: string | undefined): string[] {
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

function assertOptionalNullableString(value: unknown, field: string): string | null | undefined {
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

function assertOptionalNullableRawString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string or null` });
  }
  return value;
}

function assertOptionalRegexPattern(value: unknown, field: string): string | null | undefined {
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

function assertPositiveInteger(value: string, field: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HTTPException(400, { message: `Field '${field}' must be a positive integer` });
  }
  return parsed;
}

function assertPositiveIntegerInput(value: unknown, field: string): number {
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

function assertCommitOid(value: unknown, field: string): string {
  const oid = assertString(value, field);
  if (!COMMIT_OID_REGEX.test(oid)) {
    throw new HTTPException(400, { message: `Field '${field}' must be a 40-character commit oid` });
  }
  return oid.toLowerCase();
}

function assertOptionalSuggestedCode(value: unknown): string | undefined {
  const normalized = assertOptionalString(value, "suggestedCode");
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  return normalized;
}

function buildPullRequestReviewThreadSuggestion(args: {
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

function getDiffLineNumberForSide(
  line: RepositoryDiffHunk["lines"][number],
  side: PullRequestReviewThreadSide
): number | null {
  return side === "base" ? line.oldLineNumber : line.newLineNumber;
}

function assertDiffBoundPullRequestThreadInput(args: {
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

function assertOptionalIssueNumberArray(value: unknown, field: string): number[] | undefined {
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

function normalizeBranchRef(value: unknown, field: string): string {
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

function getOptionalExecutionCtx(source: { executionCtx?: unknown }): ExecutionContext | undefined {
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

function executionCtxArg(source: {
  executionCtx?: unknown;
}): { executionCtx: ExecutionContext } | Record<string, never> {
  const executionCtx = getOptionalExecutionCtx(source);
  return executionCtx ? { executionCtx } : {};
}

function buildMentionPrompt(input: { title: string; body: string }): string {
  if (!input.body.trim()) {
    return input.title;
  }
  return `${input.title}\n\n${input.body}`;
}

function buildIssueConversationHistory(input: {
  issueAuthorUsername: string;
  issueBody: string;
  issueAcceptanceCriteria: string;
  comments: readonly IssueCommentRecord[];
}): string {
  const sections: string[] = [];
  sections.push(`[Issue Description by @${input.issueAuthorUsername}]`);
  sections.push(input.issueBody.trim() ? input.issueBody : "(empty)");
  sections.push("");
  sections.push("[Acceptance Criteria]");
  const acceptanceCriteria = input.issueAcceptanceCriteria ?? "";
  sections.push(acceptanceCriteria.trim() ? acceptanceCriteria : "(none)");

  if (input.comments.length === 0) {
    sections.push("");
    sections.push("[Comments]");
    sections.push("(none)");
    return sections.join("\n");
  }

  sections.push("");
  sections.push("[Comments]");
  for (const comment of input.comments) {
    sections.push(`- comment_id: ${comment.id}`);
    sections.push(`  author: @${comment.author_username}`);
    sections.push("  body:");
    const body = comment.body.trim() ? comment.body : "(empty)";
    for (const line of body.split("\n")) {
      sections.push(`    ${line}`);
    }
  }
  return sections.join("\n");
}

function buildIssueCommentMentionPrompt(input: {
  issueNumber: number;
  issueTitle: string;
  issueConversationHistory: string;
}): string {
  return `Issue #${input.issueNumber}: ${input.issueTitle}\n\nFull conversation history:\n${input.issueConversationHistory}`;
}

function buildInteractiveIssueAgentPrompt(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  acceptanceCriteria: string;
  issueConversationHistory: string;
  reason: "assign" | "resume";
  instruction?: string;
}): string {
  const taskInstruction =
    input.instruction?.trim() ||
    "Review the issue, implement a fix if the request is actionable, push a branch, and open a pull request. If information is missing, reply with focused follow-up questions.";
  return [
    input.reason === "assign"
      ? "You are taking ownership of a repository issue."
      : "Continue the existing work for this repository issue.",
    `Repository: ${input.owner}/${input.repo}`,
    "[Acceptance Criteria]",
    input.acceptanceCriteria.trim() || "(none)",
    "",
    buildIssueCommentMentionPrompt({
      issueNumber: input.issueNumber,
      issueTitle: input.issueTitle,
      issueConversationHistory: input.issueConversationHistory
    }),
    "",
    "[Instruction]",
    taskInstruction
  ].join("\n");
}

function buildPullRequestReviewHistory(input: {
  reviews: ReadonlyArray<{
    reviewer_username: string;
    decision: PullRequestReviewDecision;
    body: string;
  }>;
}): string {
  if (input.reviews.length === 0) {
    return "(none)";
  }

  return input.reviews
    .map((review) => {
      const body = review.body.trim() || "(empty)";
      return [
        `- reviewer: @${review.reviewer_username}`,
        `  decision: ${review.decision}`,
        "  body:",
        ...body.split("\n").map((line) => `    ${line}`)
      ].join("\n");
    })
    .join("\n");
}

function buildPullRequestReviewThreadHistory(input: {
  threads: ReadonlyArray<
    Pick<
      PullRequestReviewThreadRecord,
      | "author_username"
      | "path"
      | "body"
      | "status"
      | "base_oid"
      | "head_oid"
      | "start_side"
      | "start_line"
      | "end_side"
      | "end_line"
      | "hunk_header"
      | "comments"
    >
  >;
}): string {
  if (input.threads.length === 0) {
    return "(none)";
  }

  return input.threads
    .map((thread) => {
      const anchorLabel =
        thread.start_line === thread.end_line && thread.start_side === thread.end_side
          ? `${thread.path}:${thread.start_line} (${thread.start_side})`
          : `${thread.path}:${thread.start_line}-${thread.end_line} (${thread.start_side})`;
      const sections = [
        `- status: ${thread.status}`,
        `  author: @${thread.author_username}`,
        `  location: ${anchorLabel}`
      ];
      if (thread.base_oid && thread.head_oid) {
        sections.push(`  compare_range: ${thread.base_oid}..${thread.head_oid}`);
      }
      if (thread.hunk_header) {
        sections.push(`  hunk: ${thread.hunk_header}`);
      }

      if (thread.comments.length === 0) {
        sections.push("  body:");
        sections.push(...(thread.body.trim() || "(empty)").split("\n").map((line) => `    ${line}`));
        return sections.join("\n");
      }

      sections.push("  comments:");
      for (const comment of thread.comments) {
        sections.push(`    - author: @${comment.author_username}`);
        sections.push("      body:");
        const body = comment.body.trim() || "(empty)";
        sections.push(...body.split("\n").map((line) => `        ${line}`));
        if (comment.suggestion) {
          sections.push(
            `      suggestion (${comment.suggestion.side} ${comment.suggestion.start_line}-${comment.suggestion.end_line}):`
          );
          sections.push(...comment.suggestion.code.split("\n").map((line) => `        ${line}`));
        }
      }
      return sections.join("\n");
    })
    .join("\n");
}

function buildInteractivePullRequestAgentPrompt(input: {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestTitle: string;
  pullRequestBody: string;
  baseRef: string;
  headRef: string;
  reviews: ReadonlyArray<{
    reviewer_username: string;
    decision: PullRequestReviewDecision;
    body: string;
  }>;
  reviewThreads: ReadonlyArray<PullRequestReviewThreadRecord>;
  focusedThread?: PullRequestReviewThreadRecord | null;
  instruction?: string;
}): string {
  const taskInstruction =
    input.instruction?.trim() ||
    (input.focusedThread
      ? "Resolve the focused review thread, update the pull request branch with the required changes, and keep the pull request intent intact."
      : "Review the feedback, update the pull request branch with the required changes, and preserve the existing intent of the pull request.");
  return [
    "Continue work on an existing pull request.",
    `Repository: ${input.owner}/${input.repo}`,
    `Pull request: #${input.pullRequestNumber} ${input.pullRequestTitle}`,
    `Base ref: ${input.baseRef}`,
    `Head ref: ${input.headRef}`,
    "",
    "[Pull Request Body]",
    input.pullRequestBody.trim() || "(empty)",
    "",
    "[Reviews]",
    buildPullRequestReviewHistory({ reviews: input.reviews }),
    "",
    "[Review Threads]",
    buildPullRequestReviewThreadHistory({ threads: input.reviewThreads }),
    "",
    ...(input.focusedThread
      ? [
          "[Focused Review Thread]",
          buildPullRequestReviewThreadHistory({
            threads: [input.focusedThread]
          }),
          ""
        ]
      : []),
    ...(input.focusedThread
      ? [
          "[Focus Requirement]",
          "Prioritize fixing the focused review thread first, then address other still-open review threads if they are directly related.",
          ""
        ]
      : []),
    "[Instruction]",
    taskInstruction
  ].join("\n");
}

async function resolveDefaultBranchTarget(
  storageService: StorageService,
  owner: string,
  repo: string
): Promise<{ ref: string | null; sha: string | null }> {
  let headRaw: string | null = null;
  let headRefs: Array<{ name: string; oid: string }> = [];
  try {
    [headRaw, headRefs] = await Promise.all([
      storageService.readHead(owner, repo),
      storageService.listHeadRefs(owner, repo)
    ]);
  } catch {
    return { ref: null, sha: null };
  }
  if (headRefs.length === 0) {
    return { ref: null, sha: null };
  }

  const headRef = headRaw?.startsWith("ref: ") ? headRaw.slice("ref: ".length).trim() : null;
  let selected = headRef ? headRefs.find((item) => item.name === headRef) : undefined;
  if (!selected) {
    selected = headRefs.find((item) => item.name === "refs/heads/main") ?? headRefs[0];
  }

  return {
    ref: selected?.name ?? null,
    sha: selected?.oid ?? null
  };
}

function buildIssueCreatedAgentPrompt(input: {
  workflowPrompt: string;
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  acceptanceCriteria: string;
  issueConversationHistory: string;
  triggerReason: "issue_created" | "issue_comment_added";
  triggerCommentId?: string;
  triggerCommentAuthorUsername?: string;
  defaultBranchRef: string | null;
  requestOrigin: string;
  triggeredByUsername: string;
}): string {
  const issueCommentsApi = `${input.requestOrigin}/api/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`;
  const pullsApi = `${input.requestOrigin}/api/repos/${input.owner}/${input.repo}/pulls`;
  const defaultBranchName = input.defaultBranchRef?.replace(/^refs\/heads\//, "") ?? "main";
  const triggerCommentLines = [
    input.triggerCommentId ? `trigger_comment_id: ${input.triggerCommentId}` : "",
    input.triggerCommentAuthorUsername
      ? `trigger_comment_author: @${input.triggerCommentAuthorUsername}`
      : ""
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return `${input.workflowPrompt}

[Issue Context]
type: issue
repository: ${input.owner}/${input.repo}
issue_number: #${input.issueNumber}
issue_title: ${input.issueTitle}
trigger_reason: ${input.triggerReason}
${triggerCommentLines ? `${triggerCommentLines}\n` : ""}issue_body:
${input.issueBody || "(empty)"}
acceptance_criteria:
${input.acceptanceCriteria || "(none)"}
issue_conversation_history:
${input.issueConversationHistory}
default_branch_ref: ${input.defaultBranchRef ?? "(not found)"}

[History Handling]
The conversation history above is complete and may be long.
Before deciding, summarize/compress it into key facts for yourself, then proceed.

[Required Decision]
You are handling an issue trigger.
1. If the issue information is sufficient to implement a fix, start coding, push a branch, and create a PR that closes #${input.issueNumber}.
2. If information is insufficient, reply to this issue with concrete follow-up questions.

[Preferred MCP Tools]
If MCP tools are available, use them before raw HTTP:
- gits_issue_reply: post an issue comment reply
- gits_create_pull_request: create a pull request with closeIssueNumbers

[Issue Reply API]
method: POST
url: ${issueCommentsApi}
headers:
  Authorization: Bearer ${ISSUE_REPLY_TOKEN_PLACEHOLDER}
  Content-Type: application/json
body example:
  {"body":"Thanks for the report. Please provide steps, expected behavior, and logs."}

[Create Closing PR API]
method: POST
url: ${pullsApi}
headers:
  Authorization: Bearer ${ISSUE_PR_CREATE_TOKEN_PLACEHOLDER}
  Content-Type: application/json
body example:
  {"title":"fix: ...","body":"Closes #${input.issueNumber}","baseRef":"${defaultBranchName}","headRef":"<your-branch>","closeIssueNumbers":[${input.issueNumber}]}

[Git Push Credentials]
username: ${input.triggeredByUsername}
token_for_git_push: ${ISSUE_PR_CREATE_TOKEN_PLACEHOLDER}
remote: ${input.requestOrigin}/${input.owner}/${input.repo}.git`;
}

async function findReadableRepositoryOr404(args: {
  repositoryService: RepositoryService;
  owner: string;
  repo: string;
  userId?: string;
}): Promise<RepositoryRecord> {
  const repository = await args.repositoryService.findRepository(args.owner, args.repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  const canRead = await args.repositoryService.canReadRepository(repository, args.userId);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  return repository;
}

function buildAgentSessionSourceUrl(args: {
  owner: string;
  repo: string;
  session: Pick<AgentSessionRecord, "source_type" | "source_number">;
}): string | null {
  if (args.session.source_number === null) {
    return null;
  }
  if (args.session.source_type === "issue") {
    return `/repo/${args.owner}/${args.repo}/issues/${args.session.source_number}`;
  }
  if (args.session.source_type === "pull_request") {
    return `/repo/${args.owner}/${args.repo}/pulls/${args.session.source_number}`;
  }
  return null;
}

async function buildAgentSessionSourceContext(args: {
  db: D1Database;
  repository: RepositoryRecord;
  owner: string;
  repo: string;
  session: AgentSessionRecord;
  viewerId?: string;
}): Promise<{
  type: AgentSessionRecord["source_type"];
  number: number | null;
  title: string | null;
  url: string | null;
  commentId: string | null;
}> {
  const url = buildAgentSessionSourceUrl({
    owner: args.owner,
    repo: args.repo,
    session: args.session
  });

  if (args.session.source_number === null) {
    return {
      type: args.session.source_type,
      number: null,
      title: null,
      url,
      commentId: args.session.source_comment_id
    };
  }

  if (args.session.source_type === "issue") {
    const issueService = new IssueService(args.db);
    const issue = await issueService.findIssueByNumber(
      args.repository.id,
      args.session.source_number,
      args.viewerId
    );
    return {
      type: args.session.source_type,
      number: args.session.source_number,
      title: issue?.title ?? null,
      url,
      commentId: args.session.source_comment_id
    };
  }

  if (args.session.source_type === "pull_request") {
    const pullRequestService = new PullRequestService(args.db);
    const pullRequest = await pullRequestService.findPullRequestByNumber(
      args.repository.id,
      args.session.source_number,
      args.viewerId
    );
    return {
      type: args.session.source_type,
      number: args.session.source_number,
      title: pullRequest?.title ?? null,
      url,
      commentId: args.session.source_comment_id
    };
  }

  return {
    type: args.session.source_type,
    number: args.session.source_number,
    title: null,
    url,
    commentId: args.session.source_comment_id
  };
}

async function buildAgentSessionDetailPayload(args: {
  db: D1Database;
  repository: RepositoryRecord;
  owner: string;
  repo: string;
  session: AgentSessionRecord;
  viewerId?: string;
}): Promise<{
  session: AgentSessionRecord;
  linkedRun: ActionRunRecord | null;
  sourceContext: Awaited<ReturnType<typeof buildAgentSessionSourceContext>>;
  artifacts: Awaited<ReturnType<AgentSessionService["listArtifacts"]>>;
  usageRecords: Awaited<ReturnType<AgentSessionService["listUsageRecords"]>>;
  interventions: Awaited<ReturnType<AgentSessionService["listInterventions"]>>;
}> {
  const agentSessionService = new AgentSessionService(args.db);
  const actionsService = new ActionsService(args.db);
  const [linkedRun, sourceContext, artifacts, usageRecords, interventions] = await Promise.all([
    args.session.linked_run_id
      ? actionsService.findRunById(args.repository.id, args.session.linked_run_id)
      : null,
    buildAgentSessionSourceContext({
      db: args.db,
      repository: args.repository,
      owner: args.owner,
      repo: args.repo,
      session: args.session,
      ...(args.viewerId ? { viewerId: args.viewerId } : {})
    }),
    agentSessionService.listArtifacts(args.repository.id, args.session.id),
    agentSessionService.listUsageRecords(args.repository.id, args.session.id),
    agentSessionService.listInterventions(args.repository.id, args.session.id)
  ]);

  return {
    session: args.session,
    linkedRun,
    sourceContext,
    artifacts,
    usageRecords,
    interventions
  };
}

async function listRepositoryParticipants(
  repositoryService: RepositoryService,
  repository: RepositoryRecord
): Promise<Array<{ id: string; username: string }>> {
  const collaborators = await repositoryService.listCollaborators(repository.id);
  const participants = [
    { id: repository.owner_id, username: repository.owner_username },
    ...collaborators.map((collaborator) => ({
      id: collaborator.user_id,
      username: collaborator.username
    }))
  ];
  const unique = new Map<string, { id: string; username: string }>();
  for (const participant of participants) {
    unique.set(participant.id, participant);
  }
  return Array.from(unique.values()).sort((left, right) =>
    left.username.localeCompare(right.username)
  );
}

async function assertAssignableUserIds(args: {
  repositoryService: RepositoryService;
  repository: RepositoryRecord;
  userIds: string[] | undefined;
  field: string;
}): Promise<string[] | undefined> {
  if (!args.userIds) {
    return undefined;
  }
  const participants = await listRepositoryParticipants(args.repositoryService, args.repository);
  const allowedIds = new Set(participants.map((participant) => participant.id));
  for (const userId of args.userIds) {
    if (!allowedIds.has(userId)) {
      throw new HTTPException(400, {
        message: `Field '${args.field}' contains a user that cannot be assigned in this repository`
      });
    }
  }
  return args.userIds;
}

async function assertRepositoryLabelIds(args: {
  metadataService: RepositoryMetadataService;
  repositoryId: string;
  labelIds: string[] | undefined;
  field: string;
}): Promise<string[] | undefined> {
  if (!args.labelIds) {
    return undefined;
  }
  for (const labelId of args.labelIds) {
    const label = await args.metadataService.findLabelById(args.repositoryId, labelId);
    if (!label) {
      throw new HTTPException(400, {
        message: `Field '${args.field}' contains an unknown label`
      });
    }
  }
  return args.labelIds;
}

async function assertRepositoryMilestoneId(args: {
  metadataService: RepositoryMetadataService;
  repositoryId: string;
  milestoneId: string | null | undefined;
  field: string;
}): Promise<string | null | undefined> {
  if (args.milestoneId === undefined || args.milestoneId === null) {
    return args.milestoneId;
  }
  const milestone = await args.metadataService.findMilestoneById(
    args.repositoryId,
    args.milestoneId
  );
  if (!milestone) {
    throw new HTTPException(400, {
      message: `Field '${args.field}' references an unknown milestone`
    });
  }
  return args.milestoneId;
}

async function assertReactionSubjectExists(args: {
  db: D1Database;
  repositoryId: string;
  subjectType: ReactionSubjectType;
  subjectId: string;
}): Promise<void> {
  let tableName: "issues" | "issue_comments" | "pull_requests" | "pull_request_reviews";
  switch (args.subjectType) {
    case "issue":
      tableName = "issues";
      break;
    case "issue_comment":
      tableName = "issue_comments";
      break;
    case "pull_request":
      tableName = "pull_requests";
      break;
    case "pull_request_review":
      tableName = "pull_request_reviews";
      break;
  }
  const row = await args.db
    .prepare(`SELECT id FROM ${tableName} WHERE repository_id = ? AND id = ? LIMIT 1`)
    .bind(args.repositoryId, args.subjectId)
    .first<{ id: string }>();
  if (!row) {
    throw new HTTPException(404, { message: "Reaction subject not found" });
  }
}

type ActionsContainerStatePayload = {
  state?: {
    status?: string;
    exitCode?: number;
  };
};

const TERMINAL_ACTIONS_CONTAINER_STATES = new Set(["stopped", "stopped_with_code"]);
const TERMINAL_ACTION_RUN_STATUSES = new Set(["success", "failed", "cancelled"]);
const ACTION_RUN_LOG_STREAM_POLL_INTERVAL_MS = 1_000;
const ACTION_RUN_LOG_STREAM_MAX_DURATION_MS = 25_000;
const ACTION_RUN_LOG_STREAM_HEARTBEAT_INTERVAL_MS = 10_000;
const ACTION_RUN_RECONCILIATION_IDLE_GRACE_PERIOD_MS = 15_000;

type SseEventPayload = {
  event: string;
  data: unknown;
};

function appendContainerStateErrorLogs(input: {
  run: ActionRunRecord;
  containerStatus: string;
  containerExitCode: number | null;
  reconciledAt: number;
}): string {
  const lines: string[] = [];
  const existingLogs = input.run.logs.trim();
  if (existingLogs) {
    lines.push(existingLogs);
    lines.push("");
    lines.push(...buildActionRunLifecycleLines({ reconciledAt: input.reconciledAt }));
    lines.push("");
  } else {
    lines.push(
      ...buildActionRunLifecycleLines(
        {
          claimedAt: input.run.claimed_at,
          startedAt: input.run.started_at,
          reconciledAt: input.reconciledAt
        },
        { includeMissing: true }
      )
    );
    lines.push("");
  }
  lines.push("[runner_error]");
  lines.push(
    `Container ${input.run.container_instance ?? "(unknown)"} entered '${input.containerStatus}' before run completion.`
  );
  if (input.containerExitCode !== null) {
    lines.push(`container_exit_code: ${input.containerExitCode}`);
  }
  lines.push("Run was marked as failed during status reconciliation.");
  return lines.join("\n");
}

async function fetchActionsContainerState(
  actionsRunner: DurableObjectNamespace,
  containerInstance: string
): Promise<ActionsContainerStatePayload["state"] | null> {
  try {
    const stub = actionsRunner.getByName(containerInstance);
    const response = await stub.fetch("https://actions-container.internal/state");
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as ActionsContainerStatePayload | null;
    if (!payload?.state || typeof payload.state !== "object") {
      return null;
    }
    return payload.state;
  } catch {
    return null;
  }
}

function shouldSkipActionRunReconciliation(run: ActionRunRecord, now: number): boolean {
  const lastActivityAt = Math.max(run.updated_at, run.started_at ?? 0, run.created_at);
  return now - lastActivityAt < ACTION_RUN_RECONCILIATION_IDLE_GRACE_PERIOD_MS;
}

async function reconcileRunningActionRuns(input: {
  env: Pick<
    AppEnv["Bindings"],
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
  >;
  actionsService: ActionsService;
  repositoryId: string;
  runs: ActionRunRecord[];
}): Promise<ActionRunRecord[]> {
  const runningRuns = input.runs.filter(
    (run) =>
      (run.status === "queued" || run.status === "running") &&
      typeof run.container_instance === "string"
  );
  if (runningRuns.length === 0) {
    return input.runs;
  }

  const now = Date.now();
  const updatedRuns = new Map<string, ActionRunRecord>();
  await Promise.all(
    runningRuns.map(async (run) => {
      const containerInstance = run.container_instance;
      if (!containerInstance) {
        return;
      }
      if (shouldSkipActionRunReconciliation(run, now)) {
        return;
      }

      const actionsRunner = getActionRunnerNamespace(input.env, run.instance_type ?? "lite");
      if (!actionsRunner) {
        return;
      }
      const state = await fetchActionsContainerState(actionsRunner, containerInstance);
      const containerStatus = state?.status;
      if (
        typeof containerStatus !== "string" ||
        !TERMINAL_ACTIONS_CONTAINER_STATES.has(containerStatus)
      ) {
        return;
      }

      const containerExitCode = typeof state?.exitCode === "number" ? state.exitCode : null;
      const reconciledAt = Date.now();
      const logs = appendContainerStateErrorLogs({
        run,
        containerStatus,
        containerExitCode,
        reconciledAt
      });
      const result = await input.actionsService.failPendingRunIfStillPending(
        input.repositoryId,
        run.id,
        {
          logs,
          exitCode: containerExitCode,
          completedAt: reconciledAt
        }
      );

      if (!result.updated) {
        return;
      }

      updatedRuns.set(run.id, {
        ...run,
        status: "failed",
        logs,
        exit_code: containerExitCode,
        completed_at: result.completedAt,
        updated_at: result.completedAt
      });
    })
  );

  if (updatedRuns.size === 0) {
    return input.runs;
  }

  return input.runs.map((run) => updatedRuns.get(run.id) ?? run);
}

function createSseEventChunk(payload: SseEventPayload): string {
  return `event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`;
}

function buildRunLogStreamEvents(
  previousRun: ActionRunRecord | null,
  currentRun: ActionRunRecord
): SseEventPayload[] {
  if (!previousRun) {
    return [
      {
        event: "snapshot",
        data: {
          run: currentRun
        }
      }
    ];
  }

  if (currentRun.logs !== previousRun.logs) {
    if (currentRun.logs.startsWith(previousRun.logs)) {
      const chunk = currentRun.logs.slice(previousRun.logs.length);
      return [
        {
          event: "append",
          data: {
            runId: currentRun.id,
            chunk,
            status: currentRun.status,
            exitCode: currentRun.exit_code,
            completedAt: currentRun.completed_at,
            updatedAt: currentRun.updated_at
          }
        }
      ];
    }

    return [
      {
        event: "replace",
        data: {
          run: currentRun
        }
      }
    ];
  }

  if (
    currentRun.status !== previousRun.status ||
    currentRun.exit_code !== previousRun.exit_code ||
    currentRun.completed_at !== previousRun.completed_at ||
    currentRun.updated_at !== previousRun.updated_at
  ) {
    return [
      {
        event: "status",
        data: {
          runId: currentRun.id,
          status: currentRun.status,
          exitCode: currentRun.exit_code,
          completedAt: currentRun.completed_at,
          updatedAt: currentRun.updated_at
        }
      }
    ];
  }

  return [];
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(undefined);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(undefined);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const router = new Hono<AppEnv>();

function sessionCookieSecure(url: string): boolean {
  return new URL(url).protocol === "https:";
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("UNIQUE constraint failed");
}

router.get("/healthz", (c) => c.json({ ok: true }));

router.post("/auth/register", async (c) => {
  const payload = await parseJsonObject(c.req.raw);
  const username = assertString(payload.username, "username");
  const email = assertString(payload.email, "email").toLowerCase();
  const password = assertString(payload.password, "password", { trim: false });

  assertUsername(username);
  assertEmail(email);

  if (password.length < 8) {
    throw new HTTPException(400, { message: "Password must be at least 8 characters" });
  }

  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
  let user;
  try {
    user = await authService.createUser({
      username,
      email,
      password
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: "Username or email already exists" });
    }
    throw error;
  }

  const sessionToken = await authService.createSessionToken(user);
  setCookie(c, "session", sessionToken, {
    path: "/",
    httpOnly: true,
    secure: sessionCookieSecure(c.req.url),
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 7
  });

  return c.json({ user }, 201);
});

router.post("/auth/login", async (c) => {
  const payload = await parseJsonObject(c.req.raw);
  const usernameOrEmailInput = assertString(payload.usernameOrEmail, "usernameOrEmail");
  const usernameOrEmail = usernameOrEmailInput.includes("@")
    ? usernameOrEmailInput.toLowerCase()
    : usernameOrEmailInput;
  const password = assertString(payload.password, "password", { trim: false });

  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
  const user = await authService.verifyUserCredentials(usernameOrEmail, password);
  if (!user) {
    throw new HTTPException(401, { message: "Invalid credentials" });
  }

  const sessionToken = await authService.createSessionToken(user);
  setCookie(c, "session", sessionToken, {
    path: "/",
    httpOnly: true,
    secure: sessionCookieSecure(c.req.url),
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 7
  });

  return c.json({ user });
});

router.post("/auth/logout", requireSession, async (c) => {
  deleteCookie(c, "session", {
    path: "/"
  });
  return c.json({ ok: true });
});

router.get("/me", optionalSession, async (c) => {
  const user = c.get("sessionUser") ?? null;
  return c.json({ user });
});

router.get("/public/repos", async (c) => {
  const repositoryService = new RepositoryService(c.env.DB);
  const repositories = await repositoryService.listPublicRepositories(
    parseLimit(c.req.query("limit"), 50)
  );
  return c.json({ repositories });
});

router.post("/auth/tokens", requireSession, async (c) => {
  const payload = await parseJsonObject(c.req.raw);
  const name = assertString(payload.name, "name");
  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
  const sessionUser = mustSessionUser(c);

  const createTokenInput: { userId: string; name: string; expiresAt?: number } = {
    userId: sessionUser.id,
    name
  };
  if (payload.expiresAt !== undefined) {
    if (typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt)) {
      throw new HTTPException(400, { message: "Field 'expiresAt' must be a timestamp number" });
    }
    createTokenInput.expiresAt = payload.expiresAt;
  }

  const created = await authService.createAccessToken(createTokenInput);

  return c.json(
    {
      token: created.token,
      tokenId: created.tokenId
    },
    201
  );
});

router.get("/auth/tokens", requireSession, async (c) => {
  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
  const sessionUser = mustSessionUser(c);
  const tokens = await authService.listAccessTokens(sessionUser.id);
  return c.json({ tokens });
});

router.delete("/auth/tokens/:tokenId", requireSession, async (c) => {
  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
  const sessionUser = mustSessionUser(c);
  const tokenId = assertString(c.req.param("tokenId"), "tokenId");
  const revoked = await authService.revokeAccessToken(sessionUser.id, tokenId);
  if (!revoked) {
    throw new HTTPException(404, { message: "Token not found" });
  }
  return c.json({ ok: true });
});

router.get("/settings/actions", requireSession, async (c) => {
  const actionsService = new ActionsService(c.env.DB);
  const config = await actionsService.getGlobalConfig();
  return c.json({
    config: {
      codexConfigFileContent: config.codexConfigFileContent,
      claudeCodeConfigFileContent: config.claudeCodeConfigFileContent,
      updated_at: config.updated_at
    }
  });
});

router.patch("/settings/actions", requireSession, async (c) => {
  const payload = await parseJsonObject(c.req.raw);
  const patch: UpdateActionsGlobalConfigInput = {};
  if (payload.codexConfigFileContent !== undefined) {
    const codexConfigFileContent = assertOptionalNullableRawString(
      payload.codexConfigFileContent,
      "codexConfigFileContent"
    );
    if (
      codexConfigFileContent !== null &&
      codexConfigFileContent.length > MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH
    ) {
      throw new HTTPException(400, {
        message: `Field 'codexConfigFileContent' exceeds ${MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH} characters`
      });
    }
    patch.codexConfigFileContent = codexConfigFileContent;
  }

  if (payload.claudeCodeConfigFileContent !== undefined) {
    const claudeCodeConfigFileContent = assertOptionalNullableRawString(
      payload.claudeCodeConfigFileContent,
      "claudeCodeConfigFileContent"
    );
    if (
      claudeCodeConfigFileContent !== null &&
      claudeCodeConfigFileContent.length > MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH
    ) {
      throw new HTTPException(400, {
        message: `Field 'claudeCodeConfigFileContent' exceeds ${MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH} characters`
      });
    }
    patch.claudeCodeConfigFileContent = claudeCodeConfigFileContent;
  }

  if (
    patch.codexConfigFileContent === undefined &&
    patch.claudeCodeConfigFileContent === undefined
  ) {
    throw new HTTPException(400, { message: "No updatable fields provided" });
  }

  const actionsService = new ActionsService(c.env.DB);
  const config = await actionsService.updateGlobalConfig(patch);
  return c.json({
    config: {
      codexConfigFileContent: config.codexConfigFileContent,
      claudeCodeConfigFileContent: config.claudeCodeConfigFileContent,
      updated_at: config.updated_at
    }
  });
});

router.get("/repos/:owner/:repo/actions/config", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canManageActions = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canManageActions) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const actionsService = new ActionsService(c.env.DB);
  const config = await actionsService.getRepositoryConfig(repository.id);
  return c.json({
    config: {
      instanceType: config.instanceType,
      codexConfigFileContent: config.codexConfigFileContent,
      claudeCodeConfigFileContent: config.claudeCodeConfigFileContent,
      inheritsGlobalCodexConfig: config.inheritsGlobalCodexConfig,
      inheritsGlobalClaudeCodeConfig: config.inheritsGlobalClaudeCodeConfig,
      updated_at: config.updated_at
    }
  });
});

router.patch("/repos/:owner/:repo/actions/config", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const patch: UpdateRepositoryActionsConfigInput = {};
  if (payload.instanceType !== undefined) {
    const instanceType = payload.instanceType;
    patch.instanceType =
      instanceType === null
        ? null
        : assertActionContainerInstanceType(instanceType, "instanceType");
  }
  if (payload.codexConfigFileContent !== undefined) {
    const codexConfigFileContent = assertOptionalNullableRawString(
      payload.codexConfigFileContent,
      "codexConfigFileContent"
    );
    if (
      codexConfigFileContent !== null &&
      codexConfigFileContent.length > MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH
    ) {
      throw new HTTPException(400, {
        message: `Field 'codexConfigFileContent' exceeds ${MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH} characters`
      });
    }
    patch.codexConfigFileContent = codexConfigFileContent;
  }

  if (payload.claudeCodeConfigFileContent !== undefined) {
    const claudeCodeConfigFileContent = assertOptionalNullableRawString(
      payload.claudeCodeConfigFileContent,
      "claudeCodeConfigFileContent"
    );
    if (
      claudeCodeConfigFileContent !== null &&
      claudeCodeConfigFileContent.length > MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH
    ) {
      throw new HTTPException(400, {
        message: `Field 'claudeCodeConfigFileContent' exceeds ${MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH} characters`
      });
    }
    patch.claudeCodeConfigFileContent = claudeCodeConfigFileContent;
  }

  if (
    patch.instanceType === undefined &&
    patch.codexConfigFileContent === undefined &&
    patch.claudeCodeConfigFileContent === undefined
  ) {
    throw new HTTPException(400, { message: "No updatable fields provided" });
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canManageActions = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canManageActions) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const actionsService = new ActionsService(c.env.DB);
  const config = await actionsService.updateRepositoryConfig(repository.id, patch);
  return c.json({
    config: {
      instanceType: config.instanceType,
      codexConfigFileContent: config.codexConfigFileContent,
      claudeCodeConfigFileContent: config.claudeCodeConfigFileContent,
      inheritsGlobalCodexConfig: config.inheritsGlobalCodexConfig,
      inheritsGlobalClaudeCodeConfig: config.inheritsGlobalClaudeCodeConfig,
      updated_at: config.updated_at
    }
  });
});

router.get("/repos", requireSession, async (c) => {
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repositories = await repositoryService.listRepositoriesForUser(sessionUser.id);
  return c.json({ repositories });
});

router.get("/repos/:owner/:repo/branches", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await repositoryService.findRepository(owner, repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const sessionUser = c.get("sessionUser");
  const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const storageService = new StorageService(c.env.GIT_BUCKET);
  const branches = await storageService.listHeadRefs(owner, repo);
  return c.json({ branches });
});

router.get("/repos/:owner/:repo", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const browserService = new RepositoryBrowserService(new StorageService(c.env.GIT_BUCKET));
  const issueService = new IssueService(c.env.DB);
  const pullRequestService = new PullRequestService(c.env.DB);
  const detailInput: { owner: string; repo: string; ref?: string } = {
    owner,
    repo
  };
  const detailRef = c.req.query("ref");
  if (detailRef) {
    detailInput.ref = detailRef;
  }
  const [
    details,
    openIssueCount,
    openPullRequestCount,
    canCreateIssueOrPullRequest,
    canManageActions
  ] = await Promise.all([
    browserService.getRepositoryDetail(detailInput),
    issueService.countOpenIssues(repository.id),
    pullRequestService.countOpenPullRequests(repository.id),
    repositoryService.isOwnerOrCollaborator(repository, sessionUser?.id),
    repositoryService.isOwnerOrCollaborator(repository, sessionUser?.id)
  ]);

  return c.json({
    repository,
    openIssueCount,
    openPullRequestCount,
    permissions: {
      canCreateIssueOrPullRequest,
      canRunAgents: canCreateIssueOrPullRequest,
      canManageActions
    },
    ...details
  });
});

router.get("/repos/:owner/:repo/commits", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await repositoryService.findRepository(owner, repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const sessionUser = c.get("sessionUser");
  const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const browserService = new RepositoryBrowserService(new StorageService(c.env.GIT_BUCKET));
  const historyInput: { owner: string; repo: string; ref?: string; limit: number } = {
    owner,
    repo,
    limit: parseLimit(c.req.query("limit"), 20)
  };
  const historyRef = c.req.query("ref");
  if (historyRef) {
    historyInput.ref = historyRef;
  }
  const history = await browserService.listCommitHistory(historyInput);

  return c.json(history);
});

router.get("/repos/:owner/:repo/commits/:oid", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const oid = assertString(c.req.param("oid"), "oid");
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await repositoryService.findRepository(owner, repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const sessionUser = c.get("sessionUser");
  const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const browserService = new RepositoryBrowserService(new StorageService(c.env.GIT_BUCKET));
  try {
    const commit = await browserService.getCommitDetail({ owner, repo, oid });
    return c.json(commit);
  } catch {
    throw new HTTPException(404, { message: "Commit not found" });
  }
});

router.get("/repos/:owner/:repo/history", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const path = assertString(c.req.query("path"), "path");
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await repositoryService.findRepository(owner, repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const sessionUser = c.get("sessionUser");
  const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const browserService = new RepositoryBrowserService(new StorageService(c.env.GIT_BUCKET));
  try {
    const historyRef = c.req.query("ref");
    const history = await browserService.listPathHistory({
      owner,
      repo,
      path,
      ...(historyRef ? { ref: historyRef } : {}),
      limit: parseLimit(c.req.query("limit"), 20)
    });
    return c.json(history);
  } catch (error) {
    if (error instanceof RepositoryBrowseInvalidPathError) {
      throw new HTTPException(400, { message: "Invalid path" });
    }
    throw error;
  }
});

router.get("/repos/:owner/:repo/compare", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const baseRef = assertString(c.req.query("baseRef"), "baseRef");
  const headRef = assertString(c.req.query("headRef"), "headRef");
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await repositoryService.findRepository(owner, repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const sessionUser = c.get("sessionUser");
  const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const browserService = new RepositoryBrowserService(new StorageService(c.env.GIT_BUCKET));
  try {
    const comparison = await browserService.compareRefs({
      owner,
      repo,
      baseRef,
      headRef
    });
    return c.json(comparison);
  } catch {
    throw new HTTPException(404, { message: "Unable to compare refs" });
  }
});

router.get("/repos/:owner/:repo/contents", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await repositoryService.findRepository(owner, repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const sessionUser = c.get("sessionUser");
  const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const browserService = new RepositoryBrowserService(new StorageService(c.env.GIT_BUCKET));
  const browseInput: { owner: string; repo: string; ref?: string; path?: string } = {
    owner,
    repo
  };
  const browseRef = c.req.query("ref");
  if (browseRef) {
    browseInput.ref = browseRef;
  }
  const browsePath = c.req.query("path");
  if (browsePath) {
    browseInput.path = browsePath;
  }

  try {
    const contents = await browserService.browseRepositoryContents(browseInput);
    return c.json(contents);
  } catch (error) {
    if (error instanceof RepositoryBrowseInvalidPathError) {
      throw new HTTPException(400, { message: "Invalid path" });
    }
    if (error instanceof RepositoryBrowsePathNotFoundError) {
      throw new HTTPException(404, { message: "Path not found" });
    }
    throw error;
  }
});

router.get("/repos/:owner/:repo/issues", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const issueService = new IssueService(c.env.DB);
  const page = parsePage(c.req.query("page"));
  const issuePage = await issueService.listIssues(
    repository.id,
    parseIssueListState(c.req.query("state")),
    {
      limit: parseLimit(c.req.query("limit"), 50),
      page,
      ...(sessionUser ? { viewerId: sessionUser.id } : {})
    }
  );
  return c.json({
    issues: issuePage.items,
    pagination: {
      total: issuePage.total,
      page: issuePage.page,
      perPage: issuePage.per_page,
      hasNextPage: issuePage.has_next_page
    }
  });
});

router.get("/repos/:owner/:repo/issues/:number", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const issueService = new IssueService(c.env.DB);
  const issue = await issueService.findIssueByNumber(repository.id, number, sessionUser?.id);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  const linkedPullRequests = await issueService.listLinkedPullRequestsForIssue(repository.id, number);
  return c.json({ issue, linkedPullRequests });
});

router.get("/repos/:owner/:repo/issues/:number/comments", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const issueService = new IssueService(c.env.DB);
  const issue = await issueService.findIssueByNumber(repository.id, number, sessionUser?.id);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  const comments = await issueService.listIssueComments(repository.id, number, sessionUser?.id);
  return c.json({ comments });
});

router.post("/repos/:owner/:repo/issues", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const input: CreateIssueInput = {
    title: assertString(payload.title, "title")
  };
  if (payload.body !== undefined) {
    input.body = assertOptionalString(payload.body, "body") ?? "";
  }
  if (payload.acceptanceCriteria !== undefined) {
    input.acceptanceCriteria =
      assertOptionalString(payload.acceptanceCriteria, "acceptanceCriteria") ?? "";
  }
  if (payload.labelIds !== undefined) {
    const labelIds = assertOptionalStringArray(payload.labelIds, "labelIds");
    if (labelIds !== undefined) {
      input.labelIds = labelIds;
    }
  }
  if (payload.assigneeUserIds !== undefined) {
    const assigneeUserIds = assertOptionalStringArray(payload.assigneeUserIds, "assigneeUserIds");
    if (assigneeUserIds !== undefined) {
      input.assigneeUserIds = assigneeUserIds;
    }
  }
  if (payload.milestoneId !== undefined) {
    const milestoneId = assertOptionalNullableString(payload.milestoneId, "milestoneId");
    if (milestoneId !== undefined) {
      input.milestoneId = milestoneId;
    }
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canCreateIssueOrPullRequest = await repositoryService.isOwnerOrCollaborator(
    repository,
    sessionUser.id
  );
  if (!canCreateIssueOrPullRequest) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const metadataService = new RepositoryMetadataService(c.env.DB);
  await Promise.all([
    assertRepositoryLabelIds({
      metadataService,
      repositoryId: repository.id,
      labelIds: input.labelIds,
      field: "labelIds"
    }),
    assertAssignableUserIds({
      repositoryService,
      repository,
      userIds: input.assigneeUserIds,
      field: "assigneeUserIds"
    }),
    assertRepositoryMilestoneId({
      metadataService,
      repositoryId: repository.id,
      milestoneId: input.milestoneId,
      field: "milestoneId"
    })
  ]);

  const issueService = new IssueService(c.env.DB);
  const createdIssue = await issueService.createIssue({
    repositoryId: repository.id,
    authorId: sessionUser.id,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.acceptanceCriteria !== undefined
      ? { acceptanceCriteria: input.acceptanceCriteria }
      : {}),
    ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {})
  });
  if (input.labelIds !== undefined) {
    await metadataService.replaceIssueLabels(createdIssue.id, input.labelIds);
  }
  if (input.assigneeUserIds !== undefined) {
    await metadataService.replaceIssueAssignees(createdIssue.id, input.assigneeUserIds);
  }
  const issue =
    (await issueService.findIssueByNumber(repository.id, createdIssue.number, sessionUser.id)) ??
    createdIssue;
  const issueConversationHistory = buildIssueConversationHistory({
    issueAuthorUsername: issue.author_username,
    issueBody: issue.body,
    issueAcceptanceCriteria: issue.acceptance_criteria,
    comments: []
  });
  const storageService = new StorageService(c.env.GIT_BUCKET);
  const defaultBranchTarget = await resolveDefaultBranchTarget(storageService, owner, repo);
  const requestOrigin = new URL(c.req.url).origin;

  await triggerActionWorkflows({
    env: c.env,
    ...executionCtxArg(c),
    repository,
    triggerEvent: "issue_created",
    ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
    ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
    triggerSourceType: "issue",
    triggerSourceNumber: issue.number,
    triggeredByUser: sessionUser,
    requestOrigin,
    buildPrompt: (workflow) =>
      buildIssueCreatedAgentPrompt({
        workflowPrompt: workflow.prompt,
        owner,
        repo,
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueBody: issue.body,
        acceptanceCriteria: issue.acceptance_criteria,
        issueConversationHistory,
        triggerReason: "issue_created",
        defaultBranchRef: defaultBranchTarget.ref,
        requestOrigin,
        triggeredByUsername: sessionUser.username
      })
  });
  if (containsActionsMention({ title: issue.title, body: issue.body })) {
    await triggerMentionActionRun({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      prompt: buildMentionPrompt({ title: issue.title, body: issue.body }),
      ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
      ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
      triggerSourceType: "issue",
      triggerSourceNumber: issue.number,
      triggeredByUser: sessionUser,
      requestOrigin
    });
  }

  return c.json({ issue }, 201);
});

router.patch("/repos/:owner/:repo/issues/:number", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const payload = await parseJsonObject(c.req.raw);
  const patch: UpdateIssueInput = {};
  if (payload.title !== undefined) {
    patch.title = assertString(payload.title, "title");
  }
  if (payload.body !== undefined) {
    patch.body = assertOptionalString(payload.body, "body") ?? "";
  }
  if (payload.state !== undefined) {
    patch.state = assertIssueState(payload.state);
  }
  if (payload.taskStatus !== undefined) {
    patch.taskStatus = assertIssueTaskStatus(payload.taskStatus);
  }
  if (payload.acceptanceCriteria !== undefined) {
    patch.acceptanceCriteria =
      assertOptionalString(payload.acceptanceCriteria, "acceptanceCriteria") ?? "";
  }
  if (payload.labelIds !== undefined) {
    const labelIds = assertOptionalStringArray(payload.labelIds, "labelIds");
    if (labelIds !== undefined) {
      patch.labelIds = labelIds;
    }
  }
  if (payload.assigneeUserIds !== undefined) {
    const assigneeUserIds = assertOptionalStringArray(payload.assigneeUserIds, "assigneeUserIds");
    if (assigneeUserIds !== undefined) {
      patch.assigneeUserIds = assigneeUserIds;
    }
  }
  if (payload.milestoneId !== undefined) {
    const milestoneId = assertOptionalNullableString(payload.milestoneId, "milestoneId");
    if (milestoneId !== undefined) {
      patch.milestoneId = milestoneId;
    }
  }
  if (
    patch.title === undefined &&
    patch.body === undefined &&
    patch.state === undefined &&
    patch.taskStatus === undefined &&
    patch.acceptanceCriteria === undefined &&
    patch.labelIds === undefined &&
    patch.assigneeUserIds === undefined &&
    patch.milestoneId === undefined
  ) {
    throw new HTTPException(400, { message: "No updatable fields provided" });
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canCreateIssueOrPullRequest = await repositoryService.isOwnerOrCollaborator(
    repository,
    sessionUser.id
  );
  if (!canCreateIssueOrPullRequest) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const metadataService = new RepositoryMetadataService(c.env.DB);
  await Promise.all([
    assertRepositoryLabelIds({
      metadataService,
      repositoryId: repository.id,
      labelIds: patch.labelIds,
      field: "labelIds"
    }),
    assertAssignableUserIds({
      repositoryService,
      repository,
      userIds: patch.assigneeUserIds,
      field: "assigneeUserIds"
    }),
    assertRepositoryMilestoneId({
      metadataService,
      repositoryId: repository.id,
      milestoneId: patch.milestoneId,
      field: "milestoneId"
    })
  ]);

  const issueService = new IssueService(c.env.DB);
  const existingIssue = await issueService.findIssueByNumber(repository.id, number, sessionUser.id);
  if (!existingIssue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  const hadActionsMention = containsActionsMention({
    title: existingIssue.title,
    body: existingIssue.body
  });

  const updatedIssue = await issueService.updateIssue(repository.id, number, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    ...(patch.taskStatus !== undefined ? { taskStatus: patch.taskStatus } : {}),
    ...(patch.acceptanceCriteria !== undefined
      ? { acceptanceCriteria: patch.acceptanceCriteria }
      : {}),
    ...(patch.milestoneId !== undefined ? { milestoneId: patch.milestoneId } : {})
  });
  if (!updatedIssue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  if (patch.labelIds !== undefined) {
    await metadataService.replaceIssueLabels(existingIssue.id, patch.labelIds);
  }
  if (patch.assigneeUserIds !== undefined) {
    await metadataService.replaceIssueAssignees(existingIssue.id, patch.assigneeUserIds);
  }
  const issue =
    (await issueService.findIssueByNumber(repository.id, number, sessionUser.id)) ?? updatedIssue;
  const hasActionsMention = containsActionsMention({ title: issue.title, body: issue.body });
  if (!hadActionsMention && hasActionsMention) {
    const storageService = new StorageService(c.env.GIT_BUCKET);
    const defaultBranchTarget = await resolveDefaultBranchTarget(storageService, owner, repo);
    await triggerMentionActionRun({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      prompt: buildMentionPrompt({ title: issue.title, body: issue.body }),
      ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
      ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
      triggerSourceType: "issue",
      triggerSourceNumber: issue.number,
      triggeredByUser: sessionUser,
      requestOrigin: new URL(c.req.url).origin
    });
  }

  return c.json({ issue });
});

router.post("/repos/:owner/:repo/issues/:number/comments", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const payload = await parseJsonObject(c.req.raw);
  const input: CreateIssueCommentInput = {
    body: assertString(payload.body, "body")
  };

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canCreateIssueOrPullRequest = await repositoryService.isOwnerOrCollaborator(
    repository,
    sessionUser.id
  );
  if (!canCreateIssueOrPullRequest) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const issueService = new IssueService(c.env.DB);
  const issue = await issueService.findIssueByNumber(repository.id, number);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }

  let commentAuthorId = sessionUser.id;
  const accessTokenContext = c.get("accessTokenContext");
  const isActionsComment = accessTokenContext?.displayAsActions === true;
  if (isActionsComment) {
    const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
    const actionsUser = await authService.getOrCreateActionsUser();
    commentAuthorId = actionsUser.id;
  }

  const comment = await issueService.createIssueComment({
    repositoryId: repository.id,
    issueId: issue.id,
    issueNumber: issue.number,
    authorId: commentAuthorId,
    body: input.body
  });
  const comments = await issueService.listIssueComments(repository.id, issue.number);
  const issueConversationHistory = buildIssueConversationHistory({
    issueAuthorUsername: issue.author_username,
    issueBody: issue.body,
    issueAcceptanceCriteria: issue.acceptance_criteria,
    comments
  });
  const storageService = new StorageService(c.env.GIT_BUCKET);
  const defaultBranchTarget = await resolveDefaultBranchTarget(storageService, owner, repo);
  const requestOrigin = new URL(c.req.url).origin;

  if (!isActionsComment) {
    await triggerActionWorkflows({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      triggerEvent: "issue_created",
      ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
      ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
      triggerSourceType: "issue",
      triggerSourceNumber: issue.number,
      triggerSourceCommentId: comment.id,
      triggeredByUser: sessionUser,
      requestOrigin,
      buildPrompt: (workflow) =>
        buildIssueCreatedAgentPrompt({
          workflowPrompt: workflow.prompt,
          owner,
          repo,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueBody: issue.body,
          acceptanceCriteria: issue.acceptance_criteria,
          issueConversationHistory,
          triggerReason: "issue_comment_added",
          triggerCommentId: comment.id,
          triggerCommentAuthorUsername: comment.author_username,
          defaultBranchRef: defaultBranchTarget.ref,
          requestOrigin,
          triggeredByUsername: sessionUser.username
        })
    });
  }

  if (!isActionsComment && containsActionsMention({ title: issue.title, body: comment.body })) {
    await triggerMentionActionRun({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      prompt: buildIssueCommentMentionPrompt({
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueConversationHistory
      }),
      ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
      ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
      triggerSourceType: "issue",
      triggerSourceNumber: issue.number,
      triggerSourceCommentId: comment.id,
      triggeredByUser: sessionUser,
      requestOrigin
    });
  }

  return c.json({ comment }, 201);
});

router.post("/repos/:owner/:repo/issues/:number/assign-agent", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const payload = await parseJsonObject(c.req.raw);
  const input: TriggerRepositoryAgentInput = {};
  if (payload.agentType !== undefined) {
    input.agentType = assertActionAgentType(payload.agentType, "agentType");
  }
  if (payload.prompt !== undefined) {
    const prompt = assertOptionalString(payload.prompt, "prompt");
    if (prompt !== undefined) {
      input.prompt = prompt;
    }
  }
  if (payload.threadId !== undefined) {
    const threadId = assertOptionalString(payload.threadId, "threadId");
    if (threadId !== undefined) {
      input.threadId = threadId;
    }
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canRunAgents = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canRunAgents) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const issueService = new IssueService(c.env.DB);
  const issue = await issueService.findIssueByNumber(repository.id, number);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  if (issue.state !== "open") {
    throw new HTTPException(409, { message: "Issue must be open to assign an agent" });
  }

  const comments = await issueService.listIssueComments(repository.id, issue.number);
  const issueConversationHistory = buildIssueConversationHistory({
    issueAuthorUsername: issue.author_username,
    issueBody: issue.body,
    issueAcceptanceCriteria: issue.acceptance_criteria,
    comments
  });
  const storageService = new StorageService(c.env.GIT_BUCKET);
  const defaultBranchTarget = await resolveDefaultBranchTarget(storageService, owner, repo);
  const agentType = input.agentType ?? "codex";

  const execution = await triggerInteractiveAgentSession({
    env: c.env,
    ...executionCtxArg(c),
    repository,
    origin: "issue_assign",
    agentType,
    prompt: buildInteractiveIssueAgentPrompt({
      owner,
      repo,
      issueNumber: issue.number,
      issueTitle: issue.title,
      acceptanceCriteria: issue.acceptance_criteria,
      issueConversationHistory,
      reason: "assign",
      ...(input.prompt !== undefined ? { instruction: input.prompt } : {})
    }),
    ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
    ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
    triggerSourceType: "issue",
    triggerSourceNumber: issue.number,
    triggeredByUser: sessionUser,
    requestOrigin: new URL(c.req.url).origin
  });

  const updatedIssue =
    (await issueService.updateIssue(repository.id, issue.number, {
      taskStatus: "agent-working"
    })) ?? issue;

  return c.json({ ...execution, issue: updatedIssue }, 202);
});

router.post("/repos/:owner/:repo/issues/:number/resume-agent", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const payload = await parseJsonObject(c.req.raw);
  const input: TriggerRepositoryAgentInput = {};
  if (payload.agentType !== undefined) {
    input.agentType = assertActionAgentType(payload.agentType, "agentType");
  }
  if (payload.prompt !== undefined) {
    const prompt = assertOptionalString(payload.prompt, "prompt");
    if (prompt !== undefined) {
      input.prompt = prompt;
    }
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canRunAgents = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canRunAgents) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const issueService = new IssueService(c.env.DB);
  const issue = await issueService.findIssueByNumber(repository.id, number);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  if (issue.state !== "open") {
    throw new HTTPException(409, { message: "Issue must be open to resume an agent" });
  }

  const comments = await issueService.listIssueComments(repository.id, issue.number);
  const issueConversationHistory = buildIssueConversationHistory({
    issueAuthorUsername: issue.author_username,
    issueBody: issue.body,
    issueAcceptanceCriteria: issue.acceptance_criteria,
    comments
  });
  const storageService = new StorageService(c.env.GIT_BUCKET);
  const defaultBranchTarget = await resolveDefaultBranchTarget(storageService, owner, repo);
  const agentType = input.agentType ?? "codex";

  const execution = await triggerInteractiveAgentSession({
    env: c.env,
    ...executionCtxArg(c),
    repository,
    origin: "issue_resume",
    agentType,
    prompt: buildInteractiveIssueAgentPrompt({
      owner,
      repo,
      issueNumber: issue.number,
      issueTitle: issue.title,
      acceptanceCriteria: issue.acceptance_criteria,
      issueConversationHistory,
      reason: "resume",
      ...(input.prompt !== undefined ? { instruction: input.prompt } : {})
    }),
    ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
    ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
    triggerSourceType: "issue",
    triggerSourceNumber: issue.number,
    triggeredByUser: sessionUser,
    requestOrigin: new URL(c.req.url).origin
  });

  const updatedIssue =
    (await issueService.updateIssue(repository.id, issue.number, {
      taskStatus: "agent-working"
    })) ?? issue;

  return c.json({ ...execution, issue: updatedIssue }, 202);
});

router.get("/repos/:owner/:repo/pulls", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const pullRequestService = new PullRequestService(c.env.DB);
  const page = parsePage(c.req.query("page"));
  const pullRequestPage = await pullRequestService.listPullRequests(
    repository.id,
    parsePullRequestListState(c.req.query("state")),
    {
      limit: parseLimit(c.req.query("limit"), 50),
      page,
      ...(sessionUser ? { viewerId: sessionUser.id } : {})
    }
  );
  return c.json({
    pullRequests: pullRequestPage.items,
    pagination: {
      total: pullRequestPage.total,
      page: pullRequestPage.page,
      perPage: pullRequestPage.per_page,
      hasNextPage: pullRequestPage.has_next_page
    }
  });
});

router.get("/repos/:owner/:repo/pulls/:number", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const pullRequestService = new PullRequestService(c.env.DB);
  const pullRequest = await pullRequestService.findPullRequestByNumber(
    repository.id,
    number,
    sessionUser?.id
  );
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  const [reviewSummary, closingIssueNumbers] = await Promise.all([
    pullRequestService.summarizePullRequestReviews(repository.id, number),
    pullRequestService.listPullRequestClosingIssueNumbers(repository.id, number)
  ]);
  const issueService = new IssueService(c.env.DB);
  const closingIssues = await issueService.listIssuesByNumbers(
    repository.id,
    closingIssueNumbers,
    sessionUser?.id
  );
  return c.json({ pullRequest, reviewSummary, closingIssueNumbers, closingIssues });
});

router.get("/repos/:owner/:repo/pulls/:number/provenance", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const pullRequestService = new PullRequestService(c.env.DB);
  const pullRequest = await pullRequestService.findPullRequestByNumber(
    repository.id,
    number,
    sessionUser?.id
  );
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }

  const agentSessionService = new AgentSessionService(c.env.DB);
  const [latestSession] = await agentSessionService.listLatestSessionsBySource(
    repository.id,
    "pull_request",
    [number]
  );

  if (!latestSession) {
    return c.json({ latestSession: null });
  }

  const detail = await buildAgentSessionDetailPayload({
    db: c.env.DB,
    repository,
    owner,
    repo,
    session: latestSession,
    ...(sessionUser ? { viewerId: sessionUser.id } : {})
  });
  return c.json({ latestSession: detail });
});

router.get("/repos/:owner/:repo/pulls/:number/reviews", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const pullRequestService = new PullRequestService(c.env.DB);
  const pullRequest = await pullRequestService.findPullRequestByNumber(
    repository.id,
    number,
    sessionUser?.id
  );
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }

  const [reviews, reviewSummary] = await Promise.all([
    pullRequestService.listPullRequestReviews(repository.id, number, sessionUser?.id),
    pullRequestService.summarizePullRequestReviews(repository.id, number)
  ]);
  return c.json({ reviews, reviewSummary });
});

router.post("/repos/:owner/:repo/pulls/:number/reviews", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const payload = await parseJsonObject(c.req.raw);
  const input: CreatePullRequestReviewInput = {
    decision: assertPullRequestReviewDecision(payload.decision)
  };
  if (payload.body !== undefined) {
    input.body = assertOptionalString(payload.body, "body") ?? "";
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canReviewPullRequest = await repositoryService.isOwnerOrCollaborator(
    repository,
    sessionUser.id
  );
  if (!canReviewPullRequest) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const pullRequestService = new PullRequestService(c.env.DB);
  const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }

  const review = await pullRequestService.createPullRequestReview({
    repositoryId: repository.id,
    pullRequestId: pullRequest.id,
    pullRequestNumber: number,
    reviewerId: sessionUser.id,
    decision: input.decision,
    ...(input.body !== undefined ? { body: input.body } : {})
  });
  const nextReviewSummary = await pullRequestService.summarizePullRequestReviews(repository.id, number);
  return c.json({ review, reviewSummary: nextReviewSummary }, 201);
});

router.get("/repos/:owner/:repo/pulls/:number/review-threads", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const pullRequestService = new PullRequestService(c.env.DB);
  const pullRequest = await pullRequestService.findPullRequestByNumber(
    repository.id,
    number,
    sessionUser?.id
  );
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }

  const reviewThreads = await pullRequestService.listPullRequestReviewThreads(repository.id, number);
  return c.json({ reviewThreads });
});

router.post("/repos/:owner/:repo/pulls/:number/review-threads", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const payload = await parseJsonObject(c.req.raw);
  const input: CreatePullRequestReviewThreadInput = {
    path: assertString(payload.path, "path"),
    baseOid: assertCommitOid(payload.baseOid, "baseOid"),
    headOid: assertCommitOid(payload.headOid, "headOid"),
    startSide: assertPullRequestReviewThreadSide(payload.startSide),
    startLine: assertPositiveIntegerInput(payload.startLine, "startLine"),
    endSide: assertPullRequestReviewThreadSide(payload.endSide),
    endLine: assertPositiveIntegerInput(payload.endLine, "endLine"),
    hunkHeader: assertString(payload.hunkHeader, "hunkHeader")
  };
  const body = assertOptionalString(payload.body, "body");
  if (body !== undefined && body.length > 0) {
    input.body = body;
  }
  const suggestedCode = assertOptionalSuggestedCode(payload.suggestedCode);
  if (suggestedCode !== undefined) {
    input.suggestedCode = suggestedCode;
  }
  if (!input.body && !input.suggestedCode) {
    throw new HTTPException(400, {
      message: "Review threads require either a body or suggestedCode"
    });
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canReviewPullRequest = await repositoryService.isOwnerOrCollaborator(
    repository,
    sessionUser.id
  );
  if (!canReviewPullRequest) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const pullRequestService = new PullRequestService(c.env.DB);
  const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  if (pullRequest.state !== "open") {
    throw new HTTPException(409, { message: "Pull request must be open to create a review thread" });
  }
  const browserService = new RepositoryBrowserService(new StorageService(c.env.GIT_BUCKET));
  const comparison = await browserService.compareRefs({
    owner,
    repo,
    baseRef: pullRequest.base_ref,
    headRef: pullRequest.head_ref
  });
  const legacyLocation = assertDiffBoundPullRequestThreadInput({
    comparison,
    input
  });
  const suggestion = buildPullRequestReviewThreadSuggestion({
    side: input.startSide,
    startLine: input.startLine,
    endLine: input.endLine,
    ...(input.suggestedCode !== undefined ? { suggestedCode: input.suggestedCode } : {})
  });

  const reviewThread = await pullRequestService.createPullRequestReviewThread({
    repositoryId: repository.id,
    pullRequestId: pullRequest.id,
    pullRequestNumber: number,
    authorId: sessionUser.id,
    path: input.path,
    line: legacyLocation.line,
    side: legacyLocation.side,
    body: input.body ?? "",
    baseOid: input.baseOid,
    headOid: input.headOid,
    startSide: input.startSide,
    startLine: input.startLine,
    endSide: input.endSide,
    endLine: input.endLine,
    hunkHeader: input.hunkHeader,
    suggestion
  });
  return c.json({ reviewThread }, 201);
});

router.post(
  "/repos/:owner/:repo/pulls/:number/review-threads/:threadId/comments",
  requireSession,
  async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const number = assertPositiveInteger(c.req.param("number"), "number");
    const threadId = assertString(c.req.param("threadId"), "threadId");
    const payload = await parseJsonObject(c.req.raw);
    const input: CreatePullRequestReviewThreadCommentInput = {};
    const body = assertOptionalString(payload.body, "body");
    if (body !== undefined && body.length > 0) {
      input.body = body;
    }
    const suggestedCode = assertOptionalSuggestedCode(payload.suggestedCode);
    if (suggestedCode !== undefined) {
      input.suggestedCode = suggestedCode;
    }
    if (!input.body && !input.suggestedCode) {
      throw new HTTPException(400, {
        message: "Review thread comments require either a body or suggestedCode"
      });
    }

    const repositoryService = new RepositoryService(c.env.DB);
    const sessionUser = mustSessionUser(c);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const canReviewPullRequest = await repositoryService.isOwnerOrCollaborator(
      repository,
      sessionUser.id
    );
    if (!canReviewPullRequest) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const pullRequestService = new PullRequestService(c.env.DB);
    const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
    if (!pullRequest) {
      throw new HTTPException(404, { message: "Pull request not found" });
    }
    if (pullRequest.state !== "open") {
      throw new HTTPException(409, {
        message: "Pull request must be open to comment on a review thread"
      });
    }

    const existingThread = await pullRequestService.findPullRequestReviewThreadById(
      repository.id,
      number,
      threadId
    );
    if (!existingThread) {
      throw new HTTPException(404, { message: "Review thread not found" });
    }
    if (existingThread.status === "resolved") {
      throw new HTTPException(409, { message: "Resolved review threads cannot be updated" });
    }

    const comment = await pullRequestService.createPullRequestReviewThreadComment({
      repositoryId: repository.id,
      pullRequestId: pullRequest.id,
      pullRequestNumber: number,
      threadId,
      authorId: sessionUser.id,
      body: input.body ?? "",
      suggestion: buildPullRequestReviewThreadSuggestion({
        side: existingThread.start_side,
        startLine: existingThread.start_line,
        endLine: existingThread.end_line,
        ...(input.suggestedCode !== undefined ? { suggestedCode: input.suggestedCode } : {})
      })
    });
    const reviewThread = await pullRequestService.findPullRequestReviewThreadById(
      repository.id,
      number,
      threadId
    );
    if (!reviewThread) {
      throw new HTTPException(404, { message: "Review thread not found" });
    }

    return c.json({ comment, reviewThread }, 201);
  }
);

router.post(
  "/repos/:owner/:repo/pulls/:number/review-threads/:threadId/resolve",
  requireSession,
  async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const number = assertPositiveInteger(c.req.param("number"), "number");
    const threadId = assertString(c.req.param("threadId"), "threadId");

    const repositoryService = new RepositoryService(c.env.DB);
    const sessionUser = mustSessionUser(c);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const canReviewPullRequest = await repositoryService.isOwnerOrCollaborator(
      repository,
      sessionUser.id
    );
    if (!canReviewPullRequest) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const pullRequestService = new PullRequestService(c.env.DB);
    const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
    if (!pullRequest) {
      throw new HTTPException(404, { message: "Pull request not found" });
    }

    const existingThread = await pullRequestService.findPullRequestReviewThreadById(
      repository.id,
      number,
      threadId
    );
    if (!existingThread) {
      throw new HTTPException(404, { message: "Review thread not found" });
    }
    if (existingThread.status === "resolved") {
      return c.json({ reviewThread: existingThread });
    }

    const reviewThread = await pullRequestService.resolvePullRequestReviewThread({
      repositoryId: repository.id,
      pullRequestNumber: number,
      threadId,
      resolvedBy: sessionUser.id
    });
    if (!reviewThread) {
      throw new HTTPException(404, { message: "Review thread not found" });
    }

    return c.json({ reviewThread });
  }
);

router.post("/repos/:owner/:repo/pulls/:number/resume-agent", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const payload = await parseJsonObject(c.req.raw);
  const input: TriggerRepositoryAgentInput = {};
  if (payload.agentType !== undefined) {
    input.agentType = assertActionAgentType(payload.agentType, "agentType");
  }
  if (payload.prompt !== undefined) {
    const prompt = assertOptionalString(payload.prompt, "prompt");
    if (prompt !== undefined) {
      input.prompt = prompt;
    }
  }
  if (payload.threadId !== undefined) {
    input.threadId = assertString(payload.threadId, "threadId");
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canRunAgents = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canRunAgents) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const pullRequestService = new PullRequestService(c.env.DB);
  const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  if (pullRequest.state !== "open") {
    throw new HTTPException(409, { message: "Pull request must be open to resume an agent" });
  }

  const [reviews, reviewThreads] = await Promise.all([
    pullRequestService.listPullRequestReviews(repository.id, number),
    pullRequestService.listPullRequestReviewThreads(repository.id, number)
  ]);
  const focusedThread = input.threadId
    ? reviewThreads.find((thread) => thread.id === input.threadId) ?? null
    : null;
  if (input.threadId && !focusedThread) {
    throw new HTTPException(404, { message: "Review thread not found" });
  }
  if (focusedThread?.status === "resolved") {
    throw new HTTPException(409, { message: "Resolved review threads cannot resume an agent" });
  }
  const agentType = input.agentType ?? "codex";

  const execution = await triggerInteractiveAgentSession({
    env: c.env,
    ...executionCtxArg(c),
    repository,
    origin: "pull_request_resume",
    agentType,
    prompt: buildInteractivePullRequestAgentPrompt({
      owner,
      repo,
      pullRequestNumber: pullRequest.number,
      pullRequestTitle: pullRequest.title,
      pullRequestBody: pullRequest.body,
      baseRef: pullRequest.base_ref,
      headRef: pullRequest.head_ref,
      reviews,
      reviewThreads,
      ...(focusedThread ? { focusedThread } : {}),
      ...(input.prompt !== undefined ? { instruction: input.prompt } : {})
    }),
    ...(pullRequest.head_ref ? { triggerRef: pullRequest.head_ref } : {}),
    ...(pullRequest.head_oid ? { triggerSha: pullRequest.head_oid } : {}),
    triggerSourceType: "pull_request",
    triggerSourceNumber: pullRequest.number,
    triggeredByUser: sessionUser,
    requestOrigin: new URL(c.req.url).origin
  });

  return c.json(execution, 202);
});

router.post("/repos/:owner/:repo/pulls", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const input: CreatePullRequestInput = {
    title: assertString(payload.title, "title"),
    baseRef: normalizeBranchRef(payload.baseRef, "baseRef"),
    headRef: normalizeBranchRef(payload.headRef, "headRef")
  };
  if (payload.body !== undefined) {
    input.body = assertOptionalString(payload.body, "body") ?? "";
  }
  const closeIssueNumbers = assertOptionalIssueNumberArray(payload.closeIssueNumbers, "closeIssueNumbers");
  if (closeIssueNumbers !== undefined) {
    input.closeIssueNumbers = closeIssueNumbers;
  }
  if (payload.draft !== undefined) {
    const draft = assertOptionalBoolean(payload.draft, "draft");
    if (draft === undefined) {
      throw new HTTPException(400, { message: "Field 'draft' is required" });
    }
    input.draft = draft;
  }
  if (payload.labelIds !== undefined) {
    const labelIds = assertOptionalStringArray(payload.labelIds, "labelIds");
    if (labelIds !== undefined) {
      input.labelIds = labelIds;
    }
  }
  if (payload.assigneeUserIds !== undefined) {
    const assigneeUserIds = assertOptionalStringArray(payload.assigneeUserIds, "assigneeUserIds");
    if (assigneeUserIds !== undefined) {
      input.assigneeUserIds = assigneeUserIds;
    }
  }
  if (payload.requestedReviewerIds !== undefined) {
    const requestedReviewerIds = assertOptionalStringArray(
      payload.requestedReviewerIds,
      "requestedReviewerIds"
    );
    if (requestedReviewerIds !== undefined) {
      input.requestedReviewerIds = requestedReviewerIds;
    }
  }
  if (payload.milestoneId !== undefined) {
    const milestoneId = assertOptionalNullableString(payload.milestoneId, "milestoneId");
    if (milestoneId !== undefined) {
      input.milestoneId = milestoneId;
    }
  }
  if (input.baseRef === input.headRef) {
    throw new HTTPException(400, { message: "Field 'headRef' must differ from 'baseRef'" });
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canCreateIssueOrPullRequest = await repositoryService.isOwnerOrCollaborator(
    repository,
    sessionUser.id
  );
  if (!canCreateIssueOrPullRequest) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const storageService = new StorageService(c.env.GIT_BUCKET);
  const branchRefs = await storageService.listHeadRefs(owner, repo);
  const baseRef = branchRefs.find((item) => item.name === input.baseRef);
  if (!baseRef) {
    throw new HTTPException(400, { message: "Base branch not found" });
  }
  const headRef = branchRefs.find((item) => item.name === input.headRef);
  if (!headRef) {
    throw new HTTPException(400, { message: "Head branch not found" });
  }

  const pullRequestService = new PullRequestService(c.env.DB);
  const issueService = new IssueService(c.env.DB);
  const metadataService = new RepositoryMetadataService(c.env.DB);
  await Promise.all([
    assertRepositoryLabelIds({
      metadataService,
      repositoryId: repository.id,
      labelIds: input.labelIds,
      field: "labelIds"
    }),
    assertAssignableUserIds({
      repositoryService,
      repository,
      userIds: input.assigneeUserIds,
      field: "assigneeUserIds"
    }),
    assertAssignableUserIds({
      repositoryService,
      repository,
      userIds: input.requestedReviewerIds,
      field: "requestedReviewerIds"
    }),
    assertRepositoryMilestoneId({
      metadataService,
      repositoryId: repository.id,
      milestoneId: input.milestoneId,
      field: "milestoneId"
    })
  ]);
  if (input.closeIssueNumbers && input.closeIssueNumbers.length > 0) {
    const existingIssueNumbers = await issueService.listIssueNumbers(repository.id, input.closeIssueNumbers);
    if (existingIssueNumbers.length !== input.closeIssueNumbers.length) {
      const existingSet = new Set(existingIssueNumbers);
      const missing = input.closeIssueNumbers.filter((item) => !existingSet.has(item));
      throw new HTTPException(404, {
        message: `Issues not found: ${missing.map((item) => `#${item}`).join(", ")}`
      });
    }
  }
  try {
    let pullRequestAuthorId = sessionUser.id;
    const accessTokenContext = c.get("accessTokenContext");
    const isActionsPullRequest = accessTokenContext?.displayAsActions === true;
    if (isActionsPullRequest) {
      const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
      const actionsUser = await authService.getOrCreateActionsUser();
      pullRequestAuthorId = actionsUser.id;
    }

    const createdPullRequest = await pullRequestService.createPullRequest({
      repositoryId: repository.id,
      authorId: pullRequestAuthorId,
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      baseRef: baseRef.name,
      headRef: headRef.name,
      baseOid: baseRef.oid,
      headOid: headRef.oid,
      ...(input.draft !== undefined ? { draft: input.draft } : {}),
      ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {})
    });
    const closingIssueNumbers = await pullRequestService.replacePullRequestClosingIssueNumbers({
      repositoryId: repository.id,
      pullRequestId: createdPullRequest.id,
      pullRequestNumber: createdPullRequest.number,
      issueNumbers: input.closeIssueNumbers ?? []
    });
    if (input.labelIds !== undefined) {
      await metadataService.replacePullRequestLabels(createdPullRequest.id, input.labelIds);
    }
    if (input.assigneeUserIds !== undefined) {
      await metadataService.replacePullRequestAssignees(createdPullRequest.id, input.assigneeUserIds);
    }
    if (input.requestedReviewerIds !== undefined) {
      await metadataService.replacePullRequestReviewRequests(
        createdPullRequest.id,
        input.requestedReviewerIds
      );
    }
    const pullRequest =
      (await pullRequestService.findPullRequestByNumber(
        repository.id,
        createdPullRequest.number,
        sessionUser.id
      )) ?? createdPullRequest;

    const actionRuns = await triggerActionWorkflows({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      triggerEvent: "pull_request_created",
      triggerRef: pullRequest.head_ref,
      triggerSha: pullRequest.head_oid,
      triggerSourceType: "pull_request",
      triggerSourceNumber: pullRequest.number,
      triggeredByUser: sessionUser,
      requestOrigin: new URL(c.req.url).origin
    });
    if (containsActionsMention({ title: pullRequest.title, body: pullRequest.body })) {
      const mentionRun = await triggerMentionActionRun({
        env: c.env,
        ...executionCtxArg(c),
        repository,
        prompt: buildMentionPrompt({ title: pullRequest.title, body: pullRequest.body }),
        triggerRef: pullRequest.head_ref,
        triggerSha: pullRequest.head_oid,
        triggerSourceType: "pull_request",
        triggerSourceNumber: pullRequest.number,
        triggeredByUser: sessionUser,
        requestOrigin: new URL(c.req.url).origin
      });
      if (mentionRun) {
        actionRuns.push(mentionRun);
      }
    }

    return c.json({ pullRequest, closingIssueNumbers, actionRuns }, 201);
  } catch (error) {
    if (error instanceof DuplicateOpenPullRequestError) {
      throw new HTTPException(409, { message: error.message });
    }
    throw error;
  }
});

router.patch("/repos/:owner/:repo/pulls/:number", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const number = assertPositiveInteger(c.req.param("number"), "number");
  const payload = await parseJsonObject(c.req.raw);
  const patch: UpdatePullRequestInput = {};
  if (payload.title !== undefined) {
    patch.title = assertString(payload.title, "title");
  }
  if (payload.body !== undefined) {
    patch.body = assertOptionalString(payload.body, "body") ?? "";
  }
  const closeIssueNumbers = assertOptionalIssueNumberArray(payload.closeIssueNumbers, "closeIssueNumbers");
  if (closeIssueNumbers !== undefined) {
    patch.closeIssueNumbers = closeIssueNumbers;
  }
  if (payload.draft !== undefined) {
    const draft = assertOptionalBoolean(payload.draft, "draft");
    if (draft === undefined) {
      throw new HTTPException(400, { message: "Field 'draft' is required" });
    }
    patch.draft = draft;
  }
  if (payload.labelIds !== undefined) {
    const labelIds = assertOptionalStringArray(payload.labelIds, "labelIds");
    if (labelIds !== undefined) {
      patch.labelIds = labelIds;
    }
  }
  if (payload.assigneeUserIds !== undefined) {
    const assigneeUserIds = assertOptionalStringArray(payload.assigneeUserIds, "assigneeUserIds");
    if (assigneeUserIds !== undefined) {
      patch.assigneeUserIds = assigneeUserIds;
    }
  }
  if (payload.requestedReviewerIds !== undefined) {
    const requestedReviewerIds = assertOptionalStringArray(
      payload.requestedReviewerIds,
      "requestedReviewerIds"
    );
    if (requestedReviewerIds !== undefined) {
      patch.requestedReviewerIds = requestedReviewerIds;
    }
  }
  if (payload.milestoneId !== undefined) {
    const milestoneId = assertOptionalNullableString(payload.milestoneId, "milestoneId");
    if (milestoneId !== undefined) {
      patch.milestoneId = milestoneId;
    }
  }
  if (payload.state !== undefined) {
    const nextState = assertPullRequestState(payload.state);
    patch.state = nextState;
  }
  if (
    patch.title === undefined &&
    patch.body === undefined &&
    patch.state === undefined &&
    patch.closeIssueNumbers === undefined &&
    patch.draft === undefined &&
    patch.labelIds === undefined &&
    patch.assigneeUserIds === undefined &&
    patch.requestedReviewerIds === undefined &&
    patch.milestoneId === undefined
  ) {
    throw new HTTPException(400, { message: "No updatable fields provided" });
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canCreateIssueOrPullRequest = await repositoryService.isOwnerOrCollaborator(
    repository,
    sessionUser.id
  );
  if (!canCreateIssueOrPullRequest) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const pullRequestService = new PullRequestService(c.env.DB);
  const issueService = new IssueService(c.env.DB);
  const metadataService = new RepositoryMetadataService(c.env.DB);
  await Promise.all([
    assertRepositoryLabelIds({
      metadataService,
      repositoryId: repository.id,
      labelIds: patch.labelIds,
      field: "labelIds"
    }),
    assertAssignableUserIds({
      repositoryService,
      repository,
      userIds: patch.assigneeUserIds,
      field: "assigneeUserIds"
    }),
    assertAssignableUserIds({
      repositoryService,
      repository,
      userIds: patch.requestedReviewerIds,
      field: "requestedReviewerIds"
    }),
    assertRepositoryMilestoneId({
      metadataService,
      repositoryId: repository.id,
      milestoneId: patch.milestoneId,
      field: "milestoneId"
    })
  ]);
  const existingPullRequest = await pullRequestService.findPullRequestByNumber(
    repository.id,
    number,
    sessionUser.id
  );
  if (!existingPullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  const hadActionsMention = containsActionsMention({
    title: existingPullRequest.title,
    body: existingPullRequest.body
  });
  const requestOrigin = new URL(c.req.url).origin;
  if (patch.closeIssueNumbers !== undefined) {
    const existingIssueNumbers = await issueService.listIssueNumbers(repository.id, patch.closeIssueNumbers);
    if (existingIssueNumbers.length !== patch.closeIssueNumbers.length) {
      const existingSet = new Set(existingIssueNumbers);
      const missing = patch.closeIssueNumbers.filter((item) => !existingSet.has(item));
      throw new HTTPException(404, {
        message: `Issues not found: ${missing.map((item) => `#${item}`).join(", ")}`
      });
    }
  }
  let mergeResult: {
    baseOid: string;
    headOid: string;
    mergeCommitOid: string;
    createdCommit: boolean;
  } | null = null;
  if (patch.state === "merged") {
    if (existingPullRequest.state !== "open") {
      throw new HTTPException(409, { message: "Only open pull requests can be merged" });
    }
    const mergeService = new PullRequestMergeService(new StorageService(c.env.GIT_BUCKET));
    try {
      mergeResult = await mergeService.squashMergePullRequest({
        owner,
        repo,
        pullRequest: {
          ...existingPullRequest,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {})
        },
        mergedBy: sessionUser
      });
    } catch (error) {
      if (
        error instanceof PullRequestMergeConflictError ||
        error instanceof PullRequestMergeBranchNotFoundError ||
        error instanceof PullRequestMergeNotSupportedError
      ) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  }
  if (patch.closeIssueNumbers !== undefined) {
    await pullRequestService.replacePullRequestClosingIssueNumbers({
      repositoryId: repository.id,
      pullRequestId: existingPullRequest.id,
      pullRequestNumber: number,
      issueNumbers: patch.closeIssueNumbers
    });
  }

  const updatedPullRequest = await pullRequestService.updatePullRequest(repository.id, number, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    ...(patch.draft !== undefined ? { draft: patch.draft } : {}),
    ...(patch.milestoneId !== undefined ? { milestoneId: patch.milestoneId } : {}),
    ...(mergeResult
      ? {
          mergeCommitOid: mergeResult.mergeCommitOid,
          baseOid: mergeResult.baseOid,
          headOid: mergeResult.headOid
        }
      : {})
  });
  if (!updatedPullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  if (patch.labelIds !== undefined) {
    await metadataService.replacePullRequestLabels(existingPullRequest.id, patch.labelIds);
  }
  if (patch.assigneeUserIds !== undefined) {
    await metadataService.replacePullRequestAssignees(existingPullRequest.id, patch.assigneeUserIds);
  }
  if (patch.requestedReviewerIds !== undefined) {
    await metadataService.replacePullRequestReviewRequests(
      existingPullRequest.id,
      patch.requestedReviewerIds
    );
  }
  const closingIssueNumbers = await pullRequestService.listPullRequestClosingIssueNumbers(repository.id, number);
  const pullRequest =
    (await pullRequestService.findPullRequestByNumber(repository.id, number, sessionUser.id)) ??
    updatedPullRequest;
  if (patch.state === "merged" && closingIssueNumbers.length > 0) {
    await issueService.closeIssuesByNumbers(repository.id, closingIssueNumbers);
  }
  if (patch.state === "merged" && mergeResult?.createdCommit) {
    await triggerActionWorkflows({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      triggerEvent: "push",
      triggerRef: pullRequest.base_ref,
      triggerSha: mergeResult.mergeCommitOid,
      triggeredByUser: sessionUser,
      requestOrigin
    });
  }
  const hasActionsMention = containsActionsMention({ title: pullRequest.title, body: pullRequest.body });
  if (!hadActionsMention && hasActionsMention) {
    await triggerMentionActionRun({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      prompt: buildMentionPrompt({ title: pullRequest.title, body: pullRequest.body }),
      triggerRef: pullRequest.head_ref,
      triggerSha: pullRequest.head_oid,
      triggerSourceType: "pull_request",
      triggerSourceNumber: pullRequest.number,
      triggeredByUser: sessionUser,
      requestOrigin
    });
  }

  return c.json({ pullRequest, closingIssueNumbers });
});

router.get("/repos/:owner/:repo/participants", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const participants = await listRepositoryParticipants(repositoryService, repository);
  return c.json({ participants });
});

router.get("/repos/:owner/:repo/labels", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });
  const metadataService = new RepositoryMetadataService(c.env.DB);
  const labels = await metadataService.listLabels(repository.id);
  return c.json({ labels });
});

router.post("/repos/:owner/:repo/labels", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const input: CreateRepositoryLabelInput = {
    name: assertString(payload.name, "name"),
    color: assertOptionalHexColor(payload.color, "color") ?? ""
  };
  if (!input.color) {
    throw new HTTPException(400, { message: "Field 'color' is required" });
  }
  if (payload.description !== undefined) {
    input.description = assertOptionalNullableString(payload.description, "description") ?? null;
  }

  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
  if (!canWrite) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const metadataService = new RepositoryMetadataService(c.env.DB);
  try {
    const label = await metadataService.createLabel({
      repositoryId: repository.id,
      name: input.name,
      color: input.color,
      description: input.description ?? null
    });
    return c.json({ label }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: "Label with same name already exists" });
    }
    throw error;
  }
});

router.patch("/repos/:owner/:repo/labels/:labelId", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const labelId = assertString(c.req.param("labelId"), "labelId");
  const payload = await parseJsonObject(c.req.raw);
  const patch: UpdateRepositoryLabelInput = {};
  if (payload.name !== undefined) {
    patch.name = assertString(payload.name, "name");
  }
  if (payload.color !== undefined) {
    const color = assertOptionalHexColor(payload.color, "color");
    if (!color) {
      throw new HTTPException(400, { message: "Field 'color' is required" });
    }
    patch.color = color;
  }
  if (payload.description !== undefined) {
    patch.description = assertOptionalNullableString(payload.description, "description") ?? null;
  }
  if (patch.name === undefined && patch.color === undefined && patch.description === undefined) {
    throw new HTTPException(400, { message: "No updatable fields provided" });
  }

  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
  if (!canWrite) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const metadataService = new RepositoryMetadataService(c.env.DB);
  try {
    const label = await metadataService.updateLabel(repository.id, labelId, patch);
    if (!label) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    return c.json({ label });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: "Label with same name already exists" });
    }
    throw error;
  }
});

router.delete("/repos/:owner/:repo/labels/:labelId", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const labelId = assertString(c.req.param("labelId"), "labelId");
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
  if (!canWrite) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const metadataService = new RepositoryMetadataService(c.env.DB);
  const label = await metadataService.findLabelById(repository.id, labelId);
  if (!label) {
    throw new HTTPException(404, { message: "Label not found" });
  }
  await metadataService.deleteLabel(repository.id, labelId);
  return c.json({ ok: true });
});

router.get("/repos/:owner/:repo/milestones", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });
  const metadataService = new RepositoryMetadataService(c.env.DB);
  const milestones = await metadataService.listMilestones(repository.id);
  return c.json({ milestones });
});

router.post("/repos/:owner/:repo/milestones", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const input: CreateRepositoryMilestoneInput = {
    title: assertString(payload.title, "title")
  };
  if (payload.description !== undefined) {
    input.description = assertOptionalNullableString(payload.description, "description") ?? "";
  }
  if (payload.dueAt !== undefined) {
    const dueAt = assertOptionalNullablePositiveInteger(payload.dueAt, "dueAt");
    if (dueAt !== undefined) {
      input.dueAt = dueAt;
    }
  }

  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
  if (!canWrite) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const metadataService = new RepositoryMetadataService(c.env.DB);
  const milestone = await metadataService.createMilestone({
    repositoryId: repository.id,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {})
  });
  return c.json({ milestone }, 201);
});

router.patch("/repos/:owner/:repo/milestones/:milestoneId", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const milestoneId = assertString(c.req.param("milestoneId"), "milestoneId");
  const payload = await parseJsonObject(c.req.raw);
  const patch: UpdateRepositoryMilestoneInput = {};
  if (payload.title !== undefined) {
    patch.title = assertString(payload.title, "title");
  }
  if (payload.description !== undefined) {
    patch.description = assertOptionalNullableString(payload.description, "description") ?? "";
  }
  if (payload.dueAt !== undefined) {
    const dueAt = assertOptionalNullablePositiveInteger(payload.dueAt, "dueAt");
    if (dueAt !== undefined) {
      patch.dueAt = dueAt;
    }
  }
  if (payload.state !== undefined) {
    patch.state = assertMilestoneState(payload.state);
  }
  if (
    patch.title === undefined &&
    patch.description === undefined &&
    patch.dueAt === undefined &&
    patch.state === undefined
  ) {
    throw new HTTPException(400, { message: "No updatable fields provided" });
  }

  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
  if (!canWrite) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const metadataService = new RepositoryMetadataService(c.env.DB);
  const milestone = await metadataService.updateMilestone(repository.id, milestoneId, patch);
  if (!milestone) {
    throw new HTTPException(404, { message: "Milestone not found" });
  }
  return c.json({ milestone });
});

router.delete("/repos/:owner/:repo/milestones/:milestoneId", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const milestoneId = assertString(c.req.param("milestoneId"), "milestoneId");
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
  if (!canWrite) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const metadataService = new RepositoryMetadataService(c.env.DB);
  const milestone = await metadataService.findMilestoneById(repository.id, milestoneId);
  if (!milestone) {
    throw new HTTPException(404, { message: "Milestone not found" });
  }
  await metadataService.deleteMilestone(repository.id, milestoneId);
  return c.json({ ok: true });
});

router.put("/repos/:owner/:repo/reactions", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const subjectType = assertReactionSubjectType(payload.subjectType);
  const subjectId = assertString(payload.subjectId, "subjectId");
  const content = assertReactionContent(payload.content);
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  await assertReactionSubjectExists({
    db: c.env.DB,
    repositoryId: repository.id,
    subjectType,
    subjectId
  });
  const metadataService = new RepositoryMetadataService(c.env.DB);
  await metadataService.addReaction({
    repositoryId: repository.id,
    subjectType,
    subjectId,
    userId: sessionUser.id,
    content
  });
  const reactions = await metadataService.summarizeReactions(
    repository.id,
    subjectType,
    [subjectId],
    sessionUser.id
  );
  return c.json({ reactions: reactions[subjectId] ?? [] });
});

router.delete("/repos/:owner/:repo/reactions", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const subjectType = assertReactionSubjectType(payload.subjectType);
  const subjectId = assertString(payload.subjectId, "subjectId");
  const content = assertReactionContent(payload.content);
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  await assertReactionSubjectExists({
    db: c.env.DB,
    repositoryId: repository.id,
    subjectType,
    subjectId
  });
  const metadataService = new RepositoryMetadataService(c.env.DB);
  await metadataService.removeReaction({
    repositoryId: repository.id,
    subjectType,
    subjectId,
    userId: sessionUser.id,
    content
  });
  const reactions = await metadataService.summarizeReactions(
    repository.id,
    subjectType,
    [subjectId],
    sessionUser.id
  );
  return c.json({ reactions: reactions[subjectId] ?? [] });
});

router.get("/repos/:owner/:repo/actions/workflows", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const actionsService = new ActionsService(c.env.DB);
  const workflows = (await actionsService.listWorkflows(repository.id)).filter(
    (workflow) => !workflow.name.startsWith("__")
  );
  return c.json({ workflows });
});

router.post("/repos/:owner/:repo/actions/workflows", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const input: CreateActionWorkflowInput = {
    name: assertString(payload.name, "name"),
    triggerEvent: assertActionWorkflowTrigger(payload.triggerEvent, "triggerEvent"),
    agentType: assertActionAgentType(payload.agentType, "agentType"),
    prompt: assertString(payload.prompt, "prompt")
  };
  if (payload.pushBranchRegex !== undefined) {
    input.pushBranchRegex = assertOptionalRegexPattern(payload.pushBranchRegex, "pushBranchRegex") ?? null;
  }
  if (payload.pushTagRegex !== undefined) {
    input.pushTagRegex = assertOptionalRegexPattern(payload.pushTagRegex, "pushTagRegex") ?? null;
  }
  if (payload.enabled !== undefined) {
    const enabled = assertOptionalBoolean(payload.enabled, "enabled");
    if (enabled === undefined) {
      throw new HTTPException(400, { message: "Field 'enabled' is required" });
    }
    input.enabled = enabled;
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canManageActions = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canManageActions) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const actionsService = new ActionsService(c.env.DB);
  try {
    const workflow = await actionsService.createWorkflow({
      repositoryId: repository.id,
      name: input.name,
      triggerEvent: input.triggerEvent,
      agentType: input.agentType,
      prompt: input.prompt,
      pushBranchRegex: input.pushBranchRegex ?? null,
      pushTagRegex: input.pushTagRegex ?? null,
      enabled: input.enabled ?? true,
      createdBy: sessionUser.id
    });
    return c.json({ workflow }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: "Workflow with same name already exists" });
    }
    throw error;
  }
});

router.patch("/repos/:owner/:repo/actions/workflows/:workflowId", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const workflowId = assertString(c.req.param("workflowId"), "workflowId");
  const payload = await parseJsonObject(c.req.raw);
  const patch: UpdateActionWorkflowInput = {};
  if (payload.name !== undefined) {
    patch.name = assertString(payload.name, "name");
  }
  if (payload.triggerEvent !== undefined) {
    patch.triggerEvent = assertActionWorkflowTrigger(payload.triggerEvent, "triggerEvent");
  }
  if (payload.agentType !== undefined) {
    patch.agentType = assertActionAgentType(payload.agentType, "agentType");
  }
  if (payload.prompt !== undefined) {
    patch.prompt = assertString(payload.prompt, "prompt");
  }
  if (payload.pushBranchRegex !== undefined) {
    patch.pushBranchRegex = assertOptionalRegexPattern(payload.pushBranchRegex, "pushBranchRegex") ?? null;
  }
  if (payload.pushTagRegex !== undefined) {
    patch.pushTagRegex = assertOptionalRegexPattern(payload.pushTagRegex, "pushTagRegex") ?? null;
  }
  if (payload.enabled !== undefined) {
    const enabled = assertOptionalBoolean(payload.enabled, "enabled");
    if (enabled === undefined) {
      throw new HTTPException(400, { message: "Field 'enabled' is required" });
    }
    patch.enabled = enabled;
  }
  if (
    patch.name === undefined &&
    patch.triggerEvent === undefined &&
    patch.agentType === undefined &&
    patch.prompt === undefined &&
    patch.pushBranchRegex === undefined &&
    patch.pushTagRegex === undefined &&
    patch.enabled === undefined
  ) {
    throw new HTTPException(400, { message: "No updatable fields provided" });
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canManageActions = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canManageActions) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const actionsService = new ActionsService(c.env.DB);
  try {
    const workflow = await actionsService.updateWorkflow(repository.id, workflowId, patch);
    if (!workflow) {
      throw new HTTPException(404, { message: "Workflow not found" });
    }
    return c.json({ workflow });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: "Workflow with same name already exists" });
    }
    throw error;
  }
});

router.get("/repos/:owner/:repo/actions/runs", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const actionsService = new ActionsService(c.env.DB);
  const runs = await actionsService.listRuns(repository.id, parseLimit(c.req.query("limit"), 30));
  const reconciledRuns = await reconcileRunningActionRuns({
    env: c.env,
    actionsService,
    repositoryId: repository.id,
    runs
  });
  return c.json({ runs: reconciledRuns });
});

router.get("/repos/:owner/:repo/actions/runs/latest", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const sourceType = assertActionRunSourceType(c.req.query("sourceType"));
  const sourceNumbers = parseActionRunSourceNumbers(c.req.query("numbers"));
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const actionsService = new ActionsService(c.env.DB);
  const latestRuns = await actionsService.listLatestRunsBySource(
    repository.id,
    sourceType,
    sourceNumbers
  );
  const reconciledLatestRuns = await reconcileRunningActionRuns({
    env: c.env,
    actionsService,
    repositoryId: repository.id,
    runs: latestRuns
  });
  const runBySourceNumber = new Map<number, (typeof reconciledLatestRuns)[number]>();
  for (const run of reconciledLatestRuns) {
    if (run.trigger_source_number !== null) {
      runBySourceNumber.set(run.trigger_source_number, run);
    }
  }

  return c.json({
    sourceType,
    items: sourceNumbers.map((sourceNumber) => ({
      sourceNumber,
      run: runBySourceNumber.get(sourceNumber) ?? null
    }))
  });
});

router.get("/repos/:owner/:repo/actions/runs/latest-by-comments", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const commentIds = parseActionRunCommentIds(c.req.query("commentIds"));
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const actionsService = new ActionsService(c.env.DB);
  const latestRuns = await actionsService.listLatestRunsByCommentIds(repository.id, commentIds);
  const reconciledLatestRuns = await reconcileRunningActionRuns({
    env: c.env,
    actionsService,
    repositoryId: repository.id,
    runs: latestRuns
  });
  const runByCommentId = new Map<string, (typeof reconciledLatestRuns)[number]>();
  for (const run of reconciledLatestRuns) {
    if (run.trigger_source_comment_id) {
      runByCommentId.set(run.trigger_source_comment_id, run);
    }
  }

  return c.json({
    items: commentIds.map((commentId) => ({
      commentId,
      run: runByCommentId.get(commentId) ?? null
    }))
  });
});

router.get("/repos/:owner/:repo/agent-sessions", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const sourceTypeParam = c.req.query("sourceType");
  const sourceNumberParam = c.req.query("sourceNumber");
  if (sourceNumberParam && !sourceTypeParam) {
    throw new HTTPException(400, {
      message: "Query 'sourceType' is required when 'sourceNumber' is provided"
    });
  }

  const agentSessionService = new AgentSessionService(c.env.DB);
  const sessions = await agentSessionService.listSessions({
    repositoryId: repository.id,
    limit: parseLimit(c.req.query("limit"), 30),
    ...(sourceTypeParam ? { sourceType: assertAgentSessionSourceType(sourceTypeParam) } : {}),
    ...(sourceNumberParam
      ? { sourceNumber: assertPositiveInteger(sourceNumberParam, "sourceNumber") }
      : {})
  });
  return c.json({ sessions });
});

router.get("/repos/:owner/:repo/agent-sessions/latest", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const sourceType = assertAgentSessionSourceType(c.req.query("sourceType"));
  if (sourceType === "manual") {
    throw new HTTPException(400, {
      message: "Query 'sourceType' cannot be manual for latest source lookups"
    });
  }
  const sourceNumbers = parseActionRunSourceNumbers(c.req.query("numbers"));
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const agentSessionService = new AgentSessionService(c.env.DB);
  const latestSessions = await agentSessionService.listLatestSessionsBySource(
    repository.id,
    sourceType,
    sourceNumbers
  );
  const sessionBySourceNumber = new Map<number, (typeof latestSessions)[number]>();
  for (const session of latestSessions) {
    if (session.source_number !== null) {
      sessionBySourceNumber.set(session.source_number, session);
    }
  }

  return c.json({
    sourceType,
    items: sourceNumbers.map((sourceNumber) => ({
      sourceNumber,
      session: sessionBySourceNumber.get(sourceNumber) ?? null
    }))
  });
});

router.get("/repos/:owner/:repo/agent-sessions/:sessionId", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const sessionId = assertString(c.req.param("sessionId"), "sessionId");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const agentSessionService = new AgentSessionService(c.env.DB);
  const session = await agentSessionService.findSessionById(repository.id, sessionId);
  if (!session) {
    throw new HTTPException(404, { message: "Agent session not found" });
  }
  return c.json(
    await buildAgentSessionDetailPayload({
      db: c.env.DB,
      repository,
      owner,
      repo,
      session,
      ...(sessionUser ? { viewerId: sessionUser.id } : {})
    })
  );
});

router.get("/repos/:owner/:repo/agent-sessions/:sessionId/artifacts", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const sessionId = assertString(c.req.param("sessionId"), "sessionId");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const agentSessionService = new AgentSessionService(c.env.DB);
  const session = await agentSessionService.findSessionById(repository.id, sessionId);
  if (!session) {
    throw new HTTPException(404, { message: "Agent session not found" });
  }

  const artifacts = await agentSessionService.listArtifacts(repository.id, session.id);
  return c.json({ artifacts });
});

router.get("/repos/:owner/:repo/agent-sessions/:sessionId/timeline", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const sessionId = assertString(c.req.param("sessionId"), "sessionId");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const agentSessionService = new AgentSessionService(c.env.DB);
  const session = await agentSessionService.findSessionById(repository.id, sessionId);
  if (!session) {
    throw new HTTPException(404, { message: "Agent session not found" });
  }

  const actionsService = new ActionsService(c.env.DB);
  const linkedRun = session.linked_run_id
    ? await actionsService.findRunById(repository.id, session.linked_run_id)
    : null;
  const [steps, interventions] = await Promise.all([
    agentSessionService.listSteps(repository.id, session.id),
    agentSessionService.listInterventions(repository.id, session.id)
  ]);
  const events = agentSessionService.buildTimeline({
    session,
    run: linkedRun,
    steps,
    interventions
  });

  return c.json({ events });
});

router.post("/repos/:owner/:repo/agent-sessions/:sessionId/cancel", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const sessionId = assertString(c.req.param("sessionId"), "sessionId");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canManageActions = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canManageActions) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const agentSessionService = new AgentSessionService(c.env.DB);
  const session = await agentSessionService.findSessionById(repository.id, sessionId);
  if (!session) {
    throw new HTTPException(404, { message: "Agent session not found" });
  }
  if (session.status !== "queued") {
    throw new HTTPException(409, { message: "Only queued agent sessions can be cancelled" });
  }

  const actionsService = new ActionsService(c.env.DB);
  const run = session.linked_run_id
    ? await actionsService.findRunById(repository.id, session.linked_run_id)
    : null;
  if (session.linked_run_id && !run) {
    throw new HTTPException(404, { message: "Linked action run not found" });
  }
  if (run && run.status !== "queued") {
    throw new HTTPException(409, { message: "Only queued action runs can be cancelled" });
  }

  if (run) {
    const cancelResult = await actionsService.cancelQueuedRun(repository.id, run.id);
    if (!cancelResult.cancelled) {
      throw new HTTPException(409, { message: "Action run is no longer queued" });
    }
    await agentSessionService.recordIntervention({
      repositoryId: repository.id,
      sessionId: session.id,
      kind: "cancel_requested",
      title: "Cancellation requested",
      detail: `Queued session cancelled by ${sessionUser.username}.`,
      createdBy: sessionUser.id,
      payload: {
        runId: run.id,
        status: "cancelled"
      },
      createdAt: cancelResult.completedAt
    });
  } else {
    await agentSessionService.cancelSession({
      repositoryId: repository.id,
      sessionId: session.id,
      cancelledBy: sessionUser.id
    });
  }

  const updatedSession = await agentSessionService.findSessionById(repository.id, session.id);
  const nextRun = run ? await actionsService.findRunById(repository.id, run.id) : null;
  return c.json({ session: updatedSession, run: nextRun });
});

router.get("/repos/:owner/:repo/actions/runs/:runId", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const runId = assertString(c.req.param("runId"), "runId");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const actionsService = new ActionsService(c.env.DB);
  const run = await actionsService.findRunById(repository.id, runId);
  if (!run) {
    throw new HTTPException(404, { message: "Action run not found" });
  }
  const reconciledRuns = await reconcileRunningActionRuns({
    env: c.env,
    actionsService,
    repositoryId: repository.id,
    runs: [run]
  });
  return c.json({ run: reconciledRuns[0] ?? run });
});

router.get("/repos/:owner/:repo/actions/runs/:runId/logs/stream", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const runId = assertString(c.req.param("runId"), "runId");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = c.get("sessionUser");
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    ...(sessionUser ? { userId: sessionUser.id } : {})
  });

  const actionsService = new ActionsService(c.env.DB);
  const existingRun = await actionsService.findRunById(repository.id, runId);
  if (!existingRun) {
    throw new HTTPException(404, { message: "Action run not found" });
  }

  const encoder = new TextEncoder();
  const cancelController = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      let closed = false;
      const enqueue = (payload: SseEventPayload): boolean => {
        if (closed || cancelController.signal.aborted) {
          return false;
        }
        try {
          controller.enqueue(encoder.encode(createSseEventChunk(payload)));
          return true;
        } catch {
          closed = true;
          cancelController.abort();
          return false;
        }
      };
      const closeController = () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // Ignore close failures after disconnects.
        }
      };

      let currentRun = existingRun;
      let previousRun: ActionRunRecord | null = null;
      const deadline = Date.now() + ACTION_RUN_LOG_STREAM_MAX_DURATION_MS;
      let lastHeartbeatAt = 0;

      if (!closed) {
        try {
          controller.enqueue(encoder.encode("retry: 1000\n\n"));
        } catch {
          closed = true;
          cancelController.abort();
        }
      }

      try {
        while (true) {
          if (cancelController.signal.aborted) {
            break;
          }
          if (
            (currentRun.status === "queued" || currentRun.status === "running") &&
            currentRun.container_instance
          ) {
            const reconciledRuns = await reconcileRunningActionRuns({
              env: c.env,
              actionsService,
              repositoryId: repository.id,
              runs: [currentRun]
            });
            currentRun = reconciledRuns[0] ?? currentRun;
          }

          for (const payload of buildRunLogStreamEvents(previousRun, currentRun)) {
            if (!enqueue(payload)) {
              break;
            }
          }
          if (cancelController.signal.aborted || closed) {
            break;
          }
          previousRun = currentRun;

          if (TERMINAL_ACTION_RUN_STATUSES.has(currentRun.status)) {
            enqueue({
              event: "done",
              data: {
                runId: currentRun.id,
                status: currentRun.status,
                exitCode: currentRun.exit_code,
                completedAt: currentRun.completed_at,
                updatedAt: currentRun.updated_at
              }
            });
            break;
          }

          const now = Date.now();
          if (now >= deadline) {
            break;
          }

          if (now - lastHeartbeatAt >= ACTION_RUN_LOG_STREAM_HEARTBEAT_INTERVAL_MS) {
            enqueue({
              event: "heartbeat",
              data: {
                timestamp: now
              }
            });
            lastHeartbeatAt = now;
          }

          await delay(ACTION_RUN_LOG_STREAM_POLL_INTERVAL_MS, cancelController.signal);
          if (cancelController.signal.aborted) {
            break;
          }

          const nextRun = await actionsService.findRunById(repository.id, runId);
          if (!nextRun) {
            enqueue({
              event: "stream-error",
              data: {
                message: "Action run not found"
              }
            });
            break;
          }
          currentRun = nextRun;
        }
      } catch (error) {
        if (!cancelController.signal.aborted) {
          enqueue({
            event: "stream-error",
            data: {
              message: error instanceof Error ? error.message : "Unknown stream error"
            }
          });
        }
      } finally {
        closeController();
      }
    },
    cancel: () => {
      cancelController.abort();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff"
    }
  });
});

router.post("/repos/:owner/:repo/actions/runs/:runId/rerun", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const runId = assertString(c.req.param("runId"), "runId");
  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canManageActions = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canManageActions) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const actionsService = new ActionsService(c.env.DB);
  const sourceRun = await actionsService.findRunById(repository.id, runId);
  if (!sourceRun) {
    throw new HTTPException(404, { message: "Action run not found" });
  }

  const run = await actionsService.createRun({
    repositoryId: repository.id,
    workflowId: sourceRun.workflow_id,
    triggerEvent: sourceRun.trigger_event,
    ...(sourceRun.trigger_ref ? { triggerRef: sourceRun.trigger_ref } : {}),
    ...(sourceRun.trigger_sha ? { triggerSha: sourceRun.trigger_sha } : {}),
    ...(sourceRun.trigger_source_type ? { triggerSourceType: sourceRun.trigger_source_type } : {}),
    ...(sourceRun.trigger_source_number !== null
      ? { triggerSourceNumber: sourceRun.trigger_source_number }
      : {}),
    ...(sourceRun.trigger_source_comment_id
      ? { triggerSourceCommentId: sourceRun.trigger_source_comment_id }
      : {}),
    triggeredBy: sessionUser.id,
    agentType: sourceRun.agent_type,
    instanceType: sourceRun.instance_type ?? "lite",
    prompt: sourceRun.prompt
  });
  const session = await createLinkedAgentSessionForRun({
    db: c.env.DB,
    repositoryId: repository.id,
    run,
    origin: "rerun",
    createdBy: sessionUser.id,
    delegatedFromUserId: sourceRun.triggered_by ?? sessionUser.id
  });

  await scheduleActionRunExecution({
    env: c.env,
    ...executionCtxArg(c),
    repository,
    run,
    triggeredByUser: sessionUser,
    requestOrigin: new URL(c.req.url).origin
  });

  return c.json({ run, session }, 202);
});

router.post("/repos/:owner/:repo/actions/workflows/:workflowId/dispatch", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const workflowId = assertString(c.req.param("workflowId"), "workflowId");
  const payload = await parseJsonObject(c.req.raw);
  const input: DispatchActionWorkflowInput = {};
  if (payload.ref !== undefined) {
    const ref = assertOptionalString(payload.ref, "ref");
    if (ref) {
      input.ref = ref;
    }
  }
  if (payload.sha !== undefined) {
    const sha = assertOptionalString(payload.sha, "sha");
    if (sha) {
      input.sha = sha;
    }
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const sessionUser = mustSessionUser(c);
  const repository = await findReadableRepositoryOr404({
    repositoryService,
    owner,
    repo,
    userId: sessionUser.id
  });
  const canManageActions = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
  if (!canManageActions) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const actionsService = new ActionsService(c.env.DB);
  const workflow = await actionsService.findWorkflowById(repository.id, workflowId);
  if (!workflow) {
    throw new HTTPException(404, { message: "Workflow not found" });
  }
  if (workflow.enabled !== 1) {
    throw new HTTPException(409, { message: "Workflow is disabled" });
  }
  const repositoryConfig = await actionsService.getRepositoryConfig(repository.id);

  const run = await actionsService.createRun({
    repositoryId: repository.id,
    workflowId: workflow.id,
    triggerEvent: workflow.trigger_event,
    ...(input.ref ? { triggerRef: input.ref } : {}),
    ...(input.sha ? { triggerSha: input.sha } : {}),
    triggeredBy: sessionUser.id,
    agentType: workflow.agent_type,
    instanceType: repositoryConfig.instanceType,
    prompt: workflow.prompt
  });
  const session = await createLinkedAgentSessionForRun({
    db: c.env.DB,
    repositoryId: repository.id,
    run,
    origin: "dispatch",
    createdBy: sessionUser.id,
    delegatedFromUserId: sessionUser.id
  });

  await scheduleActionRunExecution({
    env: c.env,
    ...executionCtxArg(c),
    repository,
    run,
    triggeredByUser: sessionUser,
    requestOrigin: new URL(c.req.url).origin
  });

  return c.json({ run, session }, 202);
});

router.post("/repos", requireSession, async (c) => {
  const payload = await parseJsonObject(c.req.raw);
  const name = assertString(payload.name, "name");
  assertRepositoryName(name);
  const repositoryService = new RepositoryService(c.env.DB);
  const storageService = new StorageService(c.env.GIT_BUCKET);
  const sessionUser = mustSessionUser(c);
  let createdRepoId: string | null = null;

  try {
    const isPrivate = assertOptionalBoolean(payload.isPrivate, "isPrivate") ?? true;
    const createRepoInput: {
      ownerId: string;
      name: string;
      description?: string;
      isPrivate: boolean;
    } = {
      ownerId: sessionUser.id,
      name,
      isPrivate
    };

    const description =
      payload.description === undefined
        ? undefined
        : assertString(payload.description, "description");
    if (description) {
      createRepoInput.description = description;
    }

    const created = await repositoryService.createRepository(createRepoInput);
    createdRepoId = created.id;
    await storageService.initializeRepository(sessionUser.username, name);
  } catch (error) {
    if (createdRepoId) {
      await repositoryService.deleteRepositoryById(createdRepoId).catch(() => undefined);
      await storageService.deleteRepository(sessionUser.username, name).catch(() => undefined);
    }
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: "Repository already exists" });
    }
    throw error;
  }

  return c.json({ ok: true }, 201);
});

router.patch("/repos/:owner/:repo", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const storageService = new StorageService(c.env.GIT_BUCKET);

  const repository = await repositoryService.findRepository(owner, repoName);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  if (repository.owner_id !== sessionUser.id) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const nextNameRaw = assertOptionalString(payload.name, "name");
  const nextDescriptionRaw = assertOptionalString(payload.description, "description");
  const nextVisibility = assertOptionalBoolean(payload.isPrivate, "isPrivate");

  const nextName = nextNameRaw && nextNameRaw !== repoName ? nextNameRaw : undefined;
  if (nextName) {
    assertRepositoryName(nextName);
  }

  const descriptionPatch =
    payload.description === undefined
      ? undefined
      : nextDescriptionRaw && nextDescriptionRaw.length > 0
        ? nextDescriptionRaw
        : null;
  const isPrivatePatch = nextVisibility;

  let renamed = false;
  if (nextName) {
    await storageService.renameRepository(owner, repoName, nextName);
    renamed = true;
  }

  try {
    await repositoryService.updateRepository(repository.id, {
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(descriptionPatch !== undefined ? { description: descriptionPatch } : {}),
      ...(isPrivatePatch !== undefined ? { isPrivate: isPrivatePatch } : {})
    });
  } catch (error) {
    if (renamed && nextName) {
      await storageService.renameRepository(owner, nextName, repoName).catch(() => undefined);
    }
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: "Repository already exists" });
    }
    throw error;
  }

  return c.json({ ok: true });
});

router.delete("/repos/:owner/:repo", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);
  const storageService = new StorageService(c.env.GIT_BUCKET);

  const repository = await repositoryService.findRepository(owner, repoName);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  if (repository.owner_id !== sessionUser.id) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  await storageService.deleteRepository(owner, repoName);
  await repositoryService.deleteRepositoryById(repository.id);
  return c.json({ ok: true });
});

router.get("/repos/:owner/:repo/collaborators", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);

  const repository = await repositoryService.findRepository(owner, repoName);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const canAdmin = await repositoryService.canAdminRepository(repository, sessionUser.id);
  if (!canAdmin) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const collaborators = await repositoryService.listCollaborators(repository.id);
  return c.json({ collaborators });
});

router.put("/repos/:owner/:repo/collaborators", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const payload = await parseJsonObject(c.req.raw);
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);

  const repository = await repositoryService.findRepository(owner, repoName);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  const canAdmin = await repositoryService.canAdminRepository(repository, sessionUser.id);
  if (!canAdmin) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const username = assertString(payload.username, "username");
  const permission = assertCollaboratorPermission(payload.permission);
  const collaborator = await repositoryService.findUserByUsername(username);
  if (!collaborator) {
    throw new HTTPException(404, { message: "User not found" });
  }
  if (collaborator.id === repository.owner_id) {
    throw new HTTPException(400, { message: "Owner is already a full-access member" });
  }

  await repositoryService.upsertCollaborator({
    repositoryId: repository.id,
    userId: collaborator.id,
    permission
  });
  return c.json({ ok: true });
});

router.delete("/repos/:owner/:repo/collaborators/:username", requireSession, async (c) => {
  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const username = assertString(c.req.param("username"), "username");
  const sessionUser = mustSessionUser(c);
  const repositoryService = new RepositoryService(c.env.DB);

  const repository = await repositoryService.findRepository(owner, repoName);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  const canAdmin = await repositoryService.canAdminRepository(repository, sessionUser.id);
  if (!canAdmin) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const collaborator = await repositoryService.findUserByUsername(username);
  if (!collaborator) {
    throw new HTTPException(404, { message: "User not found" });
  }
  if (collaborator.id === repository.owner_id) {
    throw new HTTPException(400, { message: "Cannot remove repository owner" });
  }

  await repositoryService.removeCollaborator(repository.id, collaborator.id);
  return c.json({ ok: true });
});

export default router;
