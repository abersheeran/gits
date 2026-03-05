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

const ROOTLESS_HOME = "/home/rootless";
const ROOTLESS_CODEX_CONFIG_FILE_PATH = `${ROOTLESS_HOME}/.codex/config.toml`;
const ROOTLESS_CLAUDE_CODE_CONFIG_FILE_PATH = `${ROOTLESS_HOME}/.claude/settings.json`;

const CONFIG_PATH_MIGRATION_MAP = new Map<string, string>([
  ["/root/.codex/config.toml", ROOTLESS_CODEX_CONFIG_FILE_PATH],
  ["/root/.claude/settings.json", ROOTLESS_CLAUDE_CODE_CONFIG_FILE_PATH]
]);

const ALLOWED_CONFIG_FILE_PATHS = new Set([
  ROOTLESS_CODEX_CONFIG_FILE_PATH,
  ROOTLESS_CLAUDE_CODE_CONFIG_FILE_PATH,
  ...CONFIG_PATH_MIGRATION_MAP.keys()
]);

function writeJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
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

function buildAgentCommandCandidates(agentType: AgentType, prompt: string): CommandSpec[] {
  if (agentType === "codex") {
    return [
      {
        command: "codex",
        args: ["exec", "--dangerously-bypass-approvals-and-sandbox", "--full-auto", prompt]
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

async function runAgentPrompt(
  agentType: AgentType,
  prompt: string,
  workspaceDir: string
): Promise<CommandResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITS_ACTION_AGENT_TYPE: agentType,
    GITS_ACTION_PROMPT: prompt,
    CODEX_APPROVAL_POLICY: "never",
    CLAUDE_CODE_PERMISSION_MODE: "bypass"
  };

  const candidates = buildAgentCommandCandidates(agentType, prompt);
  let lastResult: CommandResult | null = null;
  for (const candidate of candidates) {
    const result = await runCommand(candidate.command, candidate.args, {
      cwd: workspaceDir,
      env
    });
    lastResult = result;

    if (!shouldTryNextCandidate(result)) {
      return result;
    }
  }

  return (
    lastResult ?? {
      stdout: "",
      stderr: "No runnable agent command candidate found",
      exitCode: -1,
      attemptedCommand: ""
    }
  );
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

  return {
    workspaceRoot,
    workspaceDir
  };
}

async function applyConfigFiles(configFiles: Record<string, string> | undefined): Promise<void> {
  if (!configFiles) {
    return;
  }
  for (const [filePath, content] of Object.entries(configFiles)) {
    if (!ALLOWED_CONFIG_FILE_PATHS.has(filePath)) {
      continue;
    }
    const destinationPath = CONFIG_PATH_MIGRATION_MAP.get(filePath) ?? filePath;
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, content, "utf8");
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
  try {
    const prepared = await prepareWorkspace(runRequest);
    workspaceRoot = prepared.workspaceRoot;
    await applyConfigFiles(runRequest.configFiles);

    const executed = await runAgentPrompt(agentType, prompt, prepared.workspaceDir);

    const stderr = [
      executed.stderr,
      executed.spawnError,
      executed.attemptedCommand ? `[attempted] ${executed.attemptedCommand}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    const result: RunResponse = {
      exitCode: executed.exitCode,
      stdout: executed.stdout,
      ...(stderr ? { stderr } : {}),
      durationMs: Date.now() - startedAt,
      ...(executed.spawnError ? { error: "failed to execute agent" } : {})
    };

    writeJson(response, 200, result);
  } catch (error) {
    const result: RunResponse = {
      exitCode: -1,
      stderr: toErrorMessage(error),
      durationMs: Date.now() - startedAt,
      error: "workspace preparation failed"
    };
    writeJson(response, 200, result);
  } finally {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
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
