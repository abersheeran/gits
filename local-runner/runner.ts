import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type AgentType = "codex" | "claude_code";
type PollSession = {
  id: string; repositoryId: string; sessionNumber: number; attemptId: string; attemptNumber: number;
  agentType: AgentType; prompt: string; triggerRef: string | null; triggerSha: string | null;
  branchRef: string | null; sourceType: string; sourceNumber: number | null; origin: string;
};
type PollResponse = { session: PollSession | null };
type ClaimResponse = {
  claimed: boolean; callbackUrl: string; callbackToken: string; gitCloneUrl: string; gitCloneToken: string;
  gitCommitName?: string; gitCommitEmail?: string; agentType: AgentType; prompt: string;
  triggerRef: string | null; triggerSha: string | null; env?: Record<string, string>;
  sessionId: string; attemptId: string; sessionNumber: number; attemptNumber: number; instanceType: string;
};
type CommandResult = { stdout: string; stderr: string; exitCode: number; attemptedCommand: string; spawnError?: string };
type Settings = { token: string; platformUrl: string; pollIntervalMs: number; workspaceBaseDir: string; homeDir: string; verbose: boolean };

const HEARTBEAT_INTERVAL_MS = 5_000;
const ABORT_KILL_TIMEOUT_MS = 5_000;
const MCP_SERVER_NAME = "gits-platform";
const MCP_PATH = "/api/mcp";

const log = (message: string) => console.log(`[runner] ${message}`);
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) {
    resolve();
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    resolve();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
});
const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const buildCommandText = (command: string, args: string[]) => [command, ...args.map((arg) => JSON.stringify(arg))].join(" ");
const buildFailureDetail = (result: CommandResult) => [result.stdout, result.stderr, result.spawnError ?? ""].join("\n").trim();
const trim = (value: string | null | undefined) => value?.trim() ?? "";
const normalizeRef = (ref: string | null | undefined) => trim(ref).replace(/^refs\/heads\//, "");
const mergeOutput = (base: string, extra?: string) => (!extra ? base : !base ? extra : base.endsWith(extra) ? base : `${base}\n${extra}`);
const throwIfAborted = (signal: AbortSignal) => { if (signal.aborted) throw new Error("execution cancelled by platform"); };
const isShallowUnsupportedError = (result: CommandResult) => /expected shallow\/unshallow|does not support shallow|shallow file has changed|dumb http transport does not support shallow/i.test(buildFailureDetail(result));

function requireEnv(name: string): string {
  const value = trim(process.env[name]);
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function getSettings(): Settings {
  return {
    token: requireEnv("GITS_TOKEN"),
    platformUrl: requireEnv("GITS_PLATFORM_URL").replace(/\/+$/, ""),
    pollIntervalMs: Number(process.env.GITS_POLL_INTERVAL ?? "5000") || 5000,
    workspaceBaseDir: trim(process.env.GITS_WORKSPACE_DIR) || os.tmpdir(),
    homeDir: trim(process.env.HOME) || os.homedir(),
    verbose: process.env.GITS_RUNNER_VERBOSE === "1"
  };
}

function decodeJwtSubject(token: string): string {
  try {
    const [, payload] = token.split(".");
    if (!payload) throw new Error("missing payload");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    if (typeof parsed.sub !== "string" || !parsed.sub) throw new Error("missing subject");
    return parsed.sub;
  } catch {
    throw new Error("Invalid callback token");
  }
}

function withGitCredentials(repositoryUrl: string, token: string): string {
  const url = new URL(repositoryUrl);
  url.username = "x-token";
  url.password = token;
  return url.toString();
}

async function spawnCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const attemptedCommand = buildCommandText(command, args);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ stdout: "", stderr: "", exitCode: -1, attemptedCommand, spawnError: toErrorMessage(error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abortChild);
      resolve(result);
    };

    const abortChild = () => {
      if (settled || child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      if (!killTimer) {
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, ABORT_KILL_TIMEOUT_MS);
        killTimer.unref?.();
      }
    };

    options.signal?.addEventListener("abort", abortChild, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      options.onStderr?.(text);
    });
    child.on("error", (error) => finish({ stdout, stderr, exitCode: -1, attemptedCommand, spawnError: toErrorMessage(error) }));
    child.on("close", (code) => finish({ stdout, stderr, exitCode: code ?? -1, attemptedCommand }));
  });
}

