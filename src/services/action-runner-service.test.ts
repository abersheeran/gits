import { afterEach, describe, expect, it, vi } from "vitest";
import { executeActionRun } from "./action-runner-service";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "./action-runner-prompt-tokens";
import { ActionsService } from "./actions-service";
import { AuthService } from "./auth-service";

describe("executeActionRun", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes repository action config files to the runner container", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunToRunning").mockResolvedValue(2);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "model = \"gpt-5-codex\"",
      claudeCodeConfigFileContent: "{\n  \"permissions\": \"bypass\"\n}",
      inheritsGlobalCodexConfig: false,
      inheritsGlobalClaudeCodeConfig: false,
      updated_at: 1
    });

    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        configFiles?: Record<string, string>;
      };

      expect(payload.configFiles).toEqual({
        "/home/rootless/.codex/config.toml": "model = \"gpt-5-codex\"",
        "/home/rootless/.claude/settings.json": "{\n  \"permissions\": \"bypass\"\n}"
      });

      return new Response(JSON.stringify({ exitCode: 0, durationMs: 25 }), {
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      run: {
        id: "run-1",
        run_number: 1,
        repository_id: "repo-1",
        agent_type: "codex",
        instance_type: "lite",
        prompt: "请执行测试并修复失败。",
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123",
        trigger_source_type: null,
        trigger_source_number: null
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(runnerFetch).toHaveBeenCalledTimes(1);
    expect(stopFetch).toHaveBeenCalledTimes(1);
  });

  it("uses the matching runner binding for non-lite instance types", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunToRunning").mockResolvedValue(2);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      instanceType: "standard-3",
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });

    const liteFetch = vi.fn();
    const standard3Fetch = vi.fn(async () =>
      new Response(JSON.stringify({ exitCode: 0, durationMs: 25 }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: liteFetch
          })
        } as unknown as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_3: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : standard3Fetch(url, init)
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      run: {
        id: "run-2",
        run_number: 2,
        repository_id: "repo-1",
        agent_type: "codex",
        instance_type: "standard-3",
        prompt: "请执行测试并修复失败。",
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123",
        trigger_source_type: null,
        trigger_source_number: null
      },
      requestOrigin: "http://localhost:8787"
    });

    expect(liteFetch).not.toHaveBeenCalled();
    expect(standard3Fetch).toHaveBeenCalledTimes(1);
    expect(stopFetch).toHaveBeenCalledTimes(1);
  });

  it("redacts issued tokens from streamed action logs", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunToRunning").mockResolvedValue(2);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    const completeRun = vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });

    const createdTokens = [
      { tokenId: "tok-run", token: "gts_11111111111111111111111111111111" },
      { tokenId: "tok-issue", token: "gts_22222222222222222222222222222222" },
      { tokenId: "tok-pr", token: "gts_33333333333333333333333333333333" }
    ];
    vi.spyOn(AuthService.prototype, "createAccessToken").mockImplementation(async () => {
      const next = createdTokens.shift();
      if (!next) {
        throw new Error("unexpected token creation");
      }
      return next;
    });
    vi.spyOn(AuthService.prototype, "revokeAccessToken").mockResolvedValue(true);

    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        prompt: string;
        gitToken?: string;
        env?: Record<string, string>;
      };

      expect(payload.gitToken).toBe("gts_11111111111111111111111111111111");
      expect(payload.prompt).toContain("gts_22222222222222222222222222222222");
      expect(payload.prompt).toContain("gts_33333333333333333333333333333333");

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              [
                JSON.stringify({
                  type: "stdout",
                  data: `issue reply token: ${payload.env?.GITS_ISSUE_REPLY_TOKEN}\n`
                }),
                JSON.stringify({
                  type: "result",
                  exitCode: 0,
                  durationMs: 25,
                  attemptedCommand: `codex exec ${JSON.stringify(payload.prompt)}`
                })
              ].join("\n")
            )
          );
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson"
        }
      });
    });
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      run: {
        id: "run-3",
        run_number: 3,
        repository_id: "repo-1",
        agent_type: "codex",
        instance_type: "lite",
        prompt: `reply with ${ISSUE_REPLY_TOKEN_PLACEHOLDER} and open pr with ${ISSUE_PR_CREATE_TOKEN_PLACEHOLDER}`,
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123",
        trigger_source_type: "issue",
        trigger_source_number: 42
      },
      triggeredByUser: {
        id: "user-1",
        username: "alice"
      },
      requestOrigin: "http://localhost:8787"
    });

    const logs = completeRun.mock.calls[0]?.[2].logs ?? "";
    expect(logs).not.toContain("gts_11111111111111111111111111111111");
    expect(logs).not.toContain("gts_22222222222222222222222222222222");
    expect(logs).not.toContain("gts_33333333333333333333333333333333");
    expect(logs).toContain("issue reply token: [REDACTED]");
    expect(logs).toContain('[attempted] codex exec "reply with [REDACTED] and open pr with [REDACTED]"');
  });

  it("redacts git credentials from runner error logs", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunToRunning").mockResolvedValue(2);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    const completeRun = vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });

    vi.spyOn(AuthService.prototype, "createAccessToken").mockResolvedValue({
      tokenId: "tok-run",
      token: "gts_44444444444444444444444444444444"
    });
    vi.spyOn(AuthService.prototype, "revokeAccessToken").mockResolvedValue(true);

    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        gitToken?: string;
      };

      return new Response(
        JSON.stringify({
          exitCode: 128,
          stderr: `git clone failed: https://alice:${payload.gitToken}@example.com/demo.git\nAuthorization: Bearer ${payload.gitToken}`
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });
    const stopFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await executeActionRun({
      env: {
        DB: {} as D1Database,
        JWT_SECRET: "test-secret",
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              url.endsWith("/stop") ? stopFetch(url, init) : runnerFetch(url, init)
          })
        } as unknown as DurableObjectNamespace
      },
      repository: {
        id: "repo-1",
        owner_id: "owner-1",
        owner_username: "alice",
        name: "demo",
        description: "demo repo",
        is_private: 1,
        created_at: 1
      },
      run: {
        id: "run-4",
        run_number: 4,
        repository_id: "repo-1",
        agent_type: "codex",
        instance_type: "lite",
        prompt: "clone and inspect the repository",
        trigger_ref: "refs/heads/main",
        trigger_sha: "abc123",
        trigger_source_type: null,
        trigger_source_number: null
      },
      triggeredByUser: {
        id: "user-1",
        username: "alice"
      },
      requestOrigin: "http://localhost:8787"
    });

    const logs = completeRun.mock.calls[0]?.[2].logs ?? "";
    expect(logs).not.toContain("gts_44444444444444444444444444444444");
    expect(logs).toContain("https://alice:[REDACTED]@example.com/demo.git");
    expect(logs).toContain("Bearer [REDACTED]");
  });
});
