import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

type AgentType = "codex" | "claude_code";

type RunRequest = {
  agentType: AgentType;
  prompt: string;
  repositoryUrl?: string;
  ref?: string;
  sha?: string;
  gitUsername?: string;
  gitToken?: string;
  allowGitPush?: boolean;
  gitCommitName?: string;
  gitCommitEmail?: string;
  env?: Record<string, string>;
  configFiles?: Record<string, string>;
};

type RunResponse = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  durationMs: number;
  error?: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  spawnError?: string;
  attemptedCommand: string;
};

type CommandSpec = {
  command: string;
  args: string[];
};

type RunCommandStreamOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
};

type AgentCommandResult = CommandResult & {
  stderrStreamed: boolean;
  mcpSetupWarning?: string;
};

type BoundedOutputBuffer = {
  text: string;
  truncatedChars: number;
};

type RunStreamEvent =
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

type ConfigFileKind = "codex" | "claude_code";

const ROOTLESS_HOME = "/home/rootless";
const ROOT_HOME = "/root";
const CODEX_CONFIG_RELATIVE_PATH = ".codex/config.toml";
const CLAUDE_CODE_CONFIG_RELATIVE_PATH = ".claude/settings.json";
const GITS_PLATFORM_MCP_SERVER_NAME = "gits-platform";
const GITS_PLATFORM_MCP_PATH = "/api/mcp";
const GITS_PLATFORM_MCP_AUTH_TOKEN_ENV_KEYS = [
  "GITS_ISSUE_REPLY_TOKEN",
  "GITS_PR_CREATE_TOKEN"
] as const;
const MAX_CAPTURED_OUTPUT_CHARS = 256_000;
const ABORT_KILL_TIMEOUT_MS = 5_000;
const RUN_STREAM_KEEPALIVE_INTERVAL_MS = 5_000;

function normalizeHomePath(homePath: string | undefined): string | null {
  const trimmed = homePath?.trim() ?? "";
  return trimmed ? path.resolve(trimmed) : null;
}

function resolveRuntimeHomePath(): string {
  return normalizeHomePath(process.env.HOME) ?? normalizeHomePath(os.homedir()) ?? ROOTLESS_HOME;
}

function buildKnownHomePaths(runtimeHomePath: string): string[] {
  const normalizedPaths = [runtimeHomePath, ROOTLESS_HOME, ROOT_HOME]
    .map((homePath) => normalizeHomePath(homePath))
    .filter((homePath): homePath is string => Boolean(homePath));
  return [...new Set(normalizedPaths)];
}

const RUNTIME_HOME_PATH = resolveRuntimeHomePath();
const KNOWN_HOME_PATHS = buildKnownHomePaths(RUNTIME_HOME_PATH);

function buildConfigFilePath(homePath: string, kind: ConfigFileKind): string {
  if (kind === "codex") {
    return path.join(homePath, CODEX_CONFIG_RELATIVE_PATH);
  }
  return path.join(homePath, CLAUDE_CODE_CONFIG_RELATIVE_PATH);
}

function buildConfigDestinations(kind: ConfigFileKind): string[] {
  return KNOWN_HOME_PATHS.map((homePath) => buildConfigFilePath(homePath, kind));
}

const CONFIG_DESTINATIONS_BY_KIND: Record<ConfigFileKind, string[]> = {
  codex: buildConfigDestinations("codex"),
  claude_code: buildConfigDestinations("claude_code")
};

const CONFIG_DESTINATION_MAP = new Map<string, string[]>();

for (const kind of ["codex", "claude_code"] as const) {
  const destinations = CONFIG_DESTINATIONS_BY_KIND[kind];
  for (const destinationPath of destinations) {
    CONFIG_DESTINATION_MAP.set(destinationPath, destinations);
  }
}

const ALLOWED_CONFIG_FILE_PATHS = new Set(CONFIG_DESTINATION_MAP.keys());

function writeJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function writeRunStreamEvent(response: http.ServerResponse, payload: RunStreamEvent): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  try {
    response.write(`${JSON.stringify(payload)}\n`);
  } catch {
    // The caller will observe the closed response via the socket close event.
  }
}

function writeRunStreamKeepalive(response: http.ServerResponse): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  try {
    response.write("\n");
  } catch {
    // The caller will observe the closed response via the socket close event.
  }
}

function normalizeRef(ref: string | undefined): string {
  const trimmed = ref?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("refs/heads/") ? trimmed.slice("refs/heads/".length) : trimmed;
}

function withGitCredentials(
  repositoryUrl: string | undefined,
  username: string | undefined,
  token: string | undefined
): string {
  const raw = repositoryUrl?.trim() ?? "";
  if (!raw || !username?.trim() || !token?.trim()) {
    return raw;
  }

  const parsed = new URL(raw);
  parsed.username = username.trim();
  parsed.password = token.trim();
  return parsed.toString();
}

function buildCommandText(command: string, args: string[]): string {
  return [command, ...args.map((arg) => JSON.stringify(arg))].join(" ");
}

function buildCommandFailureDetail(result: CommandResult): string {
  return [result.stdout, result.stderr, result.spawnError ?? ""].join("\n").trim();
}

function createBoundedOutputBuffer(): BoundedOutputBuffer {
  return {
    text: "",
    truncatedChars: 0
  };
}

function appendOutputChunk(
  current: BoundedOutputBuffer,
  chunk: string,
  limit = MAX_CAPTURED_OUTPUT_CHARS
): BoundedOutputBuffer {
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

function formatOutputBuffer(buffer: BoundedOutputBuffer): string {
  if (buffer.truncatedChars === 0) {
    return buffer.text;
  }
  return `[truncated ${buffer.truncatedChars} chars]\n${buffer.text}`;
}

function isShallowUnsupportedError(result: CommandResult): boolean {
  const combined = [result.stdout, result.stderr, result.spawnError ?? ""].join("\n").toLowerCase();
  return (
    combined.includes("expected shallow/unshallow") ||
    combined.includes("does not support shallow") ||
    combined.includes("shallow file has changed") ||
    combined.includes("dumb http transport does not support shallow")
  );
}

async function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env ?? process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      resolve({
        stdout,
        stderr,
        exitCode: -1,
        spawnError: error.message,
        attemptedCommand: buildCommandText(command, args)
      });
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        attemptedCommand: buildCommandText(command, args)
      });
    });
  });
}

async function runCommandStreaming(
  command: string,
  args: string[],
  options?: RunCommandStreamOptions
): Promise<CommandResult & { stderrStreamed: boolean }> {
  return new Promise<CommandResult & { stderrStreamed: boolean }>((resolve) => {
    const attemptedCommand = buildCommandText(command, args);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options?.cwd,
        env: options?.env ?? process.env
      });
    } catch (error) {
      resolve({
        stdout: "",
        stderr: "",
        exitCode: -1,
        spawnError: toErrorMessage(error),
        attemptedCommand,
        stderrStreamed: false
      });
      return;
    }

    let stdout = createBoundedOutputBuffer();
    let stderr = createBoundedOutputBuffer();
    let stderrStreamed = false;
    let settled = false;
    let abortKillTimer: NodeJS.Timeout | null = null;

    const handleStdout = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout = appendOutputChunk(stdout, text);
      options?.onStdout?.(text);
    };

    const handleStderr = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr = appendOutputChunk(stderr, text);
      stderrStreamed = true;
      options?.onStderr?.(text);
    };

    const cleanup = () => {
      options?.signal?.removeEventListener("abort", abortChildProcess);
      if (abortKillTimer) {
        clearTimeout(abortKillTimer);
        abortKillTimer = null;
      }
      child.stdout?.off("data", handleStdout);
      child.stderr?.off("data", handleStderr);
      child.off("error", handleError);
      child.off("close", handleClose);
    };

    const finalize = (result: CommandResult & { stderrStreamed: boolean }) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const abortChildProcess = () => {
      if (settled || child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      if (!abortKillTimer) {
        abortKillTimer = setTimeout(() => {
          if (!settled && child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, ABORT_KILL_TIMEOUT_MS);
        abortKillTimer.unref?.();
      }
    };

    options?.signal?.addEventListener("abort", abortChildProcess, { once: true });

    const handleError = (error: Error) => {
      finalize({
        stdout: formatOutputBuffer(stdout),
        stderr: formatOutputBuffer(stderr),
        exitCode: -1,
        spawnError: error.message,
        attemptedCommand,
        stderrStreamed
      });
    };

    const handleClose = (code: number | null) => {
      finalize({
        stdout: formatOutputBuffer(stdout),
        stderr: formatOutputBuffer(stderr),
        exitCode: code ?? -1,
        attemptedCommand,
        stderrStreamed
      });
    };

    child.stdout?.on("data", handleStdout);
    child.stderr?.on("data", handleStderr);
    child.on("error", handleError);
    child.on("close", handleClose);
  });
}