async function runOrThrow(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}, label = command): Promise<CommandResult> {
  const result = await spawnCommand(command, args, options);
  if (!result.spawnError && result.exitCode === 0) return result;
  throw new Error(`${label} failed: ${buildFailureDetail(result) || `exit code ${result.exitCode}`}`);
}

async function gitCloneWithFallback(repositoryUrl: string, workspaceDir: string, signal: AbortSignal): Promise<void> {
  const shallow = await spawnCommand("git", ["clone", "--depth", "1", repositoryUrl, workspaceDir], { signal });
  if (!shallow.spawnError && shallow.exitCode === 0) return;
  if (!isShallowUnsupportedError(shallow)) throw new Error(`git clone failed: ${buildFailureDetail(shallow) || `exit code ${shallow.exitCode}`}`);
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  await runOrThrow("git", ["clone", repositoryUrl, workspaceDir], { signal }, "git clone");
}

async function checkoutWorkspace(workspaceDir: string, ref: string | null, sha: string | null, signal: AbortSignal): Promise<void> {
  const normalizedRef = normalizeRef(ref);
  if (normalizedRef) await runOrThrow("git", ["-C", workspaceDir, "checkout", normalizedRef], { signal }, "git checkout");
  const normalizedSha = trim(sha);
  if (!normalizedSha) return;
  const first = await spawnCommand("git", ["-C", workspaceDir, "checkout", normalizedSha], { signal });
  if (!first.spawnError && first.exitCode === 0) return;
  const fetch = await spawnCommand("git", ["-C", workspaceDir, "fetch", "--depth", "1", "origin", normalizedSha], { signal });
  if (fetch.spawnError || fetch.exitCode !== 0) {
    if (!isShallowUnsupportedError(fetch)) throw new Error(`git fetch sha failed: ${buildFailureDetail(fetch) || `exit code ${fetch.exitCode}`}`);
    await runOrThrow("git", ["-C", workspaceDir, "fetch", "origin", normalizedSha], { signal }, "git fetch sha");
  }
  await runOrThrow("git", ["-C", workspaceDir, "checkout", normalizedSha], { signal }, "git checkout sha");
}

async function configureGitIdentity(workspaceDir: string, name?: string, email?: string): Promise<void> {
  if (!trim(name) || !trim(email)) return;
  await runOrThrow("git", ["-C", workspaceDir, "config", "user.name", trim(name)], {}, "git config user.name");
  await runOrThrow("git", ["-C", workspaceDir, "config", "user.email", trim(email)], {}, "git config user.email");
}

function buildPlatformMcpUrl(env: NodeJS.ProcessEnv): string | null {
  const apiBase = trim(env.GITS_PLATFORM_API_BASE);
  if (!apiBase) return null;
  const url = new URL(MCP_PATH, apiBase);
  if (trim(env.GITS_REPOSITORY_OWNER)) url.searchParams.set("owner", trim(env.GITS_REPOSITORY_OWNER));
  if (trim(env.GITS_REPOSITORY_NAME)) url.searchParams.set("repo", trim(env.GITS_REPOSITORY_NAME));
  if (trim(env.GITS_TRIGGER_ISSUE_NUMBER)) url.searchParams.set("issueNumber", trim(env.GITS_TRIGGER_ISSUE_NUMBER));
  return url.toString();
}

