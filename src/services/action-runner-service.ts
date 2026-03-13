import type {
  ActionContainerInstanceType,
  AgentSessionAttemptFailureReason,
  AgentSessionAttemptFailureStage,
  AgentSessionAttemptRecord,
  AgentSessionRecord,
  AgentSessionValidationReport,
  AppBindings,
  AuthUser,
  RepositoryRecord
} from "../types";
import { AgentSessionService } from "./agent-session-service";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "./action-runner-prompt-tokens";
import {
  ACTION_CONTAINER_INSTANCE_TYPES,
  getActionRunnerNamespace
} from "./action-container-instance-types";
import { buildSessionLifecycleLines } from "./session-log-format";
import { ACTIONS_SYSTEM_EMAIL, ACTIONS_SYSTEM_USERNAME } from "./auth-service";
import { ActionsService } from "./actions-service";
import { ActionLogStorageService, buildLogExcerpt } from "./action-log-storage-service";
import {
  extractValidationReportFromText,
  parseAgentSessionValidationReport
} from "./agent-session-validation-report";
import { createRepositoryObjectClient } from "./repository-object";
import { WorkflowTaskFlowService } from "./workflow-task-flow-service";
import { createSecretRedactor } from "../utils/secret-redaction";

type RunnerExecuteResult = {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: string;
  spawnError?: string;
  attemptedCommand?: string;
  mcpSetupWarning?: string;
  validationReport?: AgentSessionValidationReport;
};

type RunnerStreamEvent =
  | {
      type: "stdout";
      data: string;
    }
  | {
      type: "stderr";
      data: string;
    }
  | {
      type: "result";
      exitCode: number;
      durationMs: number;
      error?: string;
      stderr?: string;
      spawnError?: string;
      attemptedCommand?: string;
      mcpSetupWarning?: string;
    };

type BoundedLogBuffer = {
  text: string;
  truncatedChars: number;
};

const MAX_LOG_CHARS = 120_000;
const SESSION_LOG_FLUSH_INTERVAL_MS = 1_000;
const SESSION_LOG_FLUSH_MIN_CHARS = 1_024;
const MAX_RUNNER_STREAM_EVENT_CHARS = 256_000;
const DEFAULT_ACTION_CONTAINER_INSTANCE_TYPE = "lite";

function normalizeCloneOrigin(input: {
  requestOrigin: string;
}): string {
  return input.requestOrigin;
}

const CODEX_CONFIG_FILE_PATH = "/home/rootless/.codex/config.toml";
const CLAUDE_CODE_CONFIG_FILE_PATH = "/home/rootless/.claude/settings.json";

function truncateLog(log: string): string {
  if (log.length <= MAX_LOG_CHARS) {
    return log;
  }
  const retained = log.slice(log.length - MAX_LOG_CHARS);
  return `[truncated ${log.length - MAX_LOG_CHARS} chars]\n${retained}`;
}

function createBoundedLogBuffer(): BoundedLogBuffer {
  return {
    text: "",
    truncatedChars: 0
  };
}

function appendBoundedLog(
  current: BoundedLogBuffer,
  chunk: string,
  limit = MAX_LOG_CHARS
): BoundedLogBuffer {
  if (!chunk) {
    return current;
  }

  const combined = `${current.text}${chunk}`;
  if (combined.length <= limit) {
    return {
      text: combined,
      truncatedChars: current.truncatedChars
    };
  }

  const overflow = combined.length - limit;
  return {
    text: combined.slice(overflow),
    truncatedChars: current.truncatedChars + overflow
  };
}

function formatBoundedLog(buffer: BoundedLogBuffer): string {
  if (buffer.truncatedChars === 0) {
    return buffer.text;
  }
  return `[truncated ${buffer.truncatedChars} chars]\n${buffer.text}`;
}

function redactLogText(
  value: string,
  redactText?: ((input: string) => string) | undefined
): string {
  return redactText ? redactText(value) : value;
}

