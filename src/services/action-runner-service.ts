import type { AuthUser, RepositoryRecord } from "../types";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "./action-runner-prompt-tokens";
import { buildActionRunLifecycleLines } from "./action-run-log-format";
import { AuthService } from "./auth-service";
import { ActionsService } from "./actions-service";

type RunnerExecuteResult = {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: string;
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
}): string {
  const lines: string[] = [];
  lines.push(`run_id: ${input.runId}`);
  lines.push(`run_number: ${input.runNumber}`);
  lines.push(`agent_type: ${input.agentType}`);
  lines.push(`prompt: ${input.prompt}`);
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
    lines.push(input.errorMessage);
  }

  if (input.result?.error) {
    lines.push("");
    lines.push("[runner_error]");
    lines.push(input.result.error);
  }

  if (input.result?.stdout) {
    lines.push("");
    lines.push("[stdout]");
    lines.push(input.result.stdout);
  }

  if (input.result?.stderr) {
    lines.push("");
    lines.push("[stderr]");
    lines.push(input.result.stderr);
  }

  return truncateLog(lines.join("\n"));
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
    result
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
        ...(error ? { error } : {})
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
      stdout = appendBoundedLog(stdout, event.data);
      pendingCharsSinceFlush += event.data.length;
      await flushLogs();
      return;
    }

    if (event.type === "stderr") {
      stderr = appendBoundedLog(stderr, event.data);
      pendingCharsSinceFlush += event.data.length;
      await flushLogs();
      return;
    }

    exitCode = event.exitCode;
    durationMs = event.durationMs;
    error = event.error;
    receivedResultEvent = true;
    stderr = appendBoundedDiagnostic(stderr, event.stderr);
    stderr = appendBoundedDiagnostic(stderr, event.spawnError);
    stderr = appendBoundedDiagnostic(
      stderr,
      event.mcpSetupWarning ? `[mcp_setup] ${event.mcpSetupWarning}` : null
    );
    stderr = appendBoundedDiagnostic(
      stderr,
      event.attemptedCommand ? `[attempted] ${event.attemptedCommand}` : null
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

  return {
    ...(typeof data.exitCode === "number" ? { exitCode: data.exitCode } : {}),
    ...(typeof data.stdout === "string" ? { stdout: data.stdout } : {}),
    ...(typeof data.stderr === "string" ? { stderr: data.stderr } : {}),
    ...(typeof data.durationMs === "number" ? { durationMs: data.durationMs } : {}),
    ...(typeof data.error === "string" ? { error: data.error } : {})
  };
}