function buildRuntimeEnv(settings: Settings, claim: ClaimResponse): NodeJS.ProcessEnv {
  const commitName = trim(claim.gitCommitName);
  const commitEmail = trim(claim.gitCommitEmail);
  return {
    ...process.env,
    ...(claim.env ?? {}),
    ...(commitName && commitEmail ? {
      GIT_AUTHOR_NAME: commitName,
      GIT_AUTHOR_EMAIL: commitEmail,
      GIT_COMMITTER_NAME: commitName,
      GIT_COMMITTER_EMAIL: commitEmail
    } : {}),
    HOME: settings.homeDir,
    XDG_CONFIG_HOME: path.join(settings.homeDir, ".config"),
    GITS_TOKEN: settings.token,
    GITS_ISSUE_REPLY_TOKEN: settings.token,
    GITS_PR_CREATE_TOKEN: settings.token,
    GITS_ACTION_AGENT_TYPE: claim.agentType,
    CODEX_APPROVAL_POLICY: "never",
    CLAUDE_CODE_PERMISSION_MODE: "bypass"
  };
}

async function setupPlatformMcpServer(agentType: AgentType, workspaceDir: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const url = buildPlatformMcpUrl(env);
  if (!url) return "Skipped MCP setup because GITS_PLATFORM_API_BASE is missing";
  if (agentType === "codex") {
    await spawnCommand("codex", ["mcp", "remove", MCP_SERVER_NAME], { cwd: workspaceDir, env });
    const add = await spawnCommand("codex", ["mcp", "add", MCP_SERVER_NAME, "--url", url, "--bearer-token-env-var", "GITS_ISSUE_REPLY_TOKEN"], { cwd: workspaceDir, env });
    return !add.spawnError && add.exitCode === 0 ? null : buildFailureDetail(add) || `codex mcp add failed with exit code ${add.exitCode}`;
  }
  for (const command of ["claude", "claude-code"]) {
    await spawnCommand(command, ["mcp", "remove", MCP_SERVER_NAME], { cwd: workspaceDir, env });
    const add = await spawnCommand(command, ["mcp", "add", "--transport", "http", MCP_SERVER_NAME, url, "--header", `Authorization: Bearer ${env.GITS_ISSUE_REPLY_TOKEN ?? ""}`], { cwd: workspaceDir, env });
    if (!add.spawnError && add.exitCode === 0) return null;
    if (!add.spawnError) return buildFailureDetail(add) || `${command} mcp add failed with exit code ${add.exitCode}`;
  }
  return "Failed to find a runnable Claude MCP command";
}

function buildAgentCommandCandidates(agentType: AgentType, prompt: string): Array<{ command: string; args: string[] }> {
  return agentType === "codex"
    ? [
        { command: "codex", args: ["--dangerously-bypass-approvals-and-sandbox", "exec", prompt] },
        { command: "codex", args: ["--full-auto", "exec", prompt] },
        { command: "codex", args: ["exec", "--dangerously-bypass-approvals-and-sandbox", prompt] },
        { command: "codex", args: ["exec", prompt] },
        { command: "codex", args: ["run", prompt] },
        { command: "codex", args: [prompt] }
      ]
    : [
        { command: "claude-code", args: ["run", "--dangerously-skip-permissions", prompt] },
        { command: "claude", args: ["run", "--dangerously-skip-permissions", prompt] },
        { command: "claude-code", args: ["run", prompt] },
        { command: "claude", args: ["run", prompt] },
        { command: "claude-code", args: ["-p", prompt] },
        { command: "claude", args: ["-p", prompt] }
      ];
}

function shouldTryNextCandidate(result: CommandResult): boolean {
  return Boolean(result.spawnError) || /unknown option|unrecognized option|invalid option|usage:/i.test(result.stderr);
}