function buildAgentCommandCandidates(agentType: AgentType, prompt: string): CommandSpec[] {
  if (agentType === "codex") {
    return [
      {
        command: "codex",
        args: ["--dangerously-bypass-approvals-and-sandbox", "exec", prompt]
      },
      {
        command: "codex",
        args: ["--full-auto", "exec", prompt]
      },
      {
        command: "codex",
        args: ["exec", "--dangerously-bypass-approvals-and-sandbox", prompt]
      },
      {
        command: "codex",
        args: ["exec", prompt]
      },
      {
        command: "codex",
        args: ["run", prompt]
      },
      {
        command: "codex",
        args: [prompt]
      }
    ];
  }

  return [
    {
      command: "claude-code",
      args: ["run", "--dangerously-skip-permissions", prompt]
    },
    {
      command: "claude",
      args: ["run", "--dangerously-skip-permissions", prompt]
    },
    {
      command: "claude-code",
      args: ["run", prompt]
    },
    {
      command: "claude",
      args: ["run", prompt]
    },
    {
      command: "claude-code",
      args: ["-p", prompt]
    },
    {
      command: "claude",
      args: ["-p", prompt]
    }
  ];
}

function shouldTryNextCandidate(result: CommandResult): boolean {
  if (result.spawnError) {
    return true;
  }

  const stderr = result.stderr.toLowerCase();
  return (
    stderr.includes("unknown option") ||
    stderr.includes("unrecognized option") ||
    stderr.includes("invalid option") ||
    stderr.includes("usage:")
  );
}

function buildPlatformMcpUrl(env: NodeJS.ProcessEnv): string | null {
  const apiBase = env.GITS_PLATFORM_API_BASE?.trim() ?? "";
  if (!apiBase) {
    return null;
  }

  const url = new URL(GITS_PLATFORM_MCP_PATH, apiBase);
  const repositoryOwner = env.GITS_REPOSITORY_OWNER?.trim();
  const repositoryName = env.GITS_REPOSITORY_NAME?.trim();
  const issueNumber = env.GITS_TRIGGER_ISSUE_NUMBER?.trim();

  if (repositoryOwner) {
    url.searchParams.set("owner", repositoryOwner);
  }
  if (repositoryName) {
    url.searchParams.set("repo", repositoryName);
  }
  if (issueNumber) {
    url.searchParams.set("issueNumber", issueNumber);
  }

  return url.toString();
}

function resolvePlatformMcpTokenEnvVar(env: NodeJS.ProcessEnv): string | null {
  for (const key of GITS_PLATFORM_MCP_AUTH_TOKEN_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      return key;
    }
  }
  return null;
}

