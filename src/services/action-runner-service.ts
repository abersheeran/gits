import type { AuthUser, AgentSessionValidationReport, RepositoryRecord } from "../types";
import { AgentSessionService } from "./agent-session-service";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "./action-runner-prompt-tokens";
import { getActionRunnerNamespace } from "./action-container-instance-types";
import { buildActionRunLifecycleLines } from "./action-run-log-format";
import { ACTIONS_SYSTEM_EMAIL, ACTIONS_SYSTEM_USERNAME } from "./auth-service";
import { ActionsService } from "./actions-service";
import {
  extractValidationReportFromText,
  parseAgentSessionValidationReport
} from "./agent-session-validation-report";
import { StorageService } from "./storage-service";
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
const RUN_LOG_FLUSH_INTERVAL_MS = 1_000;
const RUN_LOG_FLUSH_MIN_CHARS = 1_024;
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

function buildRunLogs(input: {
  runId: string;
  runNumber: number;
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
  lines.push(`run_id: ${input.runId}`);
  lines.push(`run_number: ${input.runNumber}`);
  lines.push(`agent_type: ${input.agentType}`);
  lines.push(`prompt: ${redactLogText(input.prompt, input.redactText)}`);
  lines.push("");
  lines.push(
    ...buildActionRunLifecycleLines(
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

function appendRunLogSection(logs: string, section: string, detail: string): string {
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

function buildLiveRunLogs(input: {
  runId: string;
  runNumber: number;
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

  return buildRunLogs({
    runId: input.runId,
    runNumber: input.runNumber,
    agentType: input.agentType,
    prompt: input.prompt,
    claimedAt: input.claimedAt,
    startedAt: input.startedAt,
    result,
    ...(input.redactText ? { redactText: input.redactText } : {})
  });
}

async function consumeStreamedRunnerResponse(input: {
  actionsService: ActionsService;
  repositoryId: string;
  runId: string;
  runNumber: number;
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
  let pendingCharsSinceFlush = 0;
  let lastFlushAt = 0;
  let lastFlushedLogs = "";
  let logPersistenceWarning: string | null = null;
  let suspendIntermediateLogWrites = false;
  let flushInProgress: Promise<void> | null = null;
  let receivedResultEvent = false;

  const performFlush = async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && suspendIntermediateLogWrites) {
        return;
      }
      if (
        !force &&
        pendingCharsSinceFlush < RUN_LOG_FLUSH_MIN_CHARS &&
        now - lastFlushAt < RUN_LOG_FLUSH_INTERVAL_MS
      ) {
        return;
      }

      const logs = buildLiveRunLogs({
        runId: input.runId,
        runNumber: input.runNumber,
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

      if (!force && logs === lastFlushedLogs) {
        return;
      }

      try {
        await input.actionsService.updateRunningRunLogs(input.repositoryId, input.runId, logs);
        lastFlushedLogs = logs;
        lastFlushAt = now;
        pendingCharsSinceFlush = 0;
        suspendIntermediateLogWrites = false;
        logPersistenceWarning = null;
      } catch (flushError) {
        if (!logPersistenceWarning) {
          const message = flushError instanceof Error ? flushError.message : String(flushError);
          logPersistenceWarning = `Failed to persist streaming logs: ${message}`;
        }
        suspendIntermediateLogWrites = true;
      }
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
      pendingCharsSinceFlush += redactedData.length;
      await flushLogs();
      return;
    }

    if (event.type === "stderr") {
      const redactedData = redactLogText(event.data, input.redactText);
      stderr = appendBoundedLog(stderr, redactedData);
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
  }
  if (!receivedResultEvent) {
    const missingResultMessage = "Runner stream ended before result event was received";
    error = error ?? missingResultMessage;
    stderr = appendBoundedDiagnostic(stderr, `[runner_stream] ${missingResultMessage}`);
  }
  await flushLogs(true);
  if (logPersistenceWarning) {
    stderr = appendBoundedDiagnostic(stderr, `[log_stream_warning] ${logPersistenceWarning}`);
  }

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

export async function executeActionRun(input: {
  env: {
    DB: D1Database;
    GIT_BUCKET: R2Bucket;
    JWT_SECRET: string;
    ACTIONS_RUNNER?: DurableObjectNamespace;
    ACTIONS_RUNNER_BASIC?: DurableObjectNamespace;
    ACTIONS_RUNNER_STANDARD_1?: DurableObjectNamespace;
    ACTIONS_RUNNER_STANDARD_2?: DurableObjectNamespace;
    ACTIONS_RUNNER_STANDARD_3?: DurableObjectNamespace;
    ACTIONS_RUNNER_STANDARD_4?: DurableObjectNamespace;
  };
  repository: RepositoryRecord;
  run: {
    id: string;
    run_number: number;
    repository_id: string;
    agent_type: "codex" | "claude_code";
    instance_type: "lite" | "basic" | "standard-1" | "standard-2" | "standard-3" | "standard-4";
    prompt: string;
    trigger_ref: string | null;
    trigger_sha: string | null;
    trigger_source_type: "issue" | "pull_request" | null;
    trigger_source_number: number | null;
  };
  triggeredByUser?: AuthUser;
  requestOrigin: string;
}): Promise<void> {
  const actionsService = new ActionsService(input.env.DB);
  const agentSessionService = new AgentSessionService(input.env.DB);
  const workflowTaskFlowService = new WorkflowTaskFlowService(
    input.env.DB,
    new StorageService(input.env.GIT_BUCKET)
  );
  const recordRunObservability = async (
    args: Parameters<AgentSessionService["recordRunObservability"]>[0]
  ): Promise<void> => {
    try {
      await agentSessionService.recordRunObservability(args);
    } catch {
      // Observability data is best-effort and should not change run outcomes.
    }
  };
  const reconcileSourceTaskStatus = async (): Promise<string | null> => {
    if (
      (input.run.trigger_source_type !== "issue" &&
        input.run.trigger_source_type !== "pull_request") ||
      input.run.trigger_source_number === null
    ) {
      return null;
    }
    try {
      await workflowTaskFlowService.reconcileSourceTaskStatus({
        repository: input.repository,
        sourceType: input.run.trigger_source_type,
        sourceNumber: input.run.trigger_source_number
      });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reconciliation error";
      console.error("action run status reconciliation failed", {
        repositoryId: input.repository.id,
        runId: input.run.id,
        sourceType: input.run.trigger_source_type,
        sourceNumber: input.run.trigger_source_number,
        error: message
      });
      return `source=${input.run.trigger_source_type} #${input.run.trigger_source_number}: ${message}`;
    }
  };
  const finalizeRun = async (args: {
    status: "success" | "failed" | "cancelled";
    logs: string;
    exitCode?: number | null;
    result?: RunnerExecuteResult;
  }): Promise<void> => {
    await actionsService.completeRun(input.repository.id, input.run.id, {
      status: args.status,
      logs: args.logs,
      exitCode: args.exitCode ?? null
    });
    const reconciliationWarning = await reconcileSourceTaskStatus();
    const finalLogs = reconciliationWarning
      ? appendRunLogSection(args.logs, "status_reconciliation_warning", reconciliationWarning)
      : args.logs;
    if (finalLogs !== args.logs) {
      await actionsService.replaceRunLogs(input.repository.id, input.run.id, finalLogs);
    }
    await recordRunObservability({
      repositoryId: input.repository.id,
      runId: input.run.id,
      logs: finalLogs,
      ...(args.result ? { result: args.result } : {})
    });
  };
  const containerInstance = `action-run-${input.run.id}`;
  const instanceType = input.run.instance_type ?? DEFAULT_ACTION_CONTAINER_INSTANCE_TYPE;
  const actionsRunner = getActionRunnerNamespace(input.env, instanceType);
  let redactLogs = createSecretRedactor();

  if (!actionsRunner) {
    const logs = buildRunLogs({
      runId: input.run.id,
      runNumber: input.run.run_number,
      agentType: input.run.agent_type,
      prompt: input.run.prompt,
      errorMessage: `Actions runner binding is not configured for instance type '${instanceType}'`,
      redactText: redactLogs
    });
    await finalizeRun({
      status: "failed",
      logs
    });
    return;
  }

  let claimedAt = await actionsService.claimQueuedRun(input.repository.id, input.run.id, containerInstance);
  if (claimedAt === null) {
    return;
  }

  let startedAt: number | null = null;
  let runnerResult: RunnerExecuteResult = {};

  try {
    const repositoryConfig = await actionsService.getRepositoryConfig(input.repository.id);
    let agentSession = null;
    try {
      agentSession = await agentSessionService.findSessionByRunId(input.repository.id, input.run.id);
    } catch {
      // Session metadata enriches the runtime but should not block execution.
    }
    const repositoryOrigin = normalizeCloneOrigin({
      requestOrigin: input.requestOrigin
    });
    const canIssueComment = true;
    const canCreatePr = true;
    const canGitPush = true;
    const needsIssueReplyToken =
      input.triggeredByUser !== undefined &&
      canIssueComment &&
      (input.run.trigger_source_type === "issue" ||
        input.run.prompt.includes(ISSUE_REPLY_TOKEN_PLACEHOLDER));
    const needsPrCreateToken =
      input.triggeredByUser !== undefined &&
      canCreatePr &&
      (input.run.trigger_source_type === "issue" ||
        input.run.prompt.includes(ISSUE_PR_CREATE_TOKEN_PLACEHOLDER));
    const envVars: Record<string, string> = {
      GITS_ACTION_RUN_ID: input.run.id,
      GITS_ACTION_RUN_NUMBER: String(input.run.run_number),
      GITS_REPOSITORY: `${input.repository.owner_username}/${input.repository.name}`,
      GITS_PLATFORM_API_BASE: repositoryOrigin,
      GITS_REPOSITORY_OWNER: input.repository.owner_username,
      GITS_REPOSITORY_NAME: input.repository.name,
      ...(input.run.trigger_source_type === "issue" && input.run.trigger_source_number !== null
        ? { GITS_TRIGGER_ISSUE_NUMBER: String(input.run.trigger_source_number) }
        : {}),
      ...(agentSession
        ? {
            GITS_AGENT_SESSION_ID: agentSession.id,
            GITS_AGENT_SESSION_ORIGIN: agentSession.origin,
            GITS_AGENT_SESSION_STATUS: agentSession.status,
            GITS_AGENT_SESSION_BRANCH_REF: agentSession.branch_ref ?? ""
          }
        : {})
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
        agentType: input.run.agent_type,
        prompt: input.run.prompt,
        repositoryUrl: `${repositoryOrigin}/${input.repository.owner_username}/${input.repository.name}.git`,
        ref: input.run.trigger_ref ?? undefined,
        sha: input.run.trigger_sha ?? undefined,
        runNumber: input.run.run_number,
        triggeredByUserId: input.triggeredByUser?.id,
        triggeredByUsername: input.triggeredByUser?.username,
        triggerSourceType: input.run.trigger_source_type,
        enableIssueReplyToken: needsIssueReplyToken,
        enablePrCreateToken: needsPrCreateToken,
        allowGitPush: canGitPush,
        gitCommitName: ACTIONS_SYSTEM_USERNAME,
        gitCommitEmail: ACTIONS_SYSTEM_EMAIL,
        env: envVars,
        configFiles
      })
    });

    startedAt = await actionsService.updateRunToRunning(
      input.repository.id,
      input.run.id,
      containerInstance
    );
    if (startedAt === null) {
      if (runnerResponse.body) {
        await runnerResponse.body.cancel().catch(() => undefined);
      }
      return;
    }
    await actionsService.updateRunningRunLogs(
      input.repository.id,
      input.run.id,
      buildRunLogs({
        runId: input.run.id,
        runNumber: input.run.run_number,
        agentType: input.run.agent_type,
        prompt: input.run.prompt,
        claimedAt,
        startedAt,
        redactText: redactLogs
      })
    );

    if (isStreamedRunnerResponse(runnerResponse)) {
      runnerResult = await consumeStreamedRunnerResponse({
        actionsService,
        repositoryId: input.repository.id,
        runId: input.run.id,
        runNumber: input.run.run_number,
        agentType: input.run.agent_type,
        prompt: input.run.prompt,
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

    if (!runnerResponse.ok) {
      const logs = buildRunLogs({
        runId: input.run.id,
        runNumber: input.run.run_number,
        agentType: input.run.agent_type,
        prompt: input.run.prompt,
        claimedAt,
        startedAt,
        result: runnerResult,
        errorMessage: `Container runner responded with HTTP ${runnerResponse.status}`,
        redactText: redactLogs
      });
      await finalizeRun({
        status: "failed",
        logs,
        exitCode: runnerResult.exitCode ?? null,
        result: runnerResult
      });
      return;
    }

    const exitCode = runnerResult.exitCode ?? -1;
    const logs = buildRunLogs({
      runId: input.run.id,
      runNumber: input.run.run_number,
      agentType: input.run.agent_type,
      prompt: input.run.prompt,
      claimedAt,
      startedAt,
      result: runnerResult,
      redactText: redactLogs
    });

    await finalizeRun({
      status: exitCode === 0 ? "success" : "failed",
      logs,
      exitCode,
      result: runnerResult
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown runner error";
    const logs = buildRunLogs({
      runId: input.run.id,
      runNumber: input.run.run_number,
      agentType: input.run.agent_type,
      prompt: input.run.prompt,
      claimedAt,
      startedAt,
      ...(runnerResult ? { result: runnerResult } : {}),
      errorMessage: message,
      redactText: redactLogs
    });
    await finalizeRun({
      status: "failed",
      logs,
      exitCode: runnerResult?.exitCode ?? null,
      ...(runnerResult ? { result: runnerResult } : {})
    });
  } finally {
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