async function runAgent(claim: ClaimResponse, workspaceDir: string, env: NodeJS.ProcessEnv, signal: AbortSignal, onStdout: (chunk: string) => void, onStderr: (chunk: string) => void) {
  const mcpSetupWarning = await setupPlatformMcpServer(claim.agentType, workspaceDir, env);
  let last: CommandResult | null = null;
  for (const candidate of buildAgentCommandCandidates(claim.agentType, claim.prompt)) {
    const result = await spawnCommand(candidate.command, candidate.args, { cwd: workspaceDir, env, signal, onStdout, onStderr });
    last = result;
    if (!shouldTryNextCandidate(result)) return { ...result, mcpSetupWarning };
  }
  return { ...(last ?? { stdout: "", stderr: "No runnable agent command candidate found", exitCode: -1, attemptedCommand: "" }), mcpSetupWarning };
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function platformFetch<T>(settings: Settings, pathname: string, init: RequestInit = {}): Promise<{ response: Response; data?: T }> {
  const response = await fetch(`${settings.platformUrl}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${settings.token}`, ...(init.headers ?? {}) }
  });
  const data = response.headers.get("content-type")?.includes("application/json") ? await parseJson<T>(response).catch(() => undefined) : undefined;
  return { response, data };
}

async function sendCallback(url: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; cancelled: boolean }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await parseJson<{ cancelled?: unknown }>(response).catch(() => undefined);
  return { ok: response.ok, status: response.status, cancelled: data?.cancelled === true };
}

async function executeSession(session: PollSession, claim: ClaimResponse, settings: Settings, signal?: AbortSignal): Promise<number> {
  const startedAt = Date.now();
  const workspaceRoot = await (async () => { await mkdir(settings.workspaceBaseDir, { recursive: true }); return mkdtemp(path.join(settings.workspaceBaseDir, "gits-local-runner-")); })();
  const workspaceDir = path.join(workspaceRoot, "repo");
  const runtimeEnv = buildRuntimeEnv(settings, claim);
  const abortController = new AbortController();
  const callbackBase = {
    callbackToken: claim.callbackToken,
    repositoryId: session.repositoryId,
    sessionId: claim.sessionId,
    attemptId: claim.attemptId,
    instanceType: claim.instanceType,
    containerInstance: `local-runner-${decodeJwtSubject(claim.callbackToken)}`,
    sessionNumber: claim.sessionNumber,
    attemptNumber: claim.attemptNumber
  };

  let stdout = "", stderr = "", pendingStdout = "", pendingStderr = "";
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let cancelledByPlatform = false;
  let exitCode = -1, error: string | undefined, spawnError: string | undefined, attemptedCommand: string | undefined, mcpSetupWarning: string | undefined;
  const abortExecution = () => abortController.abort();

  if (signal?.aborted) {
    abortExecution();
  } else {
    signal?.addEventListener("abort", abortExecution, { once: true });
  }

  const sendHeartbeat = async () => {
    const payload = pendingStdout || pendingStderr
      ? { type: "heartbeat", ...callbackBase, stdout: pendingStdout, stderr: pendingStderr }
      : { type: "heartbeat", ...callbackBase };
    pendingStdout = "";
    pendingStderr = "";
    const result = await sendCallback(claim.callbackUrl, payload);
    if (result.cancelled) {
      if (settings.verbose) log("Session cancelled by platform");
      cancelledByPlatform = true;
      abortExecution();
      return;
    }
    if (!result.ok) {
      if (settings.verbose) log(`Error: heartbeat failed with HTTP ${result.status}, aborting execution`);
      cancelledByPlatform = true;
      abortExecution();
    }
  };

  try {
    throwIfAborted(abortController.signal);
    heartbeatTimer = setInterval(() => void sendHeartbeat().catch(() => {
      if (settings.verbose) log("Error: heartbeat failed, aborting execution");
      cancelledByPlatform = true;
      abortExecution();
    }), HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();

    await gitCloneWithFallback(withGitCredentials(claim.gitCloneUrl, claim.gitCloneToken), workspaceDir, abortController.signal);
    throwIfAborted(abortController.signal);
    await checkoutWorkspace(workspaceDir, claim.triggerRef, claim.triggerSha, abortController.signal);
    await configureGitIdentity(workspaceDir, claim.gitCommitName, claim.gitCommitEmail);
    throwIfAborted(abortController.signal);

    const result = await runAgent(
      claim,
      workspaceDir,
      runtimeEnv,
      abortController.signal,
      (chunk) => { stdout += chunk; pendingStdout += chunk; },
      (chunk) => { stderr += chunk; pendingStderr += chunk; }
    );

    exitCode = result.exitCode;
    spawnError = result.spawnError;
    attemptedCommand = result.attemptedCommand || undefined;
    mcpSetupWarning = result.mcpSetupWarning || undefined;
    if (spawnError) error = "failed to execute agent";
    else if (cancelledByPlatform) error = "execution cancelled by platform";
  } catch (caught) {
    error = toErrorMessage(caught);
    stderr = mergeOutput(stderr, error);
  } finally {
    signal?.removeEventListener("abort", abortExecution);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pendingStdout || pendingStderr) await sendHeartbeat().catch(() => undefined);
    const completionPayload = {
      type: "completion",
      ...callbackBase,
      exitCode,
      durationMs: Date.now() - startedAt,
      ...(stdout ? { stdout } : {}),
      ...(stderr ? { stderr } : {}),
      ...(error ? { error } : {}),
      ...(spawnError ? { spawnError } : {}),
      ...(attemptedCommand ? { attemptedCommand } : {}),
      ...(mcpSetupWarning ? { mcpSetupWarning } : {})
    };
    let completionSent = false;
    for (let attempt = 0; attempt < 3 && !completionSent; attempt++) {
      if (attempt > 0) await sleep(2_000);
      const completion = await sendCallback(claim.callbackUrl, completionPayload)
        .catch((caught) => ({ ok: false, status: -1, cancelled: false, error: toErrorMessage(caught) }));
      if (completion.ok) {
        completionSent = true;
      } else if (attempt === 2) {
        log(`Error: completion callback failed after 3 attempts${"error" in completion ? `: ${completion.error}` : `: HTTP ${completion.status}`}`);
      }
    }
    await rm(workspaceRoot, { recursive: true, force: true }).catch((caught) => log(`Error: failed to clean workspace: ${toErrorMessage(caught)}`));
  }

  log(`Session ${session.id} completed with exit code ${exitCode}`);
  return exitCode;
}

