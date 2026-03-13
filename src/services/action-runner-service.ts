import type {
  ActionContainerInstanceType,
  AgentSessionAttemptRecord,
  AgentSessionRecord,
  AppBindings,
  AuthUser,
  RepositoryRecord
} from "../types";
import { createSecretRedactor } from "../utils/secret-redaction";
import { AgentSessionService } from "./agent-session-service";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "./action-runner-prompt-tokens";
import {
  classifyAttemptFailure,
  nextInstanceType
} from "./action-container-callback-service";
import { getActionRunnerNamespace } from "./action-container-instance-types";
import { ActionLogStorageService } from "./action-log-storage-service";
import { ActionsService } from "./actions-service";
import { ACTIONS_SYSTEM_EMAIL, ACTIONS_SYSTEM_USERNAME } from "./auth-service";
import { createRepositoryObjectClient } from "./repository-object";
import { buildSessionLifecycleLines } from "./session-log-format";
import { WorkflowTaskFlowService } from "./workflow-task-flow-service";

const DEFAULT_ACTION_CONTAINER_INSTANCE_TYPE = "lite";
const MAX_SESSION_LOG_CHARS = 120_000;
const CODEX_CONFIG_FILE_PATH = "/home/rootless/.codex/config.toml";
const CLAUDE_CODE_CONFIG_FILE_PATH = "/home/rootless/.claude/settings.json";

function normalizeCloneOrigin(input: { requestOrigin: string }): string {
  return input.requestOrigin;
}

function truncateLog(logs: string): string {
  if (logs.length <= MAX_SESSION_LOG_CHARS) {
    return logs;
  }
  const retained = logs.slice(logs.length - MAX_SESSION_LOG_CHARS);
  return `[truncated ${logs.length - MAX_SESSION_LOG_CHARS} chars]\n${retained}`;
}

