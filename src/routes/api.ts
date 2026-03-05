import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { mustSessionUser, optionalSession, requireSession } from "../middleware/auth";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../services/action-runner-prompt-tokens";
import {
  containsActionsMention,
  scheduleActionRunExecution,
  triggerActionWorkflows,
  triggerMentionActionRun
} from "../services/action-trigger-service";
import { ActionsService } from "../services/actions-service";
import { AuthService } from "../services/auth-service";
import {
  RepositoryBrowserService,
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError
} from "../services/repository-browser-service";
import { IssueService, type IssueListState } from "../services/issue-service";
import {
  DuplicateOpenPullRequestError,
  PullRequestService,
  type PullRequestListState
} from "../services/pull-request-service";
import { RepositoryService } from "../services/repository-service";
import { StorageService } from "../services/storage-service";
import type {
  ActionAgentType,
  ActionRunRecord,
  ActionRunSourceType,
  ActionWorkflowTrigger,
  AppEnv,
  IssueState,
  PullRequestReviewDecision,
  PullRequestState,
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
};

type UpdateIssueInput = {
  title?: string;
  body?: string;
  state?: IssueState;
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
};

type UpdatePullRequestInput = {
  title?: string;
  body?: string;
  state?: PullRequestState;
  closeIssueNumbers?: number[];
};

type CreatePullRequestReviewInput = {
  decision: PullRequestReviewDecision;
  body?: string;
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

const USERNAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,30}[A-Za-z0-9])?$/;
const REPO_NAME_REGEX = /^[A-Za-z0-9._-]{1,100}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ACTIONS_CONFIG_FILE_CONTENT_LENGTH = 120_000;

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