async function runLoop(settings: Settings, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    try {
      if (settings.verbose) log("Polling for sessions...");
      const poll = await platformFetch<PollResponse>(settings, "/api/runner/poll");
      if (!poll.response.ok) throw new Error(`poll failed: HTTP ${poll.response.status}`);
      const session = poll.data?.session ?? null;
      if (!session) {
        await sleep(settings.pollIntervalMs, signal);
        continue;
      }

      log(`Found session ${session.id}, claiming...`);
      const claim = await platformFetch<ClaimResponse>(settings, "/api/runner/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, attemptId: session.attemptId })
      });
      if (claim.response.status === 404 || claim.response.status === 409) {
        await sleep(settings.pollIntervalMs, signal);
        continue;
      }
      if (!claim.response.ok || !claim.data) throw new Error(`claim failed: HTTP ${claim.response.status}`);

      log(`Claimed session ${session.id}, executing...`);
      await executeSession(session, claim.data, settings, signal);
    } catch (error) {
      log(`Error: ${toErrorMessage(error)}`);
      await sleep(settings.pollIntervalMs, signal);
    }
  }
  log("Runner stopped.");
}

let shutdownRequested = false;
const shutdownController = new AbortController();

function requestShutdown() {
  if (shutdownRequested) process.exit(1);
  shutdownRequested = true;
  log("Shutting down...");
  shutdownController.abort();
}

process.on("SIGINT", requestShutdown);
process.on("SIGTERM", requestShutdown);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLoop(getSettings(), shutdownController.signal).catch((error) => {
    log(`Error: ${toErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