function resolvePlatformMcpTokenValue(env: NodeJS.ProcessEnv): string | null {
  const envVar = resolvePlatformMcpTokenEnvVar(env);
  return envVar ? env[envVar]?.trim() ?? null : null;
}

async function setupCodexPlatformMcpServer(
  workspaceDir: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const platformMcpUrl = buildPlatformMcpUrl(env);
  if (!platformMcpUrl) {
    return "Skipped MCP setup because GITS_PLATFORM_API_BASE is missing";
  }
  const bearerTokenEnvVar = resolvePlatformMcpTokenEnvVar(env);
  if (!bearerTokenEnvVar) {
    return null;
  }

  const removeArgs = ["mcp", "remove", GITS_PLATFORM_MCP_SERVER_NAME];
  await runCommand("codex", removeArgs, { cwd: workspaceDir, env });

  const addArgs = [
    "mcp",
    "add",
    GITS_PLATFORM_MCP_SERVER_NAME,
    "--url",
    platformMcpUrl,
    "--bearer-token-env-var",
    bearerTokenEnvVar
  ];

  const add = await runCommand("codex", addArgs, { cwd: workspaceDir, env });
  if (!add.spawnError && add.exitCode === 0) {
    return null;
  }
  const detail = buildCommandFailureDetail(add);
  return detail || `codex mcp add failed with exit code ${add.exitCode}`;
}

async function setupClaudePlatformMcpServer(
  workspaceDir: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const platformMcpUrl = buildPlatformMcpUrl(env);
  if (!platformMcpUrl) {
    return "Skipped MCP setup because GITS_PLATFORM_API_BASE is missing";
  }
  const bearerToken = resolvePlatformMcpTokenValue(env);
  if (!bearerToken) {
    return null;
  }

  const commandCandidates = ["claude", "claude-code"];
  let lastFailure: string | null = null;

  for (const command of commandCandidates) {
    const removeArgs = ["mcp", "remove", GITS_PLATFORM_MCP_SERVER_NAME];
    await runCommand(command, removeArgs, { cwd: workspaceDir, env });

    const addArgs = [
      "mcp",
      "add",
      "--transport",
      "http",
      GITS_PLATFORM_MCP_SERVER_NAME,
      platformMcpUrl,
      "--header",
      `Authorization: Bearer ${bearerToken}`
    ];

    const add = await runCommand(command, addArgs, { cwd: workspaceDir, env });
    if (!add.spawnError && add.exitCode === 0) {
      return null;
    }
    if (add.spawnError) {
      continue;
    }
    const detail = buildCommandFailureDetail(add);
    lastFailure = detail || `${command} mcp add failed with exit code ${add.exitCode}`;
  }

  return lastFailure;
}

async function setupPlatformMcpServer(
  agentType: AgentType,
  workspaceDir: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  if (agentType === "codex") {
    return setupCodexPlatformMcpServer(workspaceDir, env);
  }
  return setupClaudePlatformMcpServer(workspaceDir, env);
}

