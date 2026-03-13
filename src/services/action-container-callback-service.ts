import type {
  ActionContainerInstanceType,
  AgentSessionAttemptFailureReason,
  AgentSessionAttemptFailureStage,
  AgentSessionAttemptRecord,
  AgentSessionRecord,
  AgentSessionValidationReport,
  AppBindings,
  RepositoryRecord
} from "../types";
import { createSecretRedactor } from "../utils/secret-redaction";
import { AgentSessionService } from "./agent-session-service";
import {
  ACTION_CONTAINER_INSTANCE_TYPES,
  getActionRunnerNamespace
} from "./action-container-instance-types";
import { ActionLogStorageService } from "./action-log-storage-service";
import {
  extractValidationReportFromText,
  parseAgentSessionValidationReport
} from "./agent-session-validation-report";
import { createRepositoryObjectClient } from "./repository-object";
import { buildSessionLifecycleLines } from "./session-log-format";
import { WorkflowTaskFlowService } from "./workflow-task-flow-service";

type ActionRunnerBindings = Pick<
  AppBindings,
  | "ACTIONS_RUNNER"
  | "ACTIONS_RUNNER_BASIC"
  | "ACTIONS_RUNNER_STANDARD_1"
  | "ACTIONS_RUNNER_STANDARD_2"
  | "ACTIONS_RUNNER_STANDARD_3"
  | "ACTIONS_RUNNER_STANDARD_4"
>;

type AttemptFailureClassification = {
  reason: AgentSessionAttemptFailureReason;
  stage: AgentSessionAttemptFailureStage;
  retryable: boolean;
  promoteInstanceType: boolean;
};

type CompletionResult = {
  exitCode: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  spawnError?: string;
  attemptedCommand?: string;
  mcpSetupWarning?: string;
  validationReport?: AgentSessionValidationReport;
};

export type CallbackMeta = {
  repositoryId: string;
  sessionId: string;
  attemptId: string;
  instanceType: ActionContainerInstanceType;
  containerInstance: string;
  sessionNumber: number;
  attemptNumber: number;
};

export type HeartbeatCallbackPayload = {
  type: "heartbeat";
  callbackSecret: string;
  stdout?: string;
  stderr?: string;
} & CallbackMeta;

export type CompletionCallbackPayload = {
  type: "completion";
  callbackSecret: string;
  exitCode: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  spawnError?: string;
  attemptedCommand?: string;
  mcpSetupWarning?: string;
} & CallbackMeta;

export type ContainerCallbackPayload = HeartbeatCallbackPayload | CompletionCallbackPayload;

