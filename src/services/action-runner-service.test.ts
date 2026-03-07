import { afterEach, describe, expect, it, vi } from "vitest";
import { executeActionRun } from "./action-runner-service";
import { ActionsService } from "./actions-service";

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
});