function assertUsername(value: string): void {
  if (!USERNAME_REGEX.test(value)) {
    throw new HTTPException(400, {
      message:
        "Invalid username. Use letters/numbers and ._- only, length 1-32, no leading/trailing punctuation."
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

function assertActionRunSourceType(value: string | undefined): ActionRunSourceType {
  if (value === "issue" || value === "pull_request") {
    return value;
  }
  throw new HTTPException(400, {
    message: "Query 'sourceType' must be one of: issue, pull_request"
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
  defaultBranchRef: string | null;
  requestOrigin: string;
  triggeredByUsername: string;
}): string {
  const issueCommentsApi = `${input.requestOrigin}/api/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`;
  const pullsApi = `${input.requestOrigin}/api/repos/${input.owner}/${input.repo}/pulls`;
  const defaultBranchName = input.defaultBranchRef?.replace(/^refs\/heads\//, "") ?? "main";

  return `${input.workflowPrompt}

[Issue Context]
type: issue
repository: ${input.owner}/${input.repo}
issue_number: #${input.issueNumber}
issue_title: ${input.issueTitle}
issue_body:
${input.issueBody || "(empty)"}
default_branch_ref: ${input.defaultBranchRef ?? "(not found)"}

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

type ActionsContainerStatePayload = {
  state?: {
    status?: string;
    exitCode?: number;
  };
};

const TERMINAL_ACTIONS_CONTAINER_STATES = new Set(["stopped", "stopped_with_code"]);

function appendContainerStateErrorLogs(input: {
  run: ActionRunRecord;
  containerStatus: string;
  containerExitCode: number | null;
}): string {
  const lines: string[] = [];
  if (input.run.logs.trim()) {
    lines.push(input.run.logs.trim());
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

async function reconcileRunningActionRuns(input: {
  env: Pick<AppEnv["Bindings"], "ACTIONS_RUNNER">;
  actionsService: ActionsService;
  repositoryId: string;
  runs: ActionRunRecord[];
}): Promise<ActionRunRecord[]> {
  const actionsRunner = input.env.ACTIONS_RUNNER;
  if (!actionsRunner) {
    return input.runs;
  }

  const runningRuns = input.runs.filter(
    (run) => run.status === "running" && typeof run.container_instance === "string"
  );
  if (runningRuns.length === 0) {
    return input.runs;
  }

  const updatedRuns = new Map<string, ActionRunRecord>();
  await Promise.all(
    runningRuns.map(async (run) => {
      const containerInstance = run.container_instance;
      if (!containerInstance) {
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
      const logs = appendContainerStateErrorLogs({
        run,
        containerStatus,
        containerExitCode
      });
      const result = await input.actionsService.failRunningRunIfStillRunning(
        input.repositoryId,
        run.id,
        {
          logs,
          exitCode: containerExitCode
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
  const [details, openIssueCount, openPullRequestCount, canCreateIssueOrPullRequest] = await Promise.all(
    [
      browserService.getRepositoryDetail(detailInput),
      issueService.countOpenIssues(repository.id),
      pullRequestService.countOpenPullRequests(repository.id),
      repositoryService.isOwnerOrCollaborator(repository, sessionUser?.id)
    ]
  );

  return c.json({
    repository,
    openIssueCount,
    openPullRequestCount,
    permissions: {
      canCreateIssueOrPullRequest
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
  const issues = await issueService.listIssues(
    repository.id,
    parseIssueListState(c.req.query("state")),
    parseLimit(c.req.query("limit"), 50)
  );
  return c.json({ issues });
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
  const issue = await issueService.findIssueByNumber(repository.id, number);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  return c.json({ issue });
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
  const issue = await issueService.findIssueByNumber(repository.id, number);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  const comments = await issueService.listIssueComments(repository.id, number);
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
  const issue = await issueService.createIssue({
    repositoryId: repository.id,
    authorId: sessionUser.id,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {})
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
  if (patch.title === undefined && patch.body === undefined && patch.state === undefined) {
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

  const issueService = new IssueService(c.env.DB);
  const existingIssue = await issueService.findIssueByNumber(repository.id, number);
  if (!existingIssue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  const hadActionsMention = containsActionsMention({
    title: existingIssue.title,
    body: existingIssue.body
  });

  const issue = await issueService.updateIssue(repository.id, number, patch);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
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

  const comment = await issueService.createIssueComment({
    repositoryId: repository.id,
    issueId: issue.id,
    issueNumber: issue.number,
    authorId: sessionUser.id,
    body: input.body
  });

  if (containsActionsMention({ title: issue.title, body: comment.body })) {
    const storageService = new StorageService(c.env.GIT_BUCKET);
    const defaultBranchTarget = await resolveDefaultBranchTarget(storageService, owner, repo);
    await triggerMentionActionRun({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      prompt: `Issue #${issue.number}: ${issue.title}\n\nComment:\n${comment.body}`,
      ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
      ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
      triggerSourceType: "issue",
      triggerSourceNumber: issue.number,
      triggerSourceCommentId: comment.id,
      triggeredByUser: sessionUser,
      requestOrigin: new URL(c.req.url).origin
    });
  }

  return c.json({ comment }, 201);
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
  const pullRequests = await pullRequestService.listPullRequests(
    repository.id,
    parsePullRequestListState(c.req.query("state")),
    parseLimit(c.req.query("limit"), 50)
  );
  return c.json({ pullRequests });
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
  const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  const [reviewSummary, closingIssueNumbers] = await Promise.all([
    pullRequestService.summarizePullRequestReviews(repository.id, number),
    pullRequestService.listPullRequestClosingIssueNumbers(repository.id, number)
  ]);
  return c.json({ pullRequest, reviewSummary, closingIssueNumbers });
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
  const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }

  const [reviews, reviewSummary] = await Promise.all([
    pullRequestService.listPullRequestReviews(repository.id, number),
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
    const pullRequest = await pullRequestService.createPullRequest({
      repositoryId: repository.id,
      authorId: sessionUser.id,
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      baseRef: baseRef.name,
      headRef: headRef.name,
      baseOid: baseRef.oid,
      headOid: headRef.oid
    });
    const closingIssueNumbers = await pullRequestService.replacePullRequestClosingIssueNumbers({
      repositoryId: repository.id,
      pullRequestId: pullRequest.id,
      pullRequestNumber: pullRequest.number,
      issueNumbers: input.closeIssueNumbers ?? []
    });

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
  if (payload.state !== undefined) {
    const nextState = assertPullRequestState(payload.state);
    patch.state = nextState;
  }
  if (
    patch.title === undefined &&
    patch.body === undefined &&
    patch.state === undefined &&
    patch.closeIssueNumbers === undefined
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
  const existingPullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
  if (!existingPullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  const hadActionsMention = containsActionsMention({
    title: existingPullRequest.title,
    body: existingPullRequest.body
  });
  if (patch.closeIssueNumbers !== undefined) {
    const existingIssueNumbers = await issueService.listIssueNumbers(repository.id, patch.closeIssueNumbers);
    if (existingIssueNumbers.length !== patch.closeIssueNumbers.length) {
      const existingSet = new Set(existingIssueNumbers);
      const missing = patch.closeIssueNumbers.filter((item) => !existingSet.has(item));
      throw new HTTPException(404, {
        message: `Issues not found: ${missing.map((item) => `#${item}`).join(", ")}`
      });
    }
    await pullRequestService.replacePullRequestClosingIssueNumbers({
      repositoryId: repository.id,
      pullRequestId: existingPullRequest.id,
      pullRequestNumber: number,
      issueNumbers: patch.closeIssueNumbers
    });
  }

  const pullRequest = await pullRequestService.updatePullRequest(repository.id, number, patch);
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  const closingIssueNumbers = await pullRequestService.listPullRequestClosingIssueNumbers(repository.id, number);
  if (patch.state === "merged" && closingIssueNumbers.length > 0) {
    await issueService.closeIssuesByNumbers(repository.id, closingIssueNumbers);
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
      requestOrigin: new URL(c.req.url).origin
    });
  }

  return c.json({ pullRequest, closingIssueNumbers });
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
    prompt: sourceRun.prompt
  });

  await scheduleActionRunExecution({
    env: c.env,
    ...executionCtxArg(c),
    repository,
    run,
    triggeredByUser: sessionUser,
    requestOrigin: new URL(c.req.url).origin
  });

  return c.json({ run }, 202);
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

  const run = await actionsService.createRun({
    repositoryId: repository.id,
    workflowId: workflow.id,
    triggerEvent: workflow.trigger_event,
    ...(input.ref ? { triggerRef: input.ref } : {}),
    ...(input.sha ? { triggerSha: input.sha } : {}),
    triggeredBy: sessionUser.id,
    agentType: workflow.agent_type,
    prompt: workflow.prompt
  });

  await scheduleActionRunExecution({
    env: c.env,
    ...executionCtxArg(c),
    repository,
    run,
    triggeredByUser: sessionUser,
    requestOrigin: new URL(c.req.url).origin
  });

  return c.json({ run }, 202);
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
