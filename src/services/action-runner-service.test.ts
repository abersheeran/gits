import { afterEach, describe, expect, it, vi } from "vitest";
import { executeActionRun } from "./action-runner-service";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "./action-runner-prompt-tokens";
import { ActionsService } from "./actions-service";
import {
  ACTIONS_SYSTEM_EMAIL,
  ACTIONS_SYSTEM_USERNAME,
  AuthService
} from "./auth-service";

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

  it("delegates token lifecycle to the container and passes actions identity hints", async () => {
    vi.spyOn(ActionsService.prototype, "claimQueuedRun").mockResolvedValue(1);
    vi.spyOn(ActionsService.prototype, "updateRunToRunning").mockResolvedValue(2);
    vi.spyOn(ActionsService.prototype, "updateRunningRunLogs").mockResolvedValue(true);
    vi.spyOn(ActionsService.prototype, "completeRun").mockResolvedValue();
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      codexConfigFileContent: "",
      claudeCodeConfigFileContent: "",
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });

    const createAccessToken = vi.spyOn(AuthService.prototype, "createAccessToken");
    const revokeAccessToken = vi.spyOn(AuthService.prototype, "revokeAccessToken");

    const runnerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        prompt: string;
        runNumber?: number;
        triggeredByUserId?: string;
        triggeredByUsername?: string;
        enableIssueReplyToken?: boolean;
        enablePrCreateToken?: boolean;
        gitCommitName?: string;
        gitCommitEmail?: string;
        env?: Record<string, string>;
      };

      expect(payload.prompt).toContain(ISSUE_REPLY_TOKEN_PLACEHOLDER);
      expect(payload.prompt).toContain(ISSUE_PR_CREATE_TOKEN_PLACEHOLDER);
      expect(payload.runNumber).toBe(3);
      expect(payload.triggeredByUserId).toBe("user-1");
      expect(payload.triggeredByUsername).toBe("alice");
      expect(payload.enableIssueReplyToken).toBe(true);
      expect(payload.enablePrCreateToken).toBe(true);
      expect(payload.gitCommitName).toBe(ACTIONS_SYSTEM_USERNAME);
      expect(payload.gitCommitEmail).toBe(ACTIONS_SYSTEM_EMAIL);
      expect(payload.env).toMatchObject({
        GITS_ACTION_RUN_ID: "run-3",
        GITS_ACTION_RUN_NUMBER: "3",
        GITS_REPOSITORY: "alice/demo",
        GITS_TRIGGER_ISSUE_NUMBER: "42"
      });
      expect(payload.env?.GITS_ISSUE_REPLY_TOKEN).toBeUndefined();
      expect(payload.env?.GITS_PR_CREATE_TOKEN).toBeUndefined();

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

    expect(createAccessToken).not.toHaveBeenCalled();
    expect(revokeAccessToken).not.toHaveBeenCalled();
    expect(runnerFetch).toHaveBeenCalledTimes(1);
    expect(stopFetch).toHaveBeenCalledTimes(1);
  });
});