async function runAgentPrompt(
  agentType: AgentType,
  prompt: string,
  workspaceDir: string,
  runtimeEnv: Record<string, string> | undefined,
  gitCommitIdentity:
    | {
        name?: string;
        email?: string;
      }
    | undefined,
  outputHandlers?: {
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  },
  signal?: AbortSignal
): Promise<AgentCommandResult> {
  const commitName = gitCommitIdentity?.name?.trim() ?? "";
  const commitEmail = gitCommitIdentity?.email?.trim() ?? "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(runtimeEnv ?? {}),
    ...(commitName && commitEmail
      ? {
          GIT_AUTHOR_NAME: commitName,
          GIT_AUTHOR_EMAIL: commitEmail,
          GIT_COMMITTER_NAME: commitName,
          GIT_COMMITTER_EMAIL: commitEmail
        }
      : {}),
    HOME: RUNTIME_HOME_PATH,
    XDG_CONFIG_HOME: path.join(RUNTIME_HOME_PATH, ".config"),
    GITS_ACTION_AGENT_TYPE: agentType,
    CODEX_APPROVAL_POLICY: "never",
    CLAUDE_CODE_PERMISSION_MODE: "bypass"
  };

  const mcpSetupWarning = await setupPlatformMcpServer(agentType, workspaceDir, env);
  const candidates = buildAgentCommandCandidates(agentType, prompt);
  let lastResult: (CommandResult & { stderrStreamed: boolean }) | null = null;
  for (const candidate of candidates) {
    const result = await runCommandStreaming(candidate.command, candidate.args, {
      cwd: workspaceDir,
      env,
      onStdout: outputHandlers?.onStdout,
      onStderr: outputHandlers?.onStderr,
      signal
    });
    lastResult = result;

    if (!shouldTryNextCandidate(result)) {
      return {
        ...result,
        ...(mcpSetupWarning ? { mcpSetupWarning } : {})
      };
    }
  }

  const fallbackResult =
    lastResult ?? {
      stdout: "",
      stderr: "No runnable agent command candidate found",
      exitCode: -1,
      attemptedCommand: "",
      stderrStreamed: false
    };
  return {
    ...fallbackResult,
    ...(mcpSetupWarning ? { mcpSetupWarning } : {})
  };
}

async function gitCloneWithFallback(repositoryUrl: string, workspaceDir: string): Promise<CommandResult> {
  const shallowClone = await runCommand("git", ["clone", "--depth", "1", repositoryUrl, workspaceDir]);
  if (!shallowClone.spawnError && shallowClone.exitCode === 0) {
    return shallowClone;
  }
  if (!isShallowUnsupportedError(shallowClone)) {
    return shallowClone;
  }

  await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  return runCommand("git", ["clone", repositoryUrl, workspaceDir]);
}

async function gitFetchShaWithFallback(workspaceDir: string, sha: string): Promise<CommandResult> {
  const shallowFetch = await runCommand("git", [
    "-C",
    workspaceDir,
    "fetch",
    "--depth",
    "1",
    "origin",
    sha
  ]);
  if (!shallowFetch.spawnError && shallowFetch.exitCode === 0) {
    return shallowFetch;
  }
  if (!isShallowUnsupportedError(shallowFetch)) {
    return shallowFetch;
  }
  return runCommand("git", ["-C", workspaceDir, "fetch", "origin", sha]);
}

async function disableWorkspaceGitPush(
  workspaceDir: string,
  repositoryUrl: string
): Promise<void> {
  const commands: Array<readonly string[]> = [
    ["remote", "set-url", "origin", repositoryUrl],
    ["remote", "set-url", "--push", "origin", repositoryUrl]
  ];

  for (const args of commands) {
    const result = await runCommand("git", ["-C", workspaceDir, ...args]);
    if (!result.spawnError && result.exitCode === 0) {
      continue;
    }
    const detail = buildCommandFailureDetail(result);
    throw new Error(`git ${args.join(" ")} failed: ${detail || `exit code ${result.exitCode}`}`);
  }
}

