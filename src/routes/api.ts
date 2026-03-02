import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { mustSessionUser, optionalSession, requireSession } from "../middleware/auth";
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

type CreatePullRequestInput = {
  title: string;
  body?: string;
  baseRef: string;
  headRef: string;
};

type UpdatePullRequestInput = {
  title?: string;
  body?: string;
  state?: PullRequestState;
};

type CreatePullRequestReviewInput = {
  decision: PullRequestReviewDecision;
  body?: string;
};

const USERNAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,30}[A-Za-z0-9])?$/;
const REPO_NAME_REGEX = /^[A-Za-z0-9._-]{1,100}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function assertPositiveInteger(value: string, field: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HTTPException(400, { message: `Field '${field}' must be a positive integer` });
  }
  return parsed;
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
  const issue = await issueService.updateIssue(repository.id, number, patch);
  if (!issue) {
    throw new HTTPException(404, { message: "Issue not found" });
  }
  return c.json({ issue });
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
  const reviewSummary = await pullRequestService.summarizePullRequestReviews(repository.id, number);
  return c.json({ pullRequest, reviewSummary });
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
    return c.json({ pullRequest }, 201);
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
  if (payload.state !== undefined) {
    const nextState = assertPullRequestState(payload.state);
    if (nextState === "merged") {
      throw new HTTPException(400, {
        message: "Merging pull requests is not supported yet"
      });
    }
    patch.state = nextState;
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

  const pullRequestService = new PullRequestService(c.env.DB);
  const pullRequest = await pullRequestService.updatePullRequest(repository.id, number, patch);
  if (!pullRequest) {
    throw new HTTPException(404, { message: "Pull request not found" });
  }
  return c.json({ pullRequest });
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
