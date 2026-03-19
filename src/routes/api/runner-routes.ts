import { SignJWT, jwtVerify } from "jose";
import {
  AgentSessionService,
  AuthService,
  HTTPException,
  mustSessionUser,
  requireSession
} from "./deps";
import {
  assertActionContainerInstanceType,
  assertPositiveIntegerInput,
  assertString,
  parseJsonObject,
  type ApiRouter
} from "./shared";
import { processCompletionCallback, type CompletionCallbackPayload } from "../../services/action-container-callback-service";
import { buildActionRunnerEnv } from "../../services/action-runner-config-service";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../../services/action-runner-prompt-tokens";
import {
  ACTIONS_SYSTEM_EMAIL,
  ACTIONS_SYSTEM_USERNAME
} from "../../services/auth-service";
import type {
  ActionAgentType,
  ActionContainerInstanceType,
  AgentSessionOrigin,
  AgentSessionSourceType
} from "../../types";

type PollSessionRow = {
  id: string;
  repository_id: string;
  session_number: number;
  agent_type: ActionAgentType;
  prompt: string;
  trigger_ref: string | null;
  trigger_sha: string | null;
  branch_ref: string | null;
  source_type: AgentSessionSourceType;
  source_number: number | null;
  origin: AgentSessionOrigin;
  instance_type: ActionContainerInstanceType;
  attempt_id: string;
  attempt_number: number;
  owner_username: string;
  repo_name: string;
};

type RunnerCallbackMeta = {
  repositoryId: string;
  sessionId: string;
  attemptId: string;
  instanceType: ActionContainerInstanceType;
  containerInstance: string;
  sessionNumber: number;
  attemptNumber: number;
};

type RunnerHeartbeatCallbackPayload = RunnerCallbackMeta & {
  type: "heartbeat";
  callbackToken: string;
  stdout?: string;
  stderr?: string;
};

type RunnerCompletionCallbackPayload = RunnerCallbackMeta & {
  type: "completion";
  callbackToken: string;
  exitCode: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  spawnError?: string;
  attemptedCommand?: string;
  mcpSetupWarning?: string;
};

type RunnerCallbackPayload = RunnerHeartbeatCallbackPayload | RunnerCompletionCallbackPayload;

function buildLocalRunnerContainerInstance(userId: string): string {
  return `local-runner-${userId}`;
}

function assertIntegerInput(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HTTPException(400, { message: `Field '${field}' must be an integer` });
  }
  return value;
}

function assertNonNegativeIntegerInput(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HTTPException(400, { message: `Field '${field}' must be a non-negative integer` });
  }
  return value;
}