async function prepareWorkspace(request: RunRequest): Promise<{ workspaceRoot: string; workspaceDir: string }> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "gits-actions-"));
  const repositoryUrl = request.repositoryUrl?.trim() ?? "";
  if (!repositoryUrl) {
    return {
      workspaceRoot,
      workspaceDir: workspaceRoot
    };
  }

  const authenticatedRepositoryUrl = withGitCredentials(
    repositoryUrl,
    request.gitUsername,
    request.gitToken
  );
  const workspaceDir = path.join(workspaceRoot, "repo");
  const clone = await gitCloneWithFallback(authenticatedRepositoryUrl, workspaceDir);
  if (clone.spawnError || clone.exitCode !== 0) {
    const detail = buildCommandFailureDetail(clone);
    throw new Error(`git clone failed: ${detail || `exit code ${clone.exitCode}`}`);
  }

  const normalizedRef = normalizeRef(request.ref);
  if (normalizedRef) {
    const checkout = await runCommand("git", ["-C", workspaceDir, "checkout", normalizedRef]);
    if (checkout.spawnError || checkout.exitCode !== 0) {
      const detail = [checkout.stdout, checkout.stderr, checkout.spawnError ?? ""].join("\n").trim();
      throw new Error(`git checkout failed: ${detail || `exit code ${checkout.exitCode}`}`);
    }
  }
  const normalizedSha = request.sha?.trim() ?? "";
  if (normalizedSha) {
    const checkoutSha = await runCommand("git", ["-C", workspaceDir, "checkout", normalizedSha]);
    if (checkoutSha.spawnError || checkoutSha.exitCode !== 0) {
      const fetchSha = await gitFetchShaWithFallback(workspaceDir, normalizedSha);
      if (fetchSha.spawnError || fetchSha.exitCode !== 0) {
        const detail = buildCommandFailureDetail(fetchSha);
        throw new Error(`git fetch sha failed: ${detail || `exit code ${fetchSha.exitCode}`}`);
      }
      const retryCheckoutSha = await runCommand("git", ["-C", workspaceDir, "checkout", normalizedSha]);
      if (retryCheckoutSha.spawnError || retryCheckoutSha.exitCode !== 0) {
        const detail = buildCommandFailureDetail(retryCheckoutSha);
        throw new Error(`git checkout sha failed: ${detail || `exit code ${retryCheckoutSha.exitCode}`}`);
      }
    }
  }

  if (request.allowGitPush === false) {
    await disableWorkspaceGitPush(workspaceDir, repositoryUrl);
  }

  return {
    workspaceRoot,
    workspaceDir
  };
}

async function configureWorkspaceGitIdentity(
  workspaceDir: string,
  input: {
    name?: string;
    email?: string;
  }
): Promise<void> {
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  if (!name || !email) {
    return;
  }

  const configEntries = [
    ["user.name", name],
    ["user.email", email]
  ] as const;

  for (const [key, value] of configEntries) {
    const result = await runCommand("git", ["-C", workspaceDir, "config", key, value]);
    if (!result.spawnError && result.exitCode === 0) {
      continue;
    }
    const detail = buildCommandFailureDetail(result);
    throw new Error(`git config ${key} failed: ${detail || `exit code ${result.exitCode}`}`);
  }
}

async function applyConfigFiles(configFiles: Record<string, string> | undefined): Promise<void> {
  if (!configFiles) {
    return;
  }

  const isPermissionDeniedError = (error: unknown): boolean => {
    if (!error || typeof error !== "object") {
      return false;
    }
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EACCES" || code === "EPERM" || code === "EROFS";
  };

  for (const [filePath, content] of Object.entries(configFiles)) {
    if (!ALLOWED_CONFIG_FILE_PATHS.has(filePath)) {
      continue;
    }

    const destinationPaths = CONFIG_DESTINATION_MAP.get(filePath) ?? [filePath];
    let wroteToAtLeastOneDestination = false;
    let lastPermissionError: unknown = null;

    for (const destinationPath of destinationPaths) {
      try {
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, content, "utf8");
        wroteToAtLeastOneDestination = true;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          lastPermissionError = error;
          continue;
        }
        throw error;
      }
    }

    if (!wroteToAtLeastOneDestination && lastPermissionError) {
      throw lastPermissionError;
    }
  }
}

