import type { AuthUser, RepositoryRecord } from "../types";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "./action-runner-prompt-tokens";
import { AuthService } from "./auth-service";
import { ActionsService } from "./actions-service";

type RunnerExecuteResult = {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: string;
};

const MAX_LOG_CHARS = 120_000;

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

function buildRunLogs(input: {
  runId: string;
  runNumber: number;
  agentType: "codex" | "claude_code";
  prompt: string;
  result?: RunnerExecuteResult;
  errorMessage?: string;
}): string {
  const lines: string[] = [];
  lines.push(`run_id: ${input.runId}`);
  lines.push(`run_number: ${input.runNumber}`);
  lines.push(`agent_type: ${input.agentType}`);
  lines.push(`prompt: ${input.prompt}`);

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

  await actionsService.updateRunToRunning(input.repository.id, input.run.id, containerInstance);

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

  let ephemeralTokenId: string | null = null;
  let ephemeralToken: string | null = null;
  let issueReplyTokenId: string | null = null;
  let issueReplyToken: string | null = null;
  let prCreateTokenId: string | null = null;
  let prCreateToken: string | null = null;
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

    const globalConfig = await actionsService.getGlobalConfig();
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
    if (globalConfig.codexConfigFileContent.length > 0) {
      configFiles[CODEX_CONFIG_FILE_PATH] = globalConfig.codexConfigFileContent;
    }
    if (globalConfig.claudeCodeConfigFileContent.length > 0) {
      configFiles[CLAUDE_CODE_CONFIG_FILE_PATH] = globalConfig.claudeCodeConfigFileContent;
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

    let responsePayload: unknown = null;
    try {
      responsePayload = await runnerResponse.json();
    } catch {
      responsePayload = { error: await runnerResponse.text() };
    }

    runnerResult = parseRunnerResponse(responsePayload);

    if (!runnerResponse.ok) {
      const logs = buildRunLogs({
        runId: input.run.id,
        runNumber: input.run.run_number,
        agentType: input.run.agent_type,
        prompt: input.run.prompt,
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