function assertStringField(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string` });
  }
  return value;
}

function parseRunnerCallbackMeta(body: Record<string, unknown>): RunnerCallbackMeta {
  return {
    repositoryId: assertString(body.repositoryId, "repositoryId"),
    sessionId: assertString(body.sessionId, "sessionId"),
    attemptId: assertString(body.attemptId, "attemptId"),
    instanceType: assertActionContainerInstanceType(body.instanceType, "instanceType"),
    containerInstance: assertString(body.containerInstance, "containerInstance"),
    sessionNumber: assertPositiveIntegerInput(body.sessionNumber, "sessionNumber"),
    attemptNumber: assertPositiveIntegerInput(body.attemptNumber, "attemptNumber")
  };
}

function parseRunnerCallbackPayload(body: Record<string, unknown>): RunnerCallbackPayload {
  const type = assertString(body.type, "type");
  const base = {
    ...parseRunnerCallbackMeta(body),
    callbackToken: assertString(body.callbackToken, "callbackToken")
  };

  if (type === "heartbeat") {
    return {
      type,
      ...base,
      ...(body.stdout !== undefined ? { stdout: assertStringField(body.stdout, "stdout") } : {}),
      ...(body.stderr !== undefined ? { stderr: assertStringField(body.stderr, "stderr") } : {})
    };
  }

  if (type === "completion") {
    return {
      type,
      ...base,
      exitCode: assertIntegerInput(body.exitCode, "exitCode"),
      durationMs: assertNonNegativeIntegerInput(body.durationMs, "durationMs"),
      ...(body.stdout !== undefined ? { stdout: assertStringField(body.stdout, "stdout") } : {}),
      ...(body.stderr !== undefined ? { stderr: assertStringField(body.stderr, "stderr") } : {}),
      ...(body.error !== undefined ? { error: assertStringField(body.error, "error") } : {}),
      ...(body.spawnError !== undefined
        ? { spawnError: assertStringField(body.spawnError, "spawnError") }
        : {}),
      ...(body.attemptedCommand !== undefined
        ? { attemptedCommand: assertStringField(body.attemptedCommand, "attemptedCommand") }
        : {}),
      ...(body.mcpSetupWarning !== undefined
        ? { mcpSetupWarning: assertStringField(body.mcpSetupWarning, "mcpSetupWarning") }
        : {})
    };
  }

  throw new HTTPException(400, {
    message: "Field 'type' must be one of: heartbeat, completion"
  });
}

async function findQueuedLocalRunnerSession(input: {
  db: D1Database;
  userId: string;
  repositoryId?: string;
}): Promise<PollSessionRow | null> {
  const repositoryFilterSql = input.repositoryId ? "AND s.repository_id = ?" : "";
  const row = await input.db
    .prepare(
      `SELECT
        s.id,
        s.repository_id,
        s.session_number,
        s.agent_type,
        s.prompt,
        s.trigger_ref,
        s.trigger_sha,
        s.branch_ref,
        s.source_type,
        s.source_number,
        s.origin,
        s.instance_type,
        a.id AS attempt_id,
        a.attempt_number,
        u.username AS owner_username,
        r.name AS repo_name
       FROM agent_sessions s
       JOIN repositories r ON r.id = s.repository_id
       JOIN users u ON u.id = r.owner_id
       LEFT JOIN repository_collaborators rc
         ON rc.repository_id = r.id AND rc.user_id = ?
       JOIN agent_session_attempts a
         ON a.id = (
           SELECT a2.id
           FROM agent_session_attempts a2
           WHERE a2.session_id = s.id
             AND a2.runner_type = 'local'
             AND a2.status = 'queued'
           ORDER BY a2.attempt_number ASC
           LIMIT 1
         )
       WHERE s.runner_type = 'local'
         AND s.status = 'queued'
         AND (r.owner_id = ? OR rc.user_id IS NOT NULL)
         ${repositoryFilterSql}
       ORDER BY s.created_at ASC
       LIMIT 1`
    )
    .bind(
      input.userId,
      input.userId,
      ...(input.repositoryId ? [input.repositoryId] : [])
    )
    .first<PollSessionRow>();

  return row ?? null;
}

async function findClaimableLocalRunnerSession(input: {
  db: D1Database;
  userId: string;
  sessionId: string;
  attemptId: string;
}): Promise<PollSessionRow | null> {
  const row = await input.db
    .prepare(
      `SELECT
        s.id,
        s.repository_id,
        s.session_number,
        s.agent_type,
        s.prompt,
        s.trigger_ref,
        s.trigger_sha,
        s.branch_ref,
        s.source_type,
        s.source_number,
        s.origin,
        s.instance_type,
        a.id AS attempt_id,
        a.attempt_number,
        u.username AS owner_username,
        r.name AS repo_name
       FROM agent_sessions s
       JOIN repositories r ON r.id = s.repository_id
       JOIN users u ON u.id = r.owner_id
       LEFT JOIN repository_collaborators rc
         ON rc.repository_id = r.id AND rc.user_id = ?
       JOIN agent_session_attempts a
         ON a.session_id = s.id
        AND a.id = ?
        AND a.runner_type = 'local'
        AND a.status = 'queued'
       WHERE s.id = ?
         AND s.runner_type = 'local'
         AND s.status = 'queued'
         AND (r.owner_id = ? OR rc.user_id IS NOT NULL)
       LIMIT 1`
    )
    .bind(input.userId, input.attemptId, input.sessionId, input.userId)
    .first<PollSessionRow>();

  return row ?? null;
}

async function verifyLocalRunnerCallbackTarget(input: {
  db: D1Database;
  repositoryId: string;
  sessionId: string;
  attemptId: string;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `SELECT s.repository_id
       FROM agent_sessions s
       JOIN agent_session_attempts a
         ON a.session_id = s.id
        AND a.id = ?
        AND a.runner_type = 'local'
       WHERE s.id = ?
         AND s.runner_type = 'local'
       LIMIT 1`
    )
    .bind(input.attemptId, input.sessionId)
    .first<{ repository_id: string }>();

  return row?.repository_id === input.repositoryId;
}

function toRunnerPollResponse(session: PollSessionRow | null): {
  session: {
    id: string;
    repositoryId: string;
    sessionNumber: number;
    attemptId: string;
    attemptNumber: number;
    agentType: ActionAgentType;
    prompt: string;
    triggerRef: string | null;
    triggerSha: string | null;
    branchRef: string | null;
    sourceType: AgentSessionSourceType;
    sourceNumber: number | null;
    origin: AgentSessionOrigin;
  } | null;
} {
  if (!session) {
    return { session: null };
  }

  return {
    session: {
      id: session.id,
      repositoryId: session.repository_id,
      sessionNumber: session.session_number,
      attemptId: session.attempt_id,
      attemptNumber: session.attempt_number,
      agentType: session.agent_type,
      prompt: session.prompt,
      triggerRef: session.trigger_ref,
      triggerSha: session.trigger_sha,
      branchRef: session.branch_ref,
      sourceType: session.source_type,
      sourceNumber: session.source_number,
      origin: session.origin
    }
  };
}

export function registerRunnerRoutes(router: ApiRouter): void {
  router.get("/runner/poll", requireSession, async (c) => {
    const sessionUser = mustSessionUser(c);
    const repositoryId = c.req.query("repositoryId")?.trim() || undefined;
    const session = await findQueuedLocalRunnerSession({
      db: c.env.DB,
      userId: sessionUser.id,
      ...(repositoryId ? { repositoryId } : {})
    });

    return c.json(toRunnerPollResponse(session));
  });

  router.post("/runner/claim", requireSession, async (c) => {
    const sessionUser = mustSessionUser(c);
    const body = await parseJsonObject(c.req.raw);
    const sessionId = assertString(body.sessionId, "sessionId");
    const attemptId = assertString(body.attemptId, "attemptId");
    const session = await findClaimableLocalRunnerSession({
      db: c.env.DB,
      userId: sessionUser.id,
      sessionId,
      attemptId
    });

    if (!session) {
      throw new HTTPException(404, { message: "Queued local runner session not found" });
    }

    const containerInstance = buildLocalRunnerContainerInstance(sessionUser.id);
    const agentSessionService = new AgentSessionService(c.env.DB);
    const claimedAt = await agentSessionService.claimQueuedAttempt({
      repositoryId: session.repository_id,
      sessionId: session.id,
      attemptId: session.attempt_id,
      containerInstance
    });

    if (claimedAt === null) {
      throw new HTTPException(409, { message: "Queued attempt has already been claimed" });
    }

    const started = await agentSessionService.markAttemptRunning({
      repositoryId: session.repository_id,
      sessionId: session.id,
      attemptId: session.attempt_id,
      containerInstance,
      startedAt: claimedAt
    });
    if (started === null) {
      throw new HTTPException(409, { message: "Attempt is no longer claimable" });
    }

    const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
    const gitCloneToken = await authService.createAccessToken({
      userId: sessionUser.id,
      name: `local-runner-clone-${session.id}`,
      expiresAt: claimedAt + 15 * 60 * 1000
    });
    const needsIssueReplyToken =
      session.source_type === "issue" || session.prompt.includes(ISSUE_REPLY_TOKEN_PLACEHOLDER);
    const needsPrCreateToken =
      session.source_type === "issue" || session.prompt.includes(ISSUE_PR_CREATE_TOKEN_PLACEHOLDER);
    const issueReplyToken = needsIssueReplyToken
      ? await authService.createAccessToken({
          userId: sessionUser.id,
          name: `local-runner-issue-reply-${session.id}`,
          displayAsActions: true,
          expiresAt: claimedAt + 20 * 60 * 1000
        })
      : null;
    const prCreateToken = needsPrCreateToken
      ? await authService.createAccessToken({
          userId: sessionUser.id,
          name: `local-runner-pr-create-${session.id}`,
          displayAsActions: true,
          expiresAt: claimedAt + 20 * 60 * 1000
        })
      : null;
    let runtimePrompt = session.prompt;
    if (issueReplyToken) {
      runtimePrompt = runtimePrompt.replaceAll(
        ISSUE_REPLY_TOKEN_PLACEHOLDER,
        issueReplyToken.token
      );
    }
    if (prCreateToken) {
      runtimePrompt = runtimePrompt.replaceAll(
        ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
        prCreateToken.token
      );
    }
    const callbackToken = await new SignJWT({
      sessionId: session.id,
      attemptId: session.attempt_id,
      type: "runner-callback"
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(sessionUser.id)
      .setIssuedAt()
      .setExpirationTime("30m")
      .sign(new TextEncoder().encode(c.env.JWT_SECRET));

    const requestOrigin = new URL(c.req.url).origin;

    return c.json({
      claimed: true,
      callbackUrl: `${requestOrigin}/api/runner/callback`,
      callbackToken,
      gitCloneUrl: `${requestOrigin}/${session.owner_username}/${session.repo_name}.git`,
      gitCloneToken: gitCloneToken.token,
      gitCommitName: ACTIONS_SYSTEM_USERNAME,
      gitCommitEmail: ACTIONS_SYSTEM_EMAIL,
      agentType: session.agent_type,
      prompt: runtimePrompt,
      triggerRef: session.trigger_ref,
      triggerSha: session.trigger_sha,
      env: {
        ...buildActionRunnerEnv({
          repository: {
            id: session.repository_id,
            owner_username: session.owner_username,
            name: session.repo_name
          },
          session: {
            id: session.id,
            origin: session.origin,
            status: "running",
            branch_ref: session.branch_ref,
            source_type: session.source_type,
            source_number: session.source_number
          },
          sessionNumber: session.session_number,
          attemptId: session.attempt_id,
          attemptNumber: session.attempt_number,
          requestOrigin
        }),
        ...(issueReplyToken ? { GITS_ISSUE_REPLY_TOKEN: issueReplyToken.token } : {}),
        ...(prCreateToken ? { GITS_PR_CREATE_TOKEN: prCreateToken.token } : {})
      },
      sessionId: session.id,
      attemptId: session.attempt_id,
      sessionNumber: session.session_number,
      attemptNumber: session.attempt_number,
      instanceType: session.instance_type
    });
  });

  router.post("/runner/callback", async (c) => {
    const payload = parseRunnerCallbackPayload(await parseJsonObject(c.req.raw));
    const verified = await jwtVerify(
      payload.callbackToken,
      new TextEncoder().encode(c.env.JWT_SECRET),
      {
        algorithms: ["HS256"]
      }
    ).catch(() => null);

    if (!verified) {
      throw new HTTPException(401, { message: "Invalid callback token" });
    }

    const subject = verified.payload.sub;
    const tokenSessionId = verified.payload.sessionId;
    const tokenAttemptId = verified.payload.attemptId;
    const tokenType = verified.payload.type;

    if (
      typeof subject !== "string" ||
      typeof tokenSessionId !== "string" ||
      typeof tokenAttemptId !== "string" ||
      tokenType !== "runner-callback"
    ) {
      throw new HTTPException(401, { message: "Invalid callback token" });
    }

    if (tokenSessionId !== payload.sessionId || tokenAttemptId !== payload.attemptId) {
      throw new HTTPException(403, { message: "Callback token does not match payload" });
    }

    if (payload.containerInstance !== buildLocalRunnerContainerInstance(subject)) {
      throw new HTTPException(403, { message: "Callback container instance is invalid" });
    }

    const validTarget = await verifyLocalRunnerCallbackTarget({
      db: c.env.DB,
      repositoryId: payload.repositoryId,
      sessionId: payload.sessionId,
      attemptId: payload.attemptId
    });
    if (!validTarget) {
      throw new HTTPException(404, { message: "Local runner attempt not found" });
    }

    if (payload.type === "heartbeat") {
      const attempt = await c.env.DB
        .prepare(
          `SELECT status FROM agent_session_attempts
           WHERE repository_id = ? AND session_id = ? AND id = ? AND runner_type = 'local'
           LIMIT 1`
        )
        .bind(payload.repositoryId, payload.sessionId, payload.attemptId)
        .first<{ status: string }>();

      if (attempt && attempt.status !== "cancelled" && attempt.status !== "failed" && attempt.status !== "success") {
        await c.env.DB
          .prepare(
            `UPDATE agent_session_attempts
             SET updated_at = ?
             WHERE repository_id = ? AND session_id = ? AND id = ? AND runner_type = 'local'`
          )
          .bind(Date.now(), payload.repositoryId, payload.sessionId, payload.attemptId)
          .run();
      }

      const cancelled = !attempt || attempt.status === "cancelled";
      return c.json({ ok: true, cancelled });
    }

    await processCompletionCallback({
      env: c.env,
      payload: {
        ...payload,
        callbackSecret: ""
      } satisfies CompletionCallbackPayload,
      requestOrigin: new URL(c.req.url).origin,
      secretsToRedact: [payload.callbackToken]
    });

    return c.json({ ok: true });
  });
}