export async function executeActionRun(input: {
  env: {
    DB: D1Database;
    JWT_SECRET: string;
    ACTIONS_RUNNER?: DurableObjectNamespace;
  };
  repository: RepositoryRecord;
  run: {
    id: string;
    run_number: number;
    repository_id: string;
    agent_type: "codex" | "claude_code";
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
  const containerInstance = `action-run-${input.run.id}`;

  if (!input.env.ACTIONS_RUNNER) {
    const logs = buildRunLogs({
      runId: input.run.id,
      runNumber: input.run.run_number,
      agentType: input.run.agent_type,
      prompt: input.run.prompt,
      errorMessage: "ACTIONS_RUNNER binding is not configured"
    });
    await actionsService.completeRun(input.repository.id, input.run.id, {
      status: "failed",
      logs,
      exitCode: null
    });
    return;
  }

  let claimedAt = await actionsService.claimQueuedRun(input.repository.id, input.run.id, containerInstance);
  if (claimedAt === null) {
    return;
  }

  let ephemeralTokenId: string | null = null;
  let ephemeralToken: string | null = null;
  let issueReplyTokenId: string | null = null;
  let issueReplyToken: string | null = null;
  let prCreateTokenId: string | null = null;
  let prCreateToken: string | null = null;
  let startedAt: number | null = null;
  let runnerResult: RunnerExecuteResult | undefined;
  let runtimePrompt = input.run.prompt;

  try {
    if (input.triggeredByUser) {
      const authService = new AuthService(input.env.DB, input.env.JWT_SECRET);
      const createdToken = await authService.createAccessToken({
        userId: input.triggeredByUser.id,
        name: `actions-run-${input.run.run_number}`,
        expiresAt: Date.now() + 15 * 60 * 1000,
        internal: true
      });
      ephemeralTokenId = createdToken.tokenId;
      ephemeralToken = createdToken.token;

      const needsIssueReplyToken =
        input.run.trigger_source_type === "issue" ||
        runtimePrompt.includes(ISSUE_REPLY_TOKEN_PLACEHOLDER);
      const needsPrCreateToken =
        input.run.trigger_source_type === "issue" ||
        runtimePrompt.includes(ISSUE_PR_CREATE_TOKEN_PLACEHOLDER);

      if (needsIssueReplyToken) {
        const replyToken = await authService.createAccessToken({
          userId: input.triggeredByUser.id,
          name: `actions-issue-reply-${input.run.run_number}`,
          expiresAt: Date.now() + 20 * 60 * 1000,
          internal: true,
          displayAsActions: true
        });
        issueReplyTokenId = replyToken.tokenId;
        issueReplyToken = replyToken.token;
        runtimePrompt = runtimePrompt.replaceAll(ISSUE_REPLY_TOKEN_PLACEHOLDER, replyToken.token);
      }

      if (needsPrCreateToken) {
        const prToken = await authService.createAccessToken({
          userId: input.triggeredByUser.id,
          name: `actions-pr-create-${input.run.run_number}`,
          expiresAt: Date.now() + 20 * 60 * 1000,
          internal: true
        });
        prCreateTokenId = prToken.tokenId;
        prCreateToken = prToken.token;
        runtimePrompt = runtimePrompt.replaceAll(ISSUE_PR_CREATE_TOKEN_PLACEHOLDER, prToken.token);
      }
    }

    const repositoryConfig = await actionsService.getRepositoryConfig(input.repository.id);
    const repositoryOrigin = normalizeCloneOrigin({
      requestOrigin: input.requestOrigin
    });
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
      ...(issueReplyToken ? { GITS_ISSUE_REPLY_TOKEN: issueReplyToken } : {}),
      ...(prCreateToken ? { GITS_PR_CREATE_TOKEN: prCreateToken } : {})
    };

    const configFiles: Record<string, string> = {};
    if (repositoryConfig.codexConfigFileContent.length > 0) {
      configFiles[CODEX_CONFIG_FILE_PATH] = repositoryConfig.codexConfigFileContent;
    }
    if (repositoryConfig.claudeCodeConfigFileContent.length > 0) {
      configFiles[CLAUDE_CODE_CONFIG_FILE_PATH] = repositoryConfig.claudeCodeConfigFileContent;
    }

    const runnerStub = input.env.ACTIONS_RUNNER.getByName(containerInstance);
    const runnerResponse = await runnerStub.fetch("https://actions-container.internal/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        agentType: input.run.agent_type,
        prompt: runtimePrompt,
        repositoryUrl: `${repositoryOrigin}/${input.repository.owner_username}/${input.repository.name}.git`,
        ref: input.run.trigger_ref ?? undefined,
        sha: input.run.trigger_sha ?? undefined,
        gitUsername: input.triggeredByUser?.username,
        gitToken: ephemeralToken ?? undefined,
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
        startedAt
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
        response: runnerResponse
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

    if (!runnerResponse.ok) {
      const logs = buildRunLogs({
        runId: input.run.id,
        runNumber: input.run.run_number,
        agentType: input.run.agent_type,
        prompt: input.run.prompt,
        claimedAt,
        startedAt,
        result: runnerResult,
        errorMessage: `Container runner responded with HTTP ${runnerResponse.status}`
      });
      await actionsService.completeRun(input.repository.id, input.run.id, {
        status: "failed",
        logs,
        exitCode: runnerResult.exitCode ?? null
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
      result: runnerResult
    });

    await actionsService.completeRun(input.repository.id, input.run.id, {
      status: exitCode === 0 ? "success" : "failed",
      logs,
      exitCode
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
      errorMessage: message
    });
    await actionsService.completeRun(input.repository.id, input.run.id, {
      status: "failed",
      logs,
      exitCode: runnerResult?.exitCode ?? null
    });
  } finally {
    if (input.triggeredByUser && (ephemeralTokenId || issueReplyTokenId || prCreateTokenId)) {
      const authService = new AuthService(input.env.DB, input.env.JWT_SECRET);
      if (ephemeralTokenId) {
        await authService
          .revokeAccessToken(input.triggeredByUser.id, ephemeralTokenId)
          .catch(() => undefined);
      }
      if (issueReplyTokenId) {
        await authService
          .revokeAccessToken(input.triggeredByUser.id, issueReplyTokenId)
          .catch(() => undefined);
      }
      if (prCreateTokenId) {
        await authService
          .revokeAccessToken(input.triggeredByUser.id, prCreateTokenId)
          .catch(() => undefined);
      }
    }

    try {
      const runnerStub = input.env.ACTIONS_RUNNER.getByName(containerInstance);
      await runnerStub.fetch("https://actions-container.internal/stop", {
        method: "POST"
      });
    } catch {
      // best-effort stop
    }
  }
}