function buildSessionLogs(input: {
  sessionId: string;
  sessionNumber: number;
  attemptId?: string;
  attemptNumber?: number;
  instanceType?: ActionContainerInstanceType;
  agentType: "codex" | "claude_code";
  prompt: string;
  claimedAt?: number | null | undefined;
  startedAt?: number | null | undefined;
  reconciledAt?: number | null | undefined;
  result?: RunnerExecuteResult;
  errorMessage?: string;
  redactText?: (input: string) => string;
}): string {
  const lines: string[] = [];
  lines.push(`session_id: ${input.sessionId}`);
  lines.push(`session_number: ${input.sessionNumber}`);
  if (input.attemptId) {
    lines.push(`attempt_id: ${input.attemptId}`);
  }
  if (input.attemptNumber !== undefined) {
    lines.push(`attempt_number: ${input.attemptNumber}`);
  }
  if (input.instanceType) {
    lines.push(`instance_type: ${input.instanceType}`);
  }
  lines.push(`agent_type: ${input.agentType}`);
  lines.push(`prompt: ${redactLogText(input.prompt, input.redactText)}`);
  lines.push("");
  lines.push(
    ...buildSessionLifecycleLines(
      {
        claimedAt: input.claimedAt,
        startedAt: input.startedAt,
        reconciledAt: input.reconciledAt
      },
      { includeMissing: true }
    )
  );

  if (input.result?.durationMs !== undefined) {
    lines.push(`duration_ms: ${input.result.durationMs}`);
  }

  if (input.errorMessage) {
    lines.push("");
    lines.push("[error]");
    lines.push(redactLogText(input.errorMessage, input.redactText));
  }

  if (input.result?.error) {
    lines.push("");
    lines.push("[runner_error]");
    lines.push(redactLogText(input.result.error, input.redactText));
  }

  if (input.result?.spawnError) {
    lines.push("");
    lines.push("[runner_spawn_error]");
    lines.push(redactLogText(input.result.spawnError, input.redactText));
  }

  if (input.result?.mcpSetupWarning) {
    lines.push("");
    lines.push("[mcp_setup]");
    lines.push(redactLogText(input.result.mcpSetupWarning, input.redactText));
  }

  if (input.result?.attemptedCommand) {
    lines.push("");
    lines.push("[attempted]");
    lines.push(redactLogText(input.result.attemptedCommand, input.redactText));
  }

  if (input.result?.stdout) {
    lines.push("");
    lines.push("[stdout]");
    lines.push(redactLogText(input.result.stdout, input.redactText));
  }

  if (input.result?.stderr) {
    lines.push("");
    lines.push("[stderr]");
    lines.push(redactLogText(input.result.stderr, input.redactText));
  }

  return truncateLog(lines.join("\n"));
}

function appendSessionLogSection(logs: string, section: string, detail: string): string {
  const trimmedDetail = detail.trim();
  if (!trimmedDetail) {
    return logs;
  }
  const separator = logs.endsWith("\n") ? "" : "\n";
  return truncateLog(`${logs}${separator}\n[${section}]\n${trimmedDetail}`);
}

function isStreamedRunnerResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/x-ndjson");
}