function appendSessionLogSection(logs: string, section: string, detail: string): string {
  const trimmedDetail = detail.trim();
  if (!trimmedDetail) {
    return logs;
  }
  const separator = logs.endsWith("\n") ? "" : "\n";
  return `${logs}${separator}\n[${section}]\n${trimmedDetail}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildCompletionSessionLogs(input: {
  sessionId: string;
  sessionNumber: number;
  attemptId: string;
  attemptNumber: number;
  instanceType: ActionContainerInstanceType;
  session?: Pick<AgentSessionRecord, "agent_type" | "prompt" | "claimed_at" | "started_at"> | null;
  attempt?: Pick<AgentSessionAttemptRecord, "claimed_at" | "started_at"> | null;
  result: CompletionResult;
  completedAt?: number;
  redactText: (input: string) => string;
}): string {
  const lines: string[] = [];
  lines.push(`session_id: ${input.sessionId}`);
  lines.push(`session_number: ${input.sessionNumber}`);
  lines.push(`attempt_id: ${input.attemptId}`);
  lines.push(`attempt_number: ${input.attemptNumber}`);
  lines.push(`instance_type: ${input.instanceType}`);

  if (input.session?.agent_type) {
    lines.push(`agent_type: ${input.session.agent_type}`);
  }
  if (input.session?.prompt) {
    lines.push(`prompt: ${input.redactText(input.session.prompt)}`);
  }

  lines.push("");
  lines.push(
    ...buildSessionLifecycleLines(
      {
        claimedAt: input.attempt?.claimed_at ?? input.session?.claimed_at,
        startedAt: input.attempt?.started_at ?? input.session?.started_at,
        reconciledAt: input.completedAt
      },
      { includeMissing: true }
    )
  );

  lines.push(`duration_ms: ${input.result.durationMs}`);
  lines.push(`exit_code: ${input.result.exitCode}`);

  if (input.result.error) {
    lines.push("");
    lines.push("[runner_error]");
    lines.push(input.redactText(input.result.error));
  }

  if (input.result.spawnError) {
    lines.push("");
    lines.push("[runner_spawn_error]");
    lines.push(input.redactText(input.result.spawnError));
  }

  if (input.result.mcpSetupWarning) {
    lines.push("");
    lines.push("[mcp_setup]");
    lines.push(input.redactText(input.result.mcpSetupWarning));
  }

  if (input.result.attemptedCommand) {
    lines.push("");
    lines.push("[attempted]");
    lines.push(input.redactText(input.result.attemptedCommand));
  }

  if (input.result.stdout) {
    lines.push("");
    lines.push("[stdout]");
    lines.push(input.redactText(input.result.stdout));
  }

  if (input.result.stderr) {
    lines.push("");
    lines.push("[stderr]");
    lines.push(input.redactText(input.result.stderr));
  }

  return lines.join("\n");
}

async function findRepositoryById(
  db: D1Database,
  repositoryId: string
): Promise<RepositoryRecord | null> {
  const row = await db
    .prepare(
      `SELECT
        r.id,
        r.owner_id,
        u.username AS owner_username,
        r.name,
        r.description,
        r.is_private,
        r.created_at
       FROM repositories r
       JOIN users u ON u.id = r.owner_id
       WHERE r.id = ?
       LIMIT 1`
    )
    .bind(repositoryId)
    .first<RepositoryRecord>();

  return row ?? null;
}

async function reconcileSourceTaskStatus(
  workflowTaskFlowService: WorkflowTaskFlowService,
  env: Pick<AppBindings, "DB">,
  session: AgentSessionRecord,
  payload: CallbackMeta
): Promise<string | null> {
  const sourceType = session.source_type === "manual" ? null : session.source_type;
  if ((sourceType !== "issue" && sourceType !== "pull_request") || session.source_number === null) {
    return null;
  }

  const repository = await findRepositoryById(env.DB, payload.repositoryId);
  if (!repository) {
    const message = `repository=${payload.repositoryId}: repository not found`;
    console.error("action attempt status reconciliation failed", {
      repositoryId: payload.repositoryId,
      sessionId: payload.sessionId,
      attemptId: payload.attemptId,
      sourceType,
      sourceNumber: session.source_number,
      error: message
    });
    return message;
  }

  try {
    await workflowTaskFlowService.reconcileSourceTaskStatus({
      repository,
      sourceType,
      sourceNumber: session.source_number
    });
    return null;
  } catch (error) {
    const message = toErrorMessage(error);
    console.error("action attempt status reconciliation failed", {
      repositoryId: payload.repositoryId,
      sessionId: payload.sessionId,
      attemptId: payload.attemptId,
      sourceType,
      sourceNumber: session.source_number,
      error: message
    });
    return `source=${sourceType} #${session.source_number}: ${message}`;
  }
}

async function scheduleRetry(input: {
  agentSessionService: AgentSessionService;
  env: Pick<AppBindings, "ACTIONS_QUEUE">;
  payload: CompletionCallbackPayload;
  classification: AttemptFailureClassification;
  requestOrigin: string;
  completedAt: number;
}): Promise<boolean> {
  if (
    !input.classification.retryable ||
    input.payload.attemptNumber >= 2 ||
    !input.env.ACTIONS_QUEUE
  ) {
    return false;
  }

  const promotedInstanceType = input.classification.promoteInstanceType
    ? nextInstanceType(input.payload.instanceType)
    : null;
  const nextAttempt = await input.agentSessionService.createRetryAttempt({
    repositoryId: input.payload.repositoryId,
    sessionId: input.payload.sessionId,
    instanceType: promotedInstanceType ?? input.payload.instanceType,
    promotedFromInstanceType: promotedInstanceType ? input.payload.instanceType : null,
    createdAt: input.completedAt
  });

  await input.agentSessionService.appendAttemptEvents(
    input.payload.repositoryId,
    input.payload.sessionId,
    input.payload.attemptId,
    [
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
        createdAt: input.completedAt
      }
    ]
  );

  await input.agentSessionService.syncSessionForAttempt({
    repositoryId: input.payload.repositoryId,
    sessionId: input.payload.sessionId,
    sessionStatus: "queued",
    activeAttemptId: nextAttempt.id,
    latestAttemptId: nextAttempt.id,
    exitCode: null,
    containerInstance: null,
    failureReason: null,
    failureStage: null,
    updatedAt: input.completedAt
  });

  await input.env.ACTIONS_QUEUE.send({
    repositoryId: input.payload.repositoryId,
    sessionId: input.payload.sessionId,
    attemptId: nextAttempt.id,
    requestOrigin: input.requestOrigin
  });

  return true;
}