async function parseJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function runHandler(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    writeJson(response, 405, { message: "method not allowed" });
    return;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    writeJson(response, 400, { message: "invalid JSON payload" });
    return;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    writeJson(response, 400, { message: "invalid JSON payload" });
    return;
  }

  const runRequest = payload as RunRequest;
  const agentType = runRequest.agentType;
  const prompt = runRequest.prompt?.trim() ?? "";
  if (agentType !== "codex" && agentType !== "claude_code") {
    writeJson(response, 400, { message: "field 'agentType' must be one of: codex, claude_code" });
    return;
  }
  if (!prompt) {
    writeJson(response, 400, { message: "field 'prompt' is required" });
    return;
  }

  const startedAt = Date.now();
  let workspaceRoot: string | null = null;
  const abortController = new AbortController();
  let keepaliveTimer: NodeJS.Timeout | null = null;
  const abortExecution = () => {
    abortController.abort();
  };
  const clearKeepalive = () => {
    if (!keepaliveTimer) {
      return;
    }
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  };
  request.once("aborted", abortExecution);
  response.once("close", abortExecution);
  try {
    const prepared = await prepareWorkspace(runRequest);
    workspaceRoot = prepared.workspaceRoot;
    await applyConfigFiles(runRequest.configFiles);
    if (runRequest.repositoryUrl?.trim()) {
      await configureWorkspaceGitIdentity(prepared.workspaceDir, {
        name: runRequest.gitCommitName,
        email: runRequest.gitCommitEmail
      });
    }

    response.statusCode = 200;
    response.setHeader("content-type", "application/x-ndjson");
    response.setHeader("cache-control", "no-cache");
    response.setHeader("x-content-type-options", "nosniff");
    keepaliveTimer = setInterval(() => {
      writeRunStreamKeepalive(response);
    }, RUN_STREAM_KEEPALIVE_INTERVAL_MS);
    keepaliveTimer.unref?.();

    const executed = await runAgentPrompt(
      agentType,
      prompt,
      prepared.workspaceDir,
      runRequest.env,
      {
        name: runRequest.gitCommitName,
        email: runRequest.gitCommitEmail
      },
      {
        onStdout: (chunk) => {
          writeRunStreamEvent(response, {
            type: "stdout",
            data: chunk
          });
        },
        onStderr: (chunk) => {
          writeRunStreamEvent(response, {
            type: "stderr",
            data: chunk
          });
        }
      },
      abortController.signal
    );

    writeRunStreamEvent(response, {
      type: "result",
      exitCode: executed.exitCode,
      durationMs: Date.now() - startedAt,
      ...(executed.spawnError ? { error: "failed to execute agent" } : {}),
      ...(!executed.stderrStreamed && executed.stderr ? { stderr: executed.stderr } : {}),
      ...(executed.spawnError ? { spawnError: executed.spawnError } : {}),
      ...(executed.attemptedCommand ? { attemptedCommand: executed.attemptedCommand } : {}),
      ...(executed.mcpSetupWarning ? { mcpSetupWarning: executed.mcpSetupWarning } : {})
    });
  } catch (error) {
    const result: RunResponse = {
      exitCode: -1,
      stderr: toErrorMessage(error),
      durationMs: Date.now() - startedAt,
      error: "workspace preparation failed"
    };
    if (response.headersSent) {
      writeRunStreamEvent(response, {
        type: "result",
        exitCode: result.exitCode,
        stderr: result.stderr,
        durationMs: result.durationMs,
        error: result.error
      });
    } else {
      writeJson(response, 500, result);
    }
  } finally {
    clearKeepalive();
    request.off("aborted", abortExecution);
    response.off("close", abortExecution);
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    if (!response.destroyed && !response.writableEnded) {
      response.end();
    }
  }
}

const portValue = Number.parseInt(process.env.PORT ?? "8080", 10);
const port = Number.isFinite(portValue) ? portValue : 8080;

const server = http.createServer((request, response) => {
  const requestPath = request.url ? new URL(request.url, "http://localhost").pathname : "/";
  if (requestPath === "/run") {
    void runHandler(request, response);
    return;
  }

  if (requestPath === "/healthz") {
    writeJson(response, 200, {
      ok: true,
      timestamp: Date.now()
    });
    return;
  }

  writeJson(response, 404, {
    message: "not found"
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`actions runner listening on :${port}`);
});