function appendSessionLogSection(logs: string, section: string, detail: string): string {
  const trimmedDetail = detail.trim();
  if (!trimmedDetail) {
    return logs;
  }
  const separator = logs.endsWith("\n") ? "" : "\n";
  return truncateLog(`${logs}${separator}\n[${section}]\n${trimmedDetail}`);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildStartupSessionLogs(input: {
  sessionId: string;
  sessionNumber: number;
  attemptId: string;
  attemptNumber: number;
  instanceType: ActionContainerInstanceType;
  agentType: "codex" | "claude_code";
  prompt: string;
  claimedAt?: number | null;
  errorMessage?: string;
  redactText: (input: string) => string;
}): string {
  const lines: string[] = [];
  lines.push(`session_id: ${input.sessionId}`);
  lines.push(`session_number: ${input.sessionNumber}`);
  lines.push(`attempt_id: ${input.attemptId}`);
  lines.push(`attempt_number: ${input.attemptNumber}`);
  lines.push(`instance_type: ${input.instanceType}`);
  lines.push(`agent_type: ${input.agentType}`);
  lines.push(`prompt: ${input.redactText(input.prompt)}`);
  lines.push("");
  lines.push(
    ...buildSessionLifecycleLines(
      {
        claimedAt: input.claimedAt,
        startedAt: null,
        reconciledAt: null
      },
      { includeMissing: true }
    )
  );

  if (input.errorMessage) {
    lines.push("");
    lines.push("[error]");
    lines.push(input.redactText(input.errorMessage));
  }

  return truncateLog(lines.join("\n"));
}

function parseLifecycleStartedAt(response: Response): number | null {
  const rawValue = response.headers.get("x-gits-run-started-at");
  if (!rawValue) {
    return null;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function parseRunnerStartResponse(response: Response): Promise<{
  started: boolean;
  startedAt: number | null;
  message: string | null;
}> {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  if (!bodyText.trim()) {
    return {
      started: false,
      startedAt: parseLifecycleStartedAt(response),
      message: null
    };
  }

  try {
    const payload = JSON.parse(bodyText) as Record<string, unknown>;
    return {
      started: payload.started === true,
      startedAt:
        typeof payload.startedAt === "number"
          ? payload.startedAt
          : parseLifecycleStartedAt(response),
      message: typeof payload.message === "string" ? payload.message : null
    };
  } catch {
    return {
      started: false,
      startedAt: parseLifecycleStartedAt(response),
      message: bodyText.trim() || null
    };
  }
}

function buildContainerInstanceName(sessionId: string, attempt: AgentSessionAttemptRecord): string {
  return `agent-session-${sessionId}-attempt-${attempt.attempt_number}`;
}

export async function executeActionRun(input: {
  env: Pick<
    AppBindings,
    | "DB"
    | "GIT_BUCKET"
    | "ACTION_LOGS_BUCKET"
    | "REPOSITORY_OBJECTS"
    | "JWT_SECRET"
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
    | "ACTIONS_QUEUE"
  >;
  repository: RepositoryRecord;
  session: AgentSessionRecord;
  attempt?: AgentSessionAttemptRecord;
  triggeredByUser?: AuthUser;
  requestOrigin: string;
}): Promise<void> {
  const actionsService = new ActionsService(input.env.DB);
  const actionLogStorage = new ActionLogStorageService(input.env.ACTION_LOGS_BUCKET ?? input.env.GIT_BUCKET);
  const agentSessionService = new AgentSessionService(input.env.DB, actionLogStorage);
  const workflowTaskFlowService = new WorkflowTaskFlowService(
    input.env.DB,
    createRepositoryObjectClient(input.env)
  );

  const sessionId = input.session.id;
  const attempt: AgentSessionAttemptRecord =
    input.attempt ??
    ({
      id: input.session.active_attempt_id ?? input.session.latest_attempt_id ?? `${sessionId}-attempt-1`,
      session_id: sessionId,
      repository_id: input.repository.id,
      attempt_number: 1,
      status: "queued",
      instance_type: input.session.instance_type,
      promoted_from_instance_type: null,
      container_instance: input.session.container_instance,
      exit_code: input.session.exit_code,
      failure_reason: input.session.failure_reason ?? null,
      failure_stage: input.session.failure_stage ?? null,
      created_at: input.session.created_at,
      claimed_at: input.session.claimed_at,
      started_at: input.session.started_at,
      completed_at: input.session.completed_at,
      updated_at: input.session.updated_at
    } satisfies AgentSessionAttemptRecord);
  const sessionNumber = input.session.session_number;
  const attemptInstanceType =
    attempt.instance_type ?? input.session.instance_type ?? DEFAULT_ACTION_CONTAINER_INSTANCE_TYPE;
  const containerInstance = buildContainerInstanceName(sessionId, attempt);
  const claimedAt = await agentSessionService.claimQueuedAttempt({
    repositoryId: input.repository.id,
    sessionId,
    attemptId: attempt.id,
    containerInstance
  });
  if (claimedAt === null) {
    return;
  }

  const redactLogs = createSecretRedactor();

  const persistObservability = async (logs: string, recordedAt?: number): Promise<void> => {
    try {
      await agentSessionService.recordSessionObservability({
        repositoryId: input.repository.id,
        sessionId,
        logs,
        ...(recordedAt !== undefined ? { recordedAt } : {})
      });
    } catch (error) {
      console.warn("action boot observability write failed", {
        repositoryId: input.repository.id,
        sessionId,
        attemptId: attempt.id,
        error: toErrorMessage(error)
      });
    }
  };

  const wasCancelledExternally = async (): Promise<boolean> => {
    const latestAttempt = await agentSessionService.findAttemptById(input.repository.id, attempt.id);
    return latestAttempt?.status === "cancelled";
  };

  const reconcileSourceTaskStatus = async (): Promise<string | null> => {
    const sourceType = input.session.source_type === "manual" ? null : input.session.source_type;
    if ((sourceType !== "issue" && sourceType !== "pull_request") || input.session.source_number === null) {
      return null;
    }

    try {
      await workflowTaskFlowService.reconcileSourceTaskStatus({
        repository: input.repository,
        sourceType,
        sourceNumber: input.session.source_number
      });
      return null;
    } catch (error) {
      const message = toErrorMessage(error);
      console.error("action attempt status reconciliation failed", {
        repositoryId: input.repository.id,
        sessionId,
        attemptId: attempt.id,
        sourceType,
        sourceNumber: input.session.source_number,
        error: message
      });
      return `source=${sourceType} #${input.session.source_number}: ${message}`;
    }
  };

  const scheduleRetry = async (
    classification: ReturnType<typeof classifyAttemptFailure>,
    completedAt: number
  ): Promise<boolean> => {
    if (!classification.retryable || attempt.attempt_number >= 2 || !input.env.ACTIONS_QUEUE) {
      return false;
    }

    const promotedInstanceType = classification.promoteInstanceType
      ? nextInstanceType(attemptInstanceType)
      : null;
    const nextAttempt = await agentSessionService.createRetryAttempt({
      repositoryId: input.repository.id,
      sessionId,
      instanceType: promotedInstanceType ?? attemptInstanceType,
      promotedFromInstanceType: promotedInstanceType ? attemptInstanceType : null,
      createdAt: completedAt
    });

    await agentSessionService.appendAttemptEvents(input.repository.id, sessionId, attempt.id, [
      {
        type: "retry_scheduled",
        stream: "system",
        message: `Retry scheduled as attempt #${nextAttempt.attempt_number}.`,
        payload: {
          nextAttemptId: nextAttempt.id,
          nextAttemptNumber: nextAttempt.attempt_number,
          nextInstanceType: nextAttempt.instance_type,
          promotedFromInstanceType: nextAttempt.promoted_from_instance_type
        },
        createdAt: completedAt
      }
    ]);

    await agentSessionService.syncSessionForAttempt({
      repositoryId: input.repository.id,
      sessionId,
      sessionStatus: "queued",
      activeAttemptId: nextAttempt.id,
      latestAttemptId: nextAttempt.id,
      exitCode: null,
      containerInstance: null,
      failureReason: null,
      failureStage: null,
      updatedAt: completedAt
    });

    await input.env.ACTIONS_QUEUE.send({
      repositoryId: input.repository.id,
      sessionId,
      attemptId: nextAttempt.id,
      requestOrigin: input.requestOrigin
    });

    return true;
  };

  const finalizeFailedAttempt = async (args: {
    message: string;
    responseStatus?: number;
  }): Promise<void> => {
    let logs = buildStartupSessionLogs({
      sessionId,
      sessionNumber,
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      instanceType: attemptInstanceType,
      agentType: input.session.agent_type,
      prompt: input.session.prompt,
      claimedAt,
      errorMessage: args.message,
      redactText: redactLogs
    });
    await persistObservability(logs);

    if (await wasCancelledExternally()) {
      return;
    }

    const classification = classifyAttemptFailure({
      ...(args.responseStatus !== undefined ? { responseStatus: args.responseStatus } : {}),
      errorMessage: args.message
    });
    const completedAt = Date.now();
    const retryScheduled = await scheduleRetry(classification, completedAt);

    await agentSessionService.completeAttempt({
      repositoryId: input.repository.id,
      sessionId,
      attemptId: attempt.id,
      status: retryScheduled ? "retryable_failed" : "failed",
      exitCode: null,
      failureReason: classification.reason,
      failureStage: classification.stage,
      completedAt
    });

    if (retryScheduled) {
      return;
    }

    const warning = await reconcileSourceTaskStatus();
    if (warning) {
      logs = appendSessionLogSection(logs, "status_reconciliation_warning", warning);
      await persistObservability(logs, completedAt);
    }

    await agentSessionService.syncSessionForAttempt({
      repositoryId: input.repository.id,
      sessionId,
      sessionStatus: "failed",
      activeAttemptId: null,
      latestAttemptId: attempt.id,
      exitCode: null,
      containerInstance: null,
      failureReason: classification.reason,
      failureStage: classification.stage,
      completedAt,
      updatedAt: completedAt
    });
  };

  const actionsRunner = getActionRunnerNamespace(input.env, attemptInstanceType);
  if (!actionsRunner) {
    await finalizeFailedAttempt({
      message: `Actions runner binding is not configured for instance type '${attemptInstanceType}'`
    });
    return;
  }

  try {
    const repositoryConfig = await actionsService.getRepositoryConfig(input.repository.id);
    const repositoryOrigin = normalizeCloneOrigin({
      requestOrigin: input.requestOrigin
    });
    const canIssueComment = true;
    const canCreatePr = true;
    const canGitPush = true;
    const needsIssueReplyToken =
      input.triggeredByUser !== undefined &&
      canIssueComment &&
      (input.session.source_type === "issue" ||
        input.session.prompt.includes(ISSUE_REPLY_TOKEN_PLACEHOLDER));
    const needsPrCreateToken =
      input.triggeredByUser !== undefined &&
      canCreatePr &&
      (input.session.source_type === "issue" ||
        input.session.prompt.includes(ISSUE_PR_CREATE_TOKEN_PLACEHOLDER));

    const envVars: Record<string, string> = {
      GITS_ACTION_RUN_ID: sessionId,
      GITS_ACTION_RUN_NUMBER: String(sessionNumber),
      GITS_ACTION_ATTEMPT_ID: attempt.id,
      GITS_ACTION_ATTEMPT_NUMBER: String(attempt.attempt_number),
      GITS_REPOSITORY: `${input.repository.owner_username}/${input.repository.name}`,
      GITS_PLATFORM_API_BASE: repositoryOrigin,
      GITS_REPOSITORY_OWNER: input.repository.owner_username,
      GITS_REPOSITORY_NAME: input.repository.name,
      ...(input.session.source_type === "issue" && input.session.source_number !== null
        ? { GITS_TRIGGER_ISSUE_NUMBER: String(input.session.source_number) }
        : {}),
      GITS_AGENT_SESSION_ID: input.session.id,
      GITS_AGENT_SESSION_ORIGIN: input.session.origin,
      GITS_AGENT_SESSION_STATUS: input.session.status,
      GITS_AGENT_SESSION_BRANCH_REF: input.session.branch_ref ?? ""
    };

    const configFiles: Record<string, string> = {};
    if (repositoryConfig.codexConfigFileContent.length > 0) {
      configFiles[CODEX_CONFIG_FILE_PATH] = repositoryConfig.codexConfigFileContent;
    }
    if (repositoryConfig.claudeCodeConfigFileContent.length > 0) {
      configFiles[CLAUDE_CODE_CONFIG_FILE_PATH] = repositoryConfig.claudeCodeConfigFileContent;
    }

    const runnerResponse = await actionsRunner
      .getByName(containerInstance)
      .fetch("https://actions-container.internal/execute", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agentType: input.session.agent_type,
          prompt: input.session.prompt,
          repositoryId: input.repository.id,
          requestOrigin: repositoryOrigin,
          sessionId,
          attemptId: attempt.id,
          runId: sessionId,
          containerInstance,
          repositoryUrl: `${repositoryOrigin}/${input.repository.owner_username}/${input.repository.name}.git`,
          ref: input.session.trigger_ref ?? undefined,
          sha: input.session.trigger_sha ?? undefined,
          runNumber: sessionNumber,
          attemptNumber: attempt.attempt_number,
          triggeredByUserId: input.triggeredByUser?.id,
          triggeredByUsername: input.triggeredByUser?.username,
          triggerSourceType: input.session.source_type === "manual" ? null : input.session.source_type,
          enableIssueReplyToken: needsIssueReplyToken,
          enablePrCreateToken: needsPrCreateToken,
          allowGitPush: canGitPush,
          gitCommitName: ACTIONS_SYSTEM_USERNAME,
          gitCommitEmail: ACTIONS_SYSTEM_EMAIL,
          env: envVars,
          configFiles
        })
      });

    const started = await parseRunnerStartResponse(runnerResponse);
    if (runnerResponse.ok && started.started) {
      return;
    }

    const message =
      started.message ??
      (!runnerResponse.ok
        ? `Container runner responded with HTTP ${runnerResponse.status}`
        : "Container runner did not confirm startup");
    await finalizeFailedAttempt({
      message,
      responseStatus: runnerResponse.status
    });
  } catch (error) {
    await finalizeFailedAttempt({
      message: toErrorMessage(error)
    });
  }
}