export function nextInstanceType(
  instanceType: ActionContainerInstanceType
): ActionContainerInstanceType | null {
  const index = ACTION_CONTAINER_INSTANCE_TYPES.indexOf(instanceType);
  if (index === -1 || index === ACTION_CONTAINER_INSTANCE_TYPES.length - 1) {
    return null;
  }
  return ACTION_CONTAINER_INSTANCE_TYPES[index + 1] ?? null;
}

export function classifyAttemptFailure(input: {
  responseStatus?: number;
  result?: {
    exitCode?: number;
    error?: string;
    spawnError?: string;
    stderr?: string;
  };
  errorMessage?: string;
}): AttemptFailureClassification {
  const diagnostics = [
    input.errorMessage,
    input.result?.error,
    input.result?.spawnError,
    input.result?.stderr
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();

  const exitCode = input.result?.exitCode ?? null;
  const resourcePressure =
    exitCode === 137 ||
    exitCode === 143 ||
    diagnostics.includes("out of memory") ||
    diagnostics.includes("oom") ||
    diagnostics.includes("killed");
  const bootTimeout =
    diagnostics.includes("port ready timeout") ||
    diagnostics.includes("timed out waiting for port") ||
    diagnostics.includes("timed out waiting for container") ||
    diagnostics.includes("boot timeout");
  const containerInfraError =
    diagnostics.includes("internal error; reference") ||
    diagnostics.includes("durable object") ||
    diagnostics.includes("startandwaitforports") ||
    diagnostics.includes("container startup failed") ||
    diagnostics.includes("container failed to start") ||
    diagnostics.includes("container unavailable");

  if (diagnostics.includes("missing result event")) {
    return {
      reason: "missing_result",
      stage: "result",
      retryable: true,
      promoteInstanceType: false
    };
  }
  if (diagnostics.includes("stream terminated unexpectedly") || diagnostics.includes("runner stream")) {
    return {
      reason: "stream_disconnected",
      stage: "result",
      retryable: true,
      promoteInstanceType: false
    };
  }
  if (diagnostics.includes("dockerd")) {
    return {
      reason: "dockerd_bootstrap_failed",
      stage: "boot",
      retryable: true,
      promoteInstanceType: resourcePressure
    };
  }
  if (bootTimeout || containerInfraError) {
    return {
      reason: bootTimeout ? "boot_timeout" : "container_error",
      stage: "boot",
      retryable: true,
      promoteInstanceType: resourcePressure || bootTimeout
    };
  }
  if (diagnostics.includes("clone")) {
    return {
      reason: "git_clone_failed",
      stage: "workspace",
      retryable: false,
      promoteInstanceType: false
    };
  }
  if (diagnostics.includes("checkout")) {
    return {
      reason: "git_checkout_failed",
      stage: "workspace",
      retryable: false,
      promoteInstanceType: false
    };
  }
  if (resourcePressure) {
    return {
      reason: "unknown_infra_failure",
      stage: "runtime",
      retryable: true,
      promoteInstanceType: true
    };
  }
  if ((input.responseStatus ?? 200) >= 500) {
    return {
      reason: "unknown_infra_failure",
      stage: "runtime",
      retryable: true,
      promoteInstanceType: false
    };
  }
  if (exitCode !== null && exitCode !== 0) {
    return {
      reason: "agent_exit_non_zero",
      stage: "runtime",
      retryable: false,
      promoteInstanceType: false
    };
  }
  return {
    reason: "unknown_task_failure",
    stage: "unknown",
    retryable: false,
    promoteInstanceType: false
  };
}

export async function handleContainerHeartbeat(input: {
  env: Pick<AppBindings, "DB" | "GIT_BUCKET" | "ACTION_LOGS_BUCKET"> & ActionRunnerBindings;
  payload: HeartbeatCallbackPayload;
}): Promise<void> {
  const verified = await verifyCallbackSecret(input.env, input.payload);
  if (!verified) {
    return;
  }

  const actionsRunner = getActionRunnerNamespace(input.env, input.payload.instanceType);
  if (!actionsRunner) {
    return;
  }

  try {
    await actionsRunner
      .getByName(input.payload.containerInstance)
      .fetch("https://actions-container.internal/keepalive", { method: "POST" });
  } catch {
    // best-effort keepalive
  }
}

export async function handleContainerCompletion(input: {
  env: Pick<
    AppBindings,
    | "DB"
    | "GIT_BUCKET"
    | "ACTION_LOGS_BUCKET"
    | "REPOSITORY_OBJECTS"
    | "JWT_SECRET"
    | "ACTIONS_QUEUE"
  > &
    ActionRunnerBindings;
  payload: CompletionCallbackPayload;
  requestOrigin: string;
}): Promise<void> {
  const verified = await verifyCallbackSecret(input.env, input.payload);
  if (!verified) {
    console.warn("container completion callback secret verification failed", {
      repositoryId: input.payload.repositoryId,
      sessionId: input.payload.sessionId,
      attemptId: input.payload.attemptId
    });
    return;
  }

  const actionLogStorage = new ActionLogStorageService(input.env.ACTION_LOGS_BUCKET ?? input.env.GIT_BUCKET);
  const agentSessionService = new AgentSessionService(input.env.DB, actionLogStorage);
  const workflowTaskFlowService = new WorkflowTaskFlowService(
    input.env.DB,
    createRepositoryObjectClient(input.env)
  );
  const redactText = createSecretRedactor([input.payload.callbackSecret]);

  const session = await agentSessionService.findSessionById(
    input.payload.repositoryId,
    input.payload.sessionId
  );
  const attempt = await agentSessionService.findAttemptById(
    input.payload.repositoryId,
    input.payload.attemptId
  );

  const payloadValidationReport = parseAgentSessionValidationReport(
    (input.payload as CompletionCallbackPayload & { validationReport?: unknown }).validationReport
  );
  let validationReport = payloadValidationReport;
  let cleanedStdout = input.payload.stdout ?? "";
  let cleanedStderr = input.payload.stderr ?? "";

  if (cleanedStdout) {
    const extracted = extractValidationReportFromText(cleanedStdout);
    cleanedStdout = extracted.cleanedText;
    validationReport = extracted.report ?? validationReport;
  }

  if (cleanedStderr) {
    const extracted = extractValidationReportFromText(cleanedStderr);
    cleanedStderr = extracted.cleanedText;
    validationReport = extracted.report ?? validationReport;
  }

  const result: CompletionResult = {
    exitCode: input.payload.exitCode,
    durationMs: input.payload.durationMs,
    ...(cleanedStdout ? { stdout: redactText(cleanedStdout) } : {}),
    ...(cleanedStderr ? { stderr: redactText(cleanedStderr) } : {}),
    ...(input.payload.error ? { error: redactText(input.payload.error) } : {}),
    ...(input.payload.spawnError ? { spawnError: redactText(input.payload.spawnError) } : {}),
    ...(input.payload.attemptedCommand
      ? { attemptedCommand: redactText(input.payload.attemptedCommand) }
      : {}),
    ...(input.payload.mcpSetupWarning
      ? { mcpSetupWarning: redactText(input.payload.mcpSetupWarning) }
      : {}),
    ...(validationReport ? { validationReport } : {})
  };

  let logs = buildCompletionSessionLogs({
    sessionId: input.payload.sessionId,
    sessionNumber: input.payload.sessionNumber,
    attemptId: input.payload.attemptId,
    attemptNumber: input.payload.attemptNumber,
    instanceType: input.payload.instanceType,
    session,
    attempt,
    result,
    redactText
  });

  await agentSessionService.recordSessionObservability({
    repositoryId: input.payload.repositoryId,
    sessionId: input.payload.sessionId,
    logs,
    result
  });

  const latestAttempt = await agentSessionService.findAttemptById(
    input.payload.repositoryId,
    input.payload.attemptId
  );
  if (latestAttempt?.status === "cancelled") {
    await notifyContainerCompletion(input.env, input.payload);
    return;
  }

  const completedAt = Date.now();
  if (input.payload.exitCode === 0 && !input.payload.error) {
    await agentSessionService.completeAttempt({
      repositoryId: input.payload.repositoryId,
      sessionId: input.payload.sessionId,
      attemptId: input.payload.attemptId,
      status: "success",
      exitCode: input.payload.exitCode,
      completedAt
    });

    if (session) {
      const warning = await reconcileSourceTaskStatus(
        workflowTaskFlowService,
        input.env,
        session,
        input.payload
      );
      if (warning) {
        logs = appendSessionLogSection(logs, "status_reconciliation_warning", warning);
        await agentSessionService.recordSessionObservability({
          repositoryId: input.payload.repositoryId,
          sessionId: input.payload.sessionId,
          logs,
          recordedAt: completedAt
        });
      }
    }

    await agentSessionService.syncSessionForAttempt({
      repositoryId: input.payload.repositoryId,
      sessionId: input.payload.sessionId,
      sessionStatus: "success",
      activeAttemptId: null,
      latestAttemptId: input.payload.attemptId,
      exitCode: input.payload.exitCode,
      containerInstance: null,
      completedAt,
      updatedAt: completedAt
    });

    await notifyContainerCompletion(input.env, input.payload);
    return;
  }

  const classification = classifyAttemptFailure({
    result: {
      exitCode: input.payload.exitCode,
      ...(input.payload.error ? { error: input.payload.error } : {}),
      ...(input.payload.spawnError ? { spawnError: input.payload.spawnError } : {}),
      ...(input.payload.stderr ? { stderr: input.payload.stderr } : {})
    },
    ...(input.payload.error ? { errorMessage: input.payload.error } : {})
  });

  const retryScheduled = await scheduleRetry({
    agentSessionService,
    env: input.env,
    payload: input.payload,
    classification,
    requestOrigin: input.requestOrigin,
    completedAt
  });

  await agentSessionService.completeAttempt({
    repositoryId: input.payload.repositoryId,
    sessionId: input.payload.sessionId,
    attemptId: input.payload.attemptId,
    status: retryScheduled ? "retryable_failed" : "failed",
    exitCode: input.payload.exitCode,
    failureReason: classification.reason,
    failureStage: classification.stage,
    completedAt
  });

  if (!retryScheduled) {
    if (session) {
      const warning = await reconcileSourceTaskStatus(
        workflowTaskFlowService,
        input.env,
        session,
        input.payload
      );
      if (warning) {
        logs = appendSessionLogSection(logs, "status_reconciliation_warning", warning);
        await agentSessionService.recordSessionObservability({
          repositoryId: input.payload.repositoryId,
          sessionId: input.payload.sessionId,
          logs,
          recordedAt: completedAt
        });
      }
    }

    await agentSessionService.syncSessionForAttempt({
      repositoryId: input.payload.repositoryId,
      sessionId: input.payload.sessionId,
      sessionStatus: "failed",
      activeAttemptId: null,
      latestAttemptId: input.payload.attemptId,
      exitCode: input.payload.exitCode,
      containerInstance: null,
      failureReason: classification.reason,
      failureStage: classification.stage,
      completedAt,
      updatedAt: completedAt
    });
  }

  await notifyContainerCompletion(input.env, input.payload);
}

async function verifyCallbackSecret(
  env: ActionRunnerBindings,
  payload: CallbackMeta & { callbackSecret: string }
): Promise<boolean> {
  const actionsRunner = getActionRunnerNamespace(env, payload.instanceType);
  if (!actionsRunner) {
    return false;
  }

  try {
    const response = await actionsRunner
      .getByName(payload.containerInstance)
      .fetch("https://actions-container.internal/verify-callback-secret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callbackSecret: payload.callbackSecret })
      });

    if (!response.ok) {
      return false;
    }

    const result = (await response.json()) as { valid?: boolean };
    return result.valid === true;
  } catch {
    return false;
  }
}

async function notifyContainerCompletion(
  env: ActionRunnerBindings,
  payload: CallbackMeta & { callbackSecret: string }
): Promise<void> {
  const actionsRunner = getActionRunnerNamespace(env, payload.instanceType);
  if (!actionsRunner) {
    return;
  }

  const stub = actionsRunner.getByName(payload.containerInstance);
  try {
    await stub.fetch("https://actions-container.internal/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callbackSecret: payload.callbackSecret,
        type: "completion"
      })
    });
  } catch (error) {
    console.warn("container completion callback acknowledgement failed", {
      repositoryId: payload.repositoryId,
      sessionId: payload.sessionId,
      attemptId: payload.attemptId,
      error: toErrorMessage(error)
    });
  }

  try {
    await stub.fetch("https://actions-container.internal/stop", { method: "POST" });
  } catch (error) {
    console.warn("container stop after completion failed", {
      repositoryId: payload.repositoryId,
      sessionId: payload.sessionId,
      attemptId: payload.attemptId,
      error: toErrorMessage(error)
    });
  }
}