function parseLifecycleStartedAt(response: Response): number | null {
  const rawValue = response.headers.get("x-gits-run-started-at");
  if (!rawValue) {
    return null;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function appendBoundedDiagnostic(
  current: BoundedLogBuffer,
  next: string | null | undefined
): BoundedLogBuffer {
  const trimmed = next?.trim();
  if (!trimmed) {
    return current;
  }
  const separator = current.text && !current.text.endsWith("\n") ? "\n" : "";
  return appendBoundedLog(current, `${separator}${trimmed}`);
}

function parseRunnerStreamEvent(raw: string): RunnerStreamEvent {
  try {
    return JSON.parse(raw) as RunnerStreamEvent;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Invalid runner stream event: ${message}`);
  }
}

function buildLiveSessionLogs(input: {
  sessionId: string;
  sessionNumber: number;
  attemptId?: string;
  attemptNumber?: number;
  instanceType?: ActionContainerInstanceType;
  agentType: "codex" | "claude_code";
  prompt: string;
  claimedAt?: number | null | undefined;
  startedAt?: number | null | undefined;
  stdout: string;
  stderr: string;
  durationMs?: number;
  error?: string;
  redactText?: (input: string) => string;
}): string {
  const result: RunnerExecuteResult = {
    ...(input.stdout ? { stdout: input.stdout } : {}),
    ...(input.stderr ? { stderr: input.stderr } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.error ? { error: input.error } : {})
  };

  return buildSessionLogs({
    sessionId: input.sessionId,
    sessionNumber: input.sessionNumber,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.attemptNumber !== undefined ? { attemptNumber: input.attemptNumber } : {}),
    ...(input.instanceType ? { instanceType: input.instanceType } : {}),
    agentType: input.agentType,
    prompt: input.prompt,
    claimedAt: input.claimedAt,
    startedAt: input.startedAt,
    result,
    ...(input.redactText ? { redactText: input.redactText } : {})
  });
}

async function consumeStreamedRunnerResponse(input: {
  agentSessionService: AgentSessionService;
  repositoryId: string;
  sessionId: string;
  attemptId: string;
  sessionNumber: number;
  attemptNumber: number;
  instanceType: ActionContainerInstanceType;
  agentType: "codex" | "claude_code";
  prompt: string;
  claimedAt?: number | null | undefined;
  startedAt?: number | null | undefined;
  response: Response;
  redactText?: (input: string) => string;
}): Promise<RunnerExecuteResult> {
  if (!input.response.body) {
    return {};
  }

  const reader = input.response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let stdout = createBoundedLogBuffer();
  let stderr = createBoundedLogBuffer();
  let durationMs: number | undefined;
  let error: string | undefined;
  let exitCode: number | undefined;
  let pendingEvents: Array<{
    type: "stdout_chunk" | "stderr_chunk" | "warning";
    stream: "stdout" | "stderr" | "error" | "system";
    message: string;
    payload?: Record<string, unknown> | null;
    createdAt?: number;
  }> = [];
  let pendingCharsSinceFlush = 0;
  let lastFlushAt = 0;
  let flushInProgress: Promise<void> | null = null;
  let receivedResultEvent = false;

  const performFlush = async (force = false): Promise<void> => {
    const now = Date.now();
    if (
      !force &&
      pendingCharsSinceFlush < SESSION_LOG_FLUSH_MIN_CHARS &&
      now - lastFlushAt < SESSION_LOG_FLUSH_INTERVAL_MS
    ) {
      return;
    }

    if (pendingEvents.length > 0) {
      await input.agentSessionService.appendAttemptEvents(
        input.repositoryId,
        input.sessionId,
        input.attemptId,
        pendingEvents
      );
      pendingEvents = [];
    }

    const logs = buildLiveSessionLogs({
      sessionId: input.sessionId,
      sessionNumber: input.sessionNumber,
      attemptId: input.attemptId,
      attemptNumber: input.attemptNumber,
      instanceType: input.instanceType,
      agentType: input.agentType,
      prompt: input.prompt,
      claimedAt: input.claimedAt,
      startedAt: input.startedAt,
      stdout: formatBoundedLog(stdout),
      stderr: formatBoundedLog(stderr),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(error ? { error } : {}),
      ...(input.redactText ? { redactText: input.redactText } : {})
    });

    await input.agentSessionService.syncSessionForAttempt({
      repositoryId: input.repositoryId,
      sessionId: input.sessionId,
      sessionStatus: "running",
      activeAttemptId: input.attemptId,
      latestAttemptId: input.attemptId,
      updatedAt: now
    });
    await input.agentSessionService.recordSessionObservability({
      repositoryId: input.repositoryId,
      sessionId: input.sessionId,
      logs,
      recordedAt: now
    });
    lastFlushAt = now;
    pendingCharsSinceFlush = 0;
  };

  const flushLogs = async (force = false): Promise<void> => {
    while (flushInProgress) {
      try {
        await flushInProgress;
      } catch {
        // Allow the current caller to decide whether to retry or force a final flush.
      }
    }

    const currentFlush = performFlush(force);
    flushInProgress = currentFlush;
    try {
      await currentFlush;
    } finally {
      if (flushInProgress === currentFlush) {
        flushInProgress = null;
      }
    }
  };

  const handleEvent = async (event: RunnerStreamEvent): Promise<void> => {
    if (event.type === "stdout") {
      const redactedData = redactLogText(event.data, input.redactText);
      stdout = appendBoundedLog(stdout, redactedData);
      pendingEvents.push({
        type: "stdout_chunk",
        stream: "stdout",
        message: buildLogExcerpt(redactedData, 2_000),
        payload: { chars: redactedData.length }
      });
      pendingCharsSinceFlush += redactedData.length;
      await flushLogs();
      return;
    }

    if (event.type === "stderr") {
      const redactedData = redactLogText(event.data, input.redactText);
      stderr = appendBoundedLog(stderr, redactedData);
      pendingEvents.push({
        type: "stderr_chunk",
        stream: "stderr",
        message: buildLogExcerpt(redactedData, 2_000),
        payload: { chars: redactedData.length }
      });
      pendingCharsSinceFlush += redactedData.length;
      await flushLogs();
      return;
    }

    exitCode = event.exitCode;
    durationMs = event.durationMs;
    error = event.error;
    receivedResultEvent = true;
    stderr = appendBoundedDiagnostic(
      stderr,
      event.stderr ? redactLogText(event.stderr, input.redactText) : undefined
    );
    stderr = appendBoundedDiagnostic(
      stderr,
      event.spawnError ? redactLogText(event.spawnError, input.redactText) : undefined
    );
    stderr = appendBoundedDiagnostic(
      stderr,
      event.mcpSetupWarning
        ? `[mcp_setup] ${redactLogText(event.mcpSetupWarning, input.redactText)}`
        : null
    );
    stderr = appendBoundedDiagnostic(
      stderr,
      event.attemptedCommand
        ? `[attempted] ${redactLogText(event.attemptedCommand, input.redactText)}`
        : null
    );
    await flushLogs(true);
  };

  let streamFailureMessage: string | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_RUNNER_STREAM_EVENT_CHARS) {
        throw new Error("Runner stream event exceeded maximum buffered size");
      }
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          await handleEvent(parseRunnerStreamEvent(line));
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const tail = `${buffer}${decoder.decode()}`.trim();
    if (tail) {
      await handleEvent(parseRunnerStreamEvent(tail));
    }
  } catch (streamError) {
    streamFailureMessage = streamError instanceof Error ? streamError.message : String(streamError);
    await reader.cancel(streamError).catch(() => undefined);
  } finally {
    reader.releaseLock();
  }

  if (streamFailureMessage) {
    error = error ?? "Runner stream terminated unexpectedly";
    stderr = appendBoundedDiagnostic(stderr, `[runner_stream] ${streamFailureMessage}`);
    pendingEvents.push({
      type: "warning",
      stream: "error",
      message: "Runner stream terminated unexpectedly.",
      payload: { detail: streamFailureMessage }
    });
  }
  if (!receivedResultEvent) {
    const missingResultMessage = "Runner stream ended before result event was received";
    error = error ?? missingResultMessage;
    stderr = appendBoundedDiagnostic(stderr, `[runner_stream] ${missingResultMessage}`);
    pendingEvents.push({
      type: "warning",
      stream: "error",
      message: missingResultMessage,
      payload: { detail: missingResultMessage }
    });
  }
  await flushLogs(true);

  return {
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(stdout.text ? { stdout: formatBoundedLog(stdout) } : {}),
    ...(stderr.text ? { stderr: formatBoundedLog(stderr) } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(error ? { error } : {})
  };
}

function parseRunnerResponse(payload: unknown): RunnerExecuteResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const data = payload as Record<string, unknown>;
  const validationReport = parseAgentSessionValidationReport(data.validationReport);

  return {
    ...(typeof data.exitCode === "number" ? { exitCode: data.exitCode } : {}),
    ...(typeof data.stdout === "string" ? { stdout: data.stdout } : {}),
    ...(typeof data.stderr === "string" ? { stderr: data.stderr } : {}),
    ...(typeof data.durationMs === "number" ? { durationMs: data.durationMs } : {}),
    ...(typeof data.error === "string" ? { error: data.error } : {}),
    ...(typeof data.spawnError === "string" ? { spawnError: data.spawnError } : {}),
    ...(typeof data.attemptedCommand === "string"
      ? { attemptedCommand: data.attemptedCommand }
      : {}),
    ...(typeof data.mcpSetupWarning === "string"
      ? { mcpSetupWarning: data.mcpSetupWarning }
      : {}),
    ...(validationReport ? { validationReport } : {})
  };
}

function extractValidationReport(result: RunnerExecuteResult): RunnerExecuteResult {
  let validationReport = result.validationReport ?? null;
  let stdout = result.stdout;
  let stderr = result.stderr;

  if (stdout) {
    const extracted = extractValidationReportFromText(stdout);
    stdout = extracted.cleanedText;
    validationReport = extracted.report ?? validationReport;
  }

  if (stderr) {
    const extracted = extractValidationReportFromText(stderr);
    stderr = extracted.cleanedText;
    validationReport = extracted.report ?? validationReport;
  }

  return {
    ...result,
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
    ...(validationReport ? { validationReport } : {})
  };
}

type AttemptFailureClassification = {
  reason: AgentSessionAttemptFailureReason;
  stage: AgentSessionAttemptFailureStage;
  retryable: boolean;
  promoteInstanceType: boolean;
};

function nextInstanceType(
  instanceType: ActionContainerInstanceType
): ActionContainerInstanceType | null {
  const index = ACTION_CONTAINER_INSTANCE_TYPES.indexOf(instanceType);
  if (index === -1 || index === ACTION_CONTAINER_INSTANCE_TYPES.length - 1) {
    return null;
  }
  return ACTION_CONTAINER_INSTANCE_TYPES[index + 1] ?? null;
}

function classifyAttemptFailure(input: {
  responseStatus?: number;
  result?: RunnerExecuteResult;
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

  const attemptInstanceType =
    attempt.instance_type ?? input.session.instance_type ?? DEFAULT_ACTION_CONTAINER_INSTANCE_TYPE;
  const actionsRunner = getActionRunnerNamespace(input.env, attemptInstanceType);
  let runnerResult: RunnerExecuteResult = {};
  let startedAt: number | null = null;
  let reconcileWarning: string | null = null;
  const redactLogs = createSecretRedactor();

  const reconcileSourceTaskStatus = async (): Promise<string | null> => {
    const sourceType =
      input.session.source_type === "manual" ? null : input.session.source_type;
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
      const message = error instanceof Error ? error.message : "Unknown reconciliation error";
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

  const persistObservability = async (logs: string): Promise<string> => {
    try {
      await agentSessionService.recordSessionObservability({
        repositoryId: input.repository.id,
        sessionId,
        logs,
        ...(runnerResult ? { result: runnerResult } : {})
      });
      return logs;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown log storage error";
      return appendSessionLogSection(logs, "log_storage_warning", message);
    }
  };

  const syncTerminalSession = async (args: {
    status: "success" | "failed" | "cancelled";
    exitCode?: number | null;
    failureReason?: AgentSessionAttemptFailureReason | null;
    failureStage?: AgentSessionAttemptFailureStage | null;
    logs: string;
    completedAt: number;
  }): Promise<void> => {
    let finalLogs = args.logs;
    const warning = await reconcileSourceTaskStatus();
    finalLogs = warning
      ? appendSessionLogSection(finalLogs, "status_reconciliation_warning", warning)
      : finalLogs;
    reconcileWarning = warning;
    await agentSessionService.syncSessionForAttempt({
      repositoryId: input.repository.id,
      sessionId,
      sessionStatus: args.status,
      activeAttemptId: null,
      latestAttemptId: attempt.id,
      exitCode: args.exitCode ?? null,
      containerInstance: null,
      failureReason: args.failureReason ?? null,
      failureStage: args.failureStage ?? null,
      completedAt: args.completedAt,
      updatedAt: args.completedAt
    });
  };

  const wasCancelledExternally = async (): Promise<boolean> => {
    const latestAttempt = await agentSessionService.findAttemptById(input.repository.id, attempt.id);
    return latestAttempt?.status === "cancelled";
  };

  const scheduleRetry = async (
    classification: AttemptFailureClassification,
    logs: string,
    completedAt: number
  ): Promise<boolean> => {
    if (!classification.retryable || attempt.attempt_number >= 2 || !input.env.ACTIONS_QUEUE) {
      return false;
    }
    const promotedInstanceType =
      classification.promoteInstanceType ? nextInstanceType(attemptInstanceType) : null;
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

  if (!actionsRunner) {
    const logs = await persistObservability(
      buildSessionLogs({
        sessionId,
        sessionNumber,
        attemptId: attempt.id,
        attemptNumber: attempt.attempt_number,
        instanceType: attemptInstanceType,
        agentType: input.session.agent_type,
        prompt: input.session.prompt,
        claimedAt,
        errorMessage: `Actions runner binding is not configured for instance type '${attemptInstanceType}'`,
        redactText: redactLogs
      })
    );
    const completedAt = Date.now();
    if (await wasCancelledExternally()) {
      return;
    }
    const classification = classifyAttemptFailure({
      errorMessage: `Actions runner binding is not configured for instance type '${attemptInstanceType}'`
    });
    await agentSessionService.completeAttempt({
      repositoryId: input.repository.id,
      sessionId,
      attemptId: attempt.id,
      status: "failed",
      exitCode: null,
      failureReason: classification.reason,
      failureStage: classification.stage,
      completedAt
    });
    await syncTerminalSession({
      status: "failed",
      exitCode: null,
      failureReason: classification.reason,
      failureStage: classification.stage,
      logs,
      completedAt
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

    const runnerStub = actionsRunner.getByName(containerInstance);
    const runnerResponse = await runnerStub.fetch("https://actions-container.internal/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        agentType: input.session.agent_type,
        prompt: input.session.prompt,
        repositoryId: input.repository.id,
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

    const lifecycleStartedAt =
      parseLifecycleStartedAt(runnerResponse) ?? (runnerResponse.ok ? Date.now() : null);
    if (lifecycleStartedAt !== null) {
      startedAt =
        (await agentSessionService.markAttemptRunning({
          repositoryId: input.repository.id,
          sessionId,
          attemptId: attempt.id,
          containerInstance,
          startedAt: lifecycleStartedAt
        })) ?? lifecycleStartedAt;

      await agentSessionService.syncSessionForAttempt({
        repositoryId: input.repository.id,
        sessionId,
        sessionStatus: "running",
        activeAttemptId: attempt.id,
        latestAttemptId: attempt.id,
        containerInstance,
        startedAt,
        updatedAt: startedAt
      });
      await agentSessionService.recordSessionObservability({
        repositoryId: input.repository.id,
        sessionId,
        logs: buildSessionLogs({
          sessionId,
          sessionNumber,
          attemptId: attempt.id,
          attemptNumber: attempt.attempt_number,
          instanceType: attemptInstanceType,
          agentType: input.session.agent_type,
          prompt: input.session.prompt,
          claimedAt,
          startedAt,
          redactText: redactLogs
        }),
        recordedAt: startedAt
      });
    }

    if (isStreamedRunnerResponse(runnerResponse)) {
      runnerResult = await consumeStreamedRunnerResponse({
        agentSessionService,
        repositoryId: input.repository.id,
        sessionId,
        attemptId: attempt.id,
        sessionNumber,
        attemptNumber: attempt.attempt_number,
        instanceType: attemptInstanceType,
        agentType: input.session.agent_type,
        prompt: input.session.prompt,
        claimedAt,
        startedAt,
        response: runnerResponse,
        redactText: redactLogs
      });
    } else {
      let responsePayload: unknown = null;
      try {
        responsePayload = await runnerResponse.json();
      } catch {
        responsePayload = { error: await runnerResponse.text() };
      }
      runnerResult = parseRunnerResponse(responsePayload);
    }

    runnerResult = extractValidationReport(runnerResult);
    const responseFailure =
      !runnerResponse.ok ? `Container runner responded with HTTP ${runnerResponse.status}` : undefined;
    let logs = buildSessionLogs({
      sessionId,
      sessionNumber,
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      instanceType: attemptInstanceType,
      agentType: input.session.agent_type,
      prompt: input.session.prompt,
      claimedAt,
      startedAt,
      ...(runnerResult ? { result: runnerResult } : {}),
      ...(responseFailure ? { errorMessage: responseFailure } : {}),
      redactText: redactLogs
    });
    logs = await persistObservability(logs);
    if (await wasCancelledExternally()) {
      return;
    }

    const exitCode = runnerResult.exitCode ?? -1;
    if (runnerResponse.ok && exitCode === 0) {
      const completedAt = Date.now();
      await agentSessionService.completeAttempt({
        repositoryId: input.repository.id,
        sessionId,
        attemptId: attempt.id,
        status: "success",
        exitCode,
        completedAt
      });
      await syncTerminalSession({
        status: "success",
        exitCode,
        logs,
        completedAt
      });
      return;
    }

    const classification = classifyAttemptFailure({
      responseStatus: runnerResponse.status,
      result: runnerResult,
      ...(responseFailure ? { errorMessage: responseFailure } : {})
    });
    const completedAt = Date.now();
    const retryScheduled = await scheduleRetry(classification, logs, completedAt);
    await agentSessionService.completeAttempt({
      repositoryId: input.repository.id,
      sessionId,
      attemptId: attempt.id,
      status: retryScheduled ? "retryable_failed" : "failed",
      exitCode: runnerResult.exitCode ?? null,
      failureReason: classification.reason,
      failureStage: classification.stage,
      completedAt
    });
    if (!retryScheduled) {
      await syncTerminalSession({
        status: "failed",
        exitCode: runnerResult.exitCode ?? null,
        failureReason: classification.reason,
        failureStage: classification.stage,
        logs,
        completedAt
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown runner error";
    let logs = buildSessionLogs({
      sessionId,
      sessionNumber,
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      instanceType: attemptInstanceType,
      agentType: input.session.agent_type,
      prompt: input.session.prompt,
      claimedAt,
      startedAt,
      ...(runnerResult ? { result: runnerResult } : {}),
      errorMessage: message,
      redactText: redactLogs
    });
    logs = await persistObservability(logs);
    if (await wasCancelledExternally()) {
      return;
    }
    const classification = classifyAttemptFailure({
      result: runnerResult,
      errorMessage: message
    });
    const completedAt = Date.now();
    const retryScheduled = await scheduleRetry(classification, logs, completedAt);
    await agentSessionService.completeAttempt({
      repositoryId: input.repository.id,
      sessionId,
      attemptId: attempt.id,
      status: retryScheduled ? "retryable_failed" : "failed",
      exitCode: runnerResult.exitCode ?? null,
      failureReason: classification.reason,
      failureStage: classification.stage,
      completedAt
    });
    if (!retryScheduled) {
      await syncTerminalSession({
        status: "failed",
        exitCode: runnerResult.exitCode ?? null,
        failureReason: classification.reason,
        failureStage: classification.stage,
        logs,
        completedAt
      });
    }
  } finally {
    if (actionsRunner) {
      try {
        const runnerStub = actionsRunner.getByName(containerInstance);
        await runnerStub.fetch("https://actions-container.internal/stop", {
          method: "POST"
        });
      } catch {
        // best-effort stop
      }
    }
  }

  if (reconcileWarning) {
    console.warn("action attempt completed with reconciliation warning", {
      repositoryId: input.repository.id,
      sessionId,
      attemptId: attempt.id,
      warning: reconcileWarning
    });
  }
}
