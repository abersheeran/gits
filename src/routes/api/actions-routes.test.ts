import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ActionLogStorageService
} from "../../services/action-log-storage-service";

import {
  AuthService
} from "../../services/auth-service";

import {
  createMockD1Database
} from "../../test-utils/mock-d1";

import {
  MockR2Bucket
} from "../../test-utils/mock-r2";

import {
  buildAgentSessionRow,
  buildRepositoryRow,
  createApp,
  createBaseEnv
} from "./test-helpers";

describe("API actions and session routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns masked global actions config for authenticated users", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const db = createMockD1Database([
      {
        when: "FROM global_settings",
        all: () => [
          { key: "actions.codex.config_file_content", value: "model = \"gpt-5-codex\"", updated_at: 1 },
          {
            key: "actions.claude_code.config_file_content",
            value: "{\n  \"permissions\": \"bypass\"\n}",
            updated_at: 1
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/settings/actions", {
        method: "GET",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config: {
        codexConfigFileContent: string;
        claudeCodeConfigFileContent: string;
      };
    };
    expect(body.config.codexConfigFileContent).toContain("gpt-5-codex");
    expect(body.config.claudeCodeConfigFileContent).toContain("\"permissions\": \"bypass\"");
  });

  it("updates actions config file contents via settings API", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "owner-1",
      username: "alice"
    });
    const settings = new Map<string, string>();
    const db = createMockD1Database([
      {
        when: "INSERT INTO global_settings",
        run: (params) => {
          settings.set(String(params[0]), String(params[1]));
          return { success: true };
        }
      },
      {
        when: "DELETE FROM global_settings",
        run: (params) => {
          settings.delete(String(params[0]));
          return { success: true };
        }
      },
      {
        when: "FROM global_settings",
        all: () =>
          Array.from(settings.entries()).map(([key, value]) => ({
            key,
            value,
            updated_at: 1
          }))
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/settings/actions", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          codexConfigFileContent: "model = \"gpt-5-codex\"\napproval_policy = \"never\"",
          claudeCodeConfigFileContent: "{\n  \"permissions\": \"bypass\"\n}"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config: { codexConfigFileContent: string; claudeCodeConfigFileContent: string };
    };
    expect(body.config.codexConfigFileContent).toContain("approval_policy");
    expect(body.config.claudeCodeConfigFileContent).toContain("\"permissions\": \"bypass\"");
    expect(settings.get("actions.codex.config_file_content")).toContain("approval_policy");
    expect(settings.get("actions.claude_code.config_file_content")).toContain("\"permissions\"");
  });

  it("returns repository actions config with global fallback for collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM repository_actions_configs",
        first: () => null
      },
      {
        when: "FROM global_settings",
        all: () => [
          {
            key: "actions.codex.config_file_content",
            value: "model = \"gpt-5-codex\"",
            updated_at: 10
          },
          {
            key: "actions.claude_code.config_file_content",
            value: "{\n  \"permissions\": \"bypass\"\n}",
            updated_at: 12
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/config", {
        method: "GET",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config: {
        instanceType: string;
        codexConfigFileContent: string;
        claudeCodeConfigFileContent: string;
        inheritsGlobalCodexConfig: boolean;
        inheritsGlobalClaudeCodeConfig: boolean;
        updated_at: number | null;
      };
    };
    expect(body.config.instanceType).toBe("lite");
    expect(body.config.codexConfigFileContent).toContain("gpt-5-codex");
    expect(body.config.claudeCodeConfigFileContent).toContain("\"permissions\": \"bypass\"");
    expect(body.config.inheritsGlobalCodexConfig).toBe(true);
    expect(body.config.inheritsGlobalClaudeCodeConfig).toBe(true);
    expect(body.config.updated_at).toBe(12);
  });

  it("updates repository actions config via repository API", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });

    let repositoryConfigRow:
      | {
          repository_id: string;
          instance_type: string | null;
          codex_config_file_content: string | null;
          claude_code_config_file_content: string | null;
          updated_at: number;
        }
      | null = null;

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "FROM repository_actions_configs",
        first: () => repositoryConfigRow
      },
      {
        when: "INSERT INTO repository_actions_configs",
        run: (params) => {
          repositoryConfigRow = {
            repository_id: String(params[0]),
            instance_type: params[1] === null ? null : String(params[1]),
            codex_config_file_content:
              params[2] === null ? null : String(params[2]),
            claude_code_config_file_content:
              params[3] === null ? null : String(params[3]),
            updated_at: Number(params[4])
          };
          return { success: true };
        }
      },
      {
        when: "DELETE FROM repository_actions_configs",
        run: () => {
          repositoryConfigRow = null;
          return { success: true };
        }
      },
      {
        when: "FROM global_settings",
        all: () => []
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/config", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          instanceType: "standard-2",
          codexConfigFileContent: "model = \"gpt-5-codex\"\napproval_policy = \"never\"",
          claudeCodeConfigFileContent: "{\n  \"permissions\": \"bypass\"\n}"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config: {
        instanceType: string;
        codexConfigFileContent: string;
        claudeCodeConfigFileContent: string;
        inheritsGlobalCodexConfig: boolean;
        inheritsGlobalClaudeCodeConfig: boolean;
      };
    };
    expect(body.config.instanceType).toBe("standard-2");
    expect(body.config.codexConfigFileContent).toContain("approval_policy");
    expect(body.config.claudeCodeConfigFileContent).toContain("\"permissions\": \"bypass\"");
    expect(body.config.inheritsGlobalCodexConfig).toBe(false);
    expect(body.config.inheritsGlobalClaudeCodeConfig).toBe(false);
    expect(repositoryConfigRow?.instance_type).toBe("standard-2");
    expect(repositoryConfigRow?.codex_config_file_content).toContain("approval_policy");
    expect(repositoryConfigRow?.claude_code_config_file_content).toContain("\"permissions\"");
  });

  it("returns persisted running action runs without probing container state", async () => {
    const now = Date.now();
    const fetchContainerState = vi.fn();

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM agent_sessions s",
        all: () => [
          buildAgentSessionRow({
            id: "session-1",
            session_number: 1,
            source_type: "pull_request",
            source_number: 1,
            workflow_name: "CI",
            trigger_ref: "refs/heads/feature",
            trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            created_by: "owner-1",
            created_by_username: "alice",
            status: "running",
            prompt: "run tests",
            container_instance: "agent-session-session-1",
            created_at: now - 60_000,
            claimed_at: now - 50_000,
            started_at: now - 45_000,
            completed_at: null,
            updated_at: now - 30_000
          })
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions"),
      {
        ...createBaseEnv(db),
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: fetchContainerState
          })
        } as unknown as DurableObjectNamespace
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: Array<{
        id: string;
        status: string;
        exit_code: number | null;
        logs: string;
      }>;
    };
    expect(body.sessions[0]?.id).toBe("session-1");
    expect(body.sessions[0]?.status).toBe("running");
    expect(body.sessions[0]?.exit_code).toBeNull();
    expect(fetchContainerState).not.toHaveBeenCalled();
  });

  it("streams recent run updates without probing container state", async () => {
    const now = Date.now();
    let readCount = 0;
    const fetchContainerState = vi.fn();

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () => {
          readCount += 1;
          if (readCount === 1) {
            return buildAgentSessionRow({
              id: "session-queued-starting",
              session_number: 3,
              source_type: "pull_request",
              source_number: 3,
              workflow_name: "CI",
              trigger_ref: "refs/heads/feature",
              trigger_sha: "cccccccccccccccccccccccccccccccccccccccc",
              created_by: "owner-1",
              created_by_username: "alice",
              status: "running",
              prompt: "run tests",
              container_instance: "agent-session-session-queued-starting",
              created_at: now - 2_000,
              started_at: now - 500,
              completed_at: null,
              updated_at: now - 500
            });
          }
          return buildAgentSessionRow({
            id: "session-queued-starting",
            session_number: 3,
            source_type: "pull_request",
            source_number: 3,
            workflow_name: "CI",
            trigger_ref: "refs/heads/feature",
            trigger_sha: "cccccccccccccccccccccccccccccccccccccccc",
            created_by: "owner-1",
            created_by_username: "alice",
            status: "success",
            prompt: "run tests",
            logs: "line 1",
            exit_code: 0,
            container_instance: "agent-session-session-queued-starting",
            created_at: now - 2_000,
            started_at: now - 500,
            completed_at: now + 600,
            updated_at: now + 600
          });
        }
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-queued-starting/logs/stream"),
      {
        ...createBaseEnv(db),
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: fetchContainerState
          })
        } as unknown as DurableObjectNamespace
      }
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    const events = body.trim().split("\n\n");
    expect(events.some((event) => event.includes("event: snapshot"))).toBe(true);
    expect(events.some((event) => event.includes("\"status\":\"running\""))).toBe(true);
    expect(events.some((event) => event.includes("event: done"))).toBe(true);
    expect(events.some((event) => event.includes("\"status\":\"success\""))).toBe(true);
    expect(body).not.toContain("status reconciliation");
    expect(fetchContainerState).not.toHaveBeenCalled();
  });

  it("streams action run logs over SSE", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "run-1",
            session_number: 1,
            source_type: "pull_request",
            source_number: 1,
            workflow_name: "CI",
            trigger_ref: "refs/heads/feature",
            trigger_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            created_by: "owner-1",
            created_by_username: "alice",
            status: "success",
            prompt: "run tests",
            logs: "line 1\nline 2",
            exit_code: 0,
            container_instance: "agent-session-run-1",
            created_at: now - 1_000,
            started_at: now - 900,
            completed_at: now - 100,
            updated_at: now - 100
          })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/run-1/logs/stream"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    const events = body.trim().split("\n\n");
    expect(events[0]).toBe("retry: 1000");
    expect(events[1]).toContain("event: snapshot");
    expect(events[1]).toContain("data: {");
    expect(events[1]).toContain("\"run\":{\"id\":\"run-1\"");
    expect(events[1]).toContain("\"logs\":\"line 1\\nline 2\"");
    expect(events[2]).toContain("event: done");
    expect(events[2]).toContain("data: {");
    expect(events[2]).toContain("\"status\":\"success\"");
  });

  it("streams append and status updates for running action runs", async () => {
    const now = Date.now();
    let readCount = 0;
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () => {
          readCount += 1;
          if (readCount === 1) {
            return buildAgentSessionRow({
              id: "run-2",
              session_number: 2,
              source_type: "pull_request",
              source_number: 2,
              workflow_name: "CI",
              trigger_ref: "refs/heads/feature",
              trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              created_by: "owner-1",
              created_by_username: "alice",
              status: "running",
              prompt: "run tests",
              logs: "",
              created_at: now - 2_000,
              started_at: now - 1_900,
              completed_at: null,
              updated_at: now - 1_900
            });
          }
          if (readCount === 2) {
            return buildAgentSessionRow({
              id: "run-2",
              session_number: 2,
              source_type: "pull_request",
              source_number: 2,
              workflow_name: "CI",
              trigger_ref: "refs/heads/feature",
              trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              created_by: "owner-1",
              created_by_username: "alice",
              status: "running",
              prompt: "run tests",
              logs: "line 1",
              created_at: now - 2_000,
              started_at: now - 1_900,
              completed_at: null,
              updated_at: now - 900
            });
          }
          return buildAgentSessionRow({
            id: "run-2",
            session_number: 2,
            source_type: "pull_request",
            source_number: 2,
            workflow_name: "CI",
            trigger_ref: "refs/heads/feature",
            trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            created_by: "owner-1",
            created_by_username: "alice",
            status: "success",
            prompt: "run tests",
            logs: "line 1",
            exit_code: 0,
            created_at: now - 2_000,
            started_at: now - 1_900,
            completed_at: now - 100,
            updated_at: now - 100
          });
        }
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/run-2/logs/stream"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    const events = body.trim().split("\n\n");
    expect(events.some((event) => event.includes("event: snapshot"))).toBe(true);
    expect(events.some((event) => event.includes("event: append"))).toBe(true);
    expect(events.some((event) => event.includes("\"chunk\":\"line 1\""))).toBe(true);
    expect(events.some((event) => event.includes("event: status"))).toBe(true);
    expect(events.some((event) => event.includes("event: done"))).toBe(true);
    expect(readCount).toBeGreaterThanOrEqual(3);
  });

  it("returns full action run logs from object storage when available", async () => {
    const bucket = new MockR2Bucket();
    const logStorage = new ActionLogStorageService(bucket as unknown as R2Bucket);
    await logStorage.writeRunLogs("repo-1", "run-full-logs", "line 1\nline 2\nline 3");
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "run-full-logs",
            session_number: 4,
            status: "success",
            logs: "excerpt"
          })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/run-full-logs/logs"),
      {
        ...createBaseEnv(db),
        GIT_BUCKET: bucket as unknown as R2Bucket
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { logs: string };
    expect(body.logs).toBe("line 1\nline 2\nline 3");
  });

  it("rejects rerunning action runs for non-collaborators", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-3",
      username: "charlie"
    });

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "FROM repository_collaborators",
        first: () => null
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/run-1/rerun", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(403);
  });

  it("allows collaborators to rerun action runs", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue("session-2");
    const enqueueRun = vi.fn(async () => undefined);
    const now = Date.now();
    const sourceRun = buildAgentSessionRow({
      id: "run-1",
      session_number: 1,
      source_type: "pull_request",
      source_number: 1,
      status: "failed",
      prompt: "请执行测试并修复失败。",
      logs: "failed logs",
      exit_code: 1,
      created_at: now - 10_000,
      started_at: now - 9_000,
      completed_at: now - 8_000,
      updated_at: now - 8_000
    });

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: (params) => {
          const runId = String(params[1]);
          if (runId === "run-1") {
            return sourceRun;
          }
          return {
            ...sourceRun,
            id: runId,
            session_number: 2,
            run_number: 2,
            status: "queued",
            logs: "",
            exit_code: null,
            container_instance: null,
            parent_session_id: "run-1",
            created_at: now,
            started_at: null,
            completed_at: null,
            updated_at: now
          };
        }
      },
      {
        when: "RETURNING session_number_seq AS session_number",
        first: () => ({ session_number: 2 })
      },
      {
        when: "INSERT INTO agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-2",
            session_number: 2,
            source_type: "pull_request",
            source_number: 1,
            origin: "rerun"
          })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/run-1/rerun", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      {
        ...createBaseEnv(db),
        ACTIONS_QUEUE: {
          send: enqueueRun
        } as unknown as Queue<unknown>
      }
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as { session: { id: string; session_number: number; status: string } };
    expect(body.session.id).toBe("session-2");
    expect(body.session.session_number).toBe(2);
    expect(body.session.status).toBe("queued");
    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });

  it("does not block reruns for delegated agent sessions", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue("session-pending");
    const enqueueRun = vi.fn(async () => undefined);
    const now = Date.now();
    const sourceSession = buildAgentSessionRow({
      id: "run-1",
      session_number: 1,
      status: "failed",
      logs: "failed logs",
      exit_code: 1,
      created_at: now - 10_000,
      started_at: now - 9_000,
      completed_at: now - 8_000,
      updated_at: now - 8_000
    });

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: (params) => {
          const sessionId = String(params[1]);
          if (sessionId === "run-1") {
            return sourceSession;
          }
          return buildAgentSessionRow({
            id: sessionId,
            session_number: 2,
            source_type: "pull_request",
            source_number: 1,
            parent_session_id: "run-1",
            created_at: now,
            updated_at: now
          });
        }
      },
      {
        when: "RETURNING session_number_seq AS session_number",
        first: () => ({ session_number: 2 })
      },
      {
        when: "INSERT INTO agent_sessions",
        run: () => ({ success: true })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-pending",
            session_number: 2,
            parent_session_id: "run-1",
            created_at: now,
            updated_at: now
          })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/run-1/rerun", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      {
        ...createBaseEnv(db),
        ACTIONS_QUEUE: {
          send: enqueueRun
        } as unknown as Queue<unknown>
      }
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      session: { id: string; status: string; parent_session_id: string | null };
    };
    expect(body.session.id).toBe("session-pending");
    expect(body.session.status).toBe("queued");
    expect(body.session.parent_session_id).toBe("run-1");
    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });

  it("returns agent session detail with linked run and source context", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-detail",
            source_type: "issue",
            source_number: 42,
            origin: "issue_resume",
            status: "running",
            workflow_name: "Issue Bot",
            created_at: now - 20_000,
            updated_at: now - 10_000
          })
      },
      {
        when: "FROM issues i",
        first: () => ({
          id: "issue-42",
          repository_id: "repo-1",
          number: 42,
          author_id: "owner-1",
          author_username: "alice",
          title: "Need login fix",
          body: "body",
          state: "open",
          created_at: now - 40_000,
          updated_at: now - 30_000,
          closed_at: null
        })
      },
      {
        when: "FROM agent_session_artifacts",
        all: () => [
          {
            id: "artifact-1",
            session_id: "session-detail",
            repository_id: "repo-1",
            kind: "stdout",
            title: "Runner stdout",
            media_type: "text/plain",
            size_bytes: 14,
            content_text: "stdout payload",
            created_at: now - 9_000,
            updated_at: now - 9_000
          }
        ]
      },
      {
        when: "FROM agent_session_usage_records",
        all: () => [
          {
            id: 1,
            session_id: "session-detail",
            repository_id: "repo-1",
            kind: "duration_ms",
            value: 250,
            unit: "ms",
            detail: "Container execution duration",
            payload_json: "{\"runId\":\"run-detail\"}",
            created_at: now - 9_000,
            updated_at: now - 9_000
          }
        ]
      },
      {
        when: "FROM agent_session_interventions",
        all: () => [
          {
            id: 2,
            session_id: "session-detail",
            repository_id: "repo-1",
            kind: "mcp_setup_warning",
            title: "MCP setup warning",
            detail: "platform MCP missing",
            created_by: null,
            created_by_username: null,
            payload_json: "{\"runId\":\"run-detail\"}",
            created_at: now - 8_000
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-detail"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: { id: string; source_type: string; source_number: number };
      sourceContext: { type: string; number: number | null; title: string | null; url: string | null };
      artifacts: Array<{ kind: string; title: string }>;
      usageRecords: Array<{ kind: string; value: number }>;
      interventions: Array<{ kind: string; title: string }>;
    };
    expect(body.session.id).toBe("session-detail");
    expect(body.session.source_type).toBe("issue");
    expect(body.session.source_number).toBe(42);
    expect(body.sourceContext.type).toBe("issue");
    expect(body.sourceContext.number).toBe(42);
    expect(body.sourceContext.title).toBe("Need login fix");
    expect(body.sourceContext.url).toBe("/repo/alice/demo/issues/42");
    expect(body.artifacts[0]?.kind).toBe("stdout");
    expect(body.usageRecords[0]?.kind).toBe("duration_ms");
    expect(body.interventions[0]?.kind).toBe("mcp_setup_warning");
  });

  it("returns full agent session artifact content from object storage when available", async () => {
    const bucket = new MockR2Bucket();
    const logStorage = new ActionLogStorageService(bucket as unknown as R2Bucket);
    await logStorage.writeSessionArtifactLogs(
      "repo-1",
      "session-artifact",
      "stdout",
      "full stdout output"
    );
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE repository_id = ? AND session_id = ? AND id = ?",
        first: () => ({
          id: "artifact-stdout",
          session_id: "session-artifact",
          repository_id: "repo-1",
          kind: "stdout",
          title: "Runner stdout",
          media_type: "text/plain",
          size_bytes: 18,
          content_text: "excerpt",
          created_at: 10,
          updated_at: 11
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request(
        "http://localhost/api/repos/alice/demo/agent-sessions/session-artifact/artifacts/artifact-stdout/content"
      ),
      {
        ...createBaseEnv(db),
        GIT_BUCKET: bucket as unknown as R2Bucket
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      artifact: { id: string; has_full_content: boolean; content_url: string | null };
      content: string;
    };
    expect(body.artifact.id).toBe("artifact-stdout");
    expect(body.artifact.has_full_content).toBe(true);
    expect(body.artifact.content_url).toBe(
      "/api/repos/alice/demo/agent-sessions/session-artifact/artifacts/artifact-stdout/content"
    );
    expect(body.content).toBe("full stdout output");
  });

  it("builds agent session timeline events from linked run logs", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-timeline",
            source_type: "issue",
            source_number: 7,
            origin: "issue_assign",
            status: "failed",
            logs: `run_id: run-timeline\nrun_number: 9\nagent_type: codex\nprompt: debug\n\nclaimed_at: ${new Date(now - 11_000).toISOString()}\nstarted_at: ${new Date(now - 10_000).toISOString()}\n\n[attempted]\ncodex run\n\n[stdout]\nAnalyzing repository\nApplying fix\n\n[stderr]\nTests still failing\n\n[error]\nTests still failing`,
            exit_code: 1,
            container_instance: "agent-session-session-timeline",
            created_at: now - 12_000,
            claimed_at: now - 11_000,
            started_at: now - 10_000,
            completed_at: now - 1_000,
            updated_at: now - 1_000
          })
      },
      {
        when: "FROM agent_session_interventions",
        all: () => []
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-timeline/timeline"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: Array<{
        type: string;
        title: string;
        detail: string | null;
        stream: string | null;
      }>;
    };
    expect(body.events.some((event) => event.type === "session_created")).toBe(true);
    expect(body.events.some((event) => event.type === "session_queued")).toBe(true);
    expect(body.events.some((event) => event.type === "session_claimed")).toBe(true);
    expect(body.events.some((event) => event.type === "session_started")).toBe(true);
    expect(
      body.events.some(
        (event) => event.type === "log" && event.stream === "system" && event.detail === "codex run"
      )
    ).toBe(true);
    expect(
      body.events.some(
        (event) => event.type === "log" && event.stream === "error" && event.detail === "Tests still failing"
      )
    ).toBe(true);
    expect(body.events.some((event) => event.type === "log" && event.stream === "stdout")).toBe(false);
    expect(body.events.some((event) => event.type === "log" && event.stream === "stderr")).toBe(false);
    expect(
      body.events.some((event) => event.type === "session_completed" && event.title === "Session failed")
    ).toBe(true);
  });

  it("uses structured agent session steps in timeline when available", async () => {
    const now = Date.now();
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow({ is_private: 0 })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () =>
          buildAgentSessionRow({
            id: "session-structured",
            source_type: "issue",
            source_number: 5,
            origin: "issue_assign",
            status: "success",
            created_at: now - 12_000,
            started_at: now - 10_000,
            completed_at: now - 1_000,
            updated_at: now - 1_000
          })
      },
      {
        when: "FROM agent_session_steps",
        all: () => [
          {
            id: 1,
            session_id: "session-structured",
            repository_id: "repo-1",
            kind: "session_created",
            title: "Session created",
            detail: "issue #5 · issue_assign · bob",
            payload_json: "{\"status\":\"queued\"}",
            created_at: now - 12_000
          },
          {
            id: 2,
            session_id: "session-structured",
            repository_id: "repo-1",
            kind: "session_started",
            title: "Session started",
            detail: "refs/heads/agent/session-structured",
            payload_json: "{\"status\":\"running\"}",
            created_at: now - 10_000
          },
          {
            id: 3,
            session_id: "session-structured",
            repository_id: "repo-1",
            kind: "session_completed",
            title: "Session completed",
            detail: "success",
            payload_json: "{\"status\":\"success\"}",
            created_at: now - 1_000
          }
        ]
      },
      {
        when: "FROM agent_session_interventions",
        all: () => [
          {
            id: 4,
            session_id: "session-structured",
            repository_id: "repo-1",
            kind: "cancel_requested",
            title: "Cancellation requested",
            detail: "Queued session cancelled by bob.",
            created_by: "user-2",
            created_by_username: "bob",
            payload_json: "{\"status\":\"cancelled\"}",
            created_at: now - 500
          }
        ]
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-structured/timeline"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: Array<{
        id: string;
        type: string;
        title: string;
        detail: string | null;
      }>;
    };
    expect(body.events.some((event) => event.id === "step-1" && event.type === "session_created")).toBe(
      true
    );
    expect(
      body.events.some(
        (event) =>
          event.id === "step-2" &&
          event.type === "session_started" &&
          event.detail === "refs/heads/agent/session-structured"
      )
    ).toBe(true);
    expect(
      body.events.some(
        (event) => event.id === "step-3" && event.type === "session_completed" && event.title === "Session completed"
      )
    ).toBe(true);
    expect(body.events.some((event) => event.type === "log")).toBe(false);
    expect(
      body.events.some(
        (event) => event.type === "intervention" && event.title === "Cancellation requested"
      )
    ).toBe(true);
  });

  it("cancels a queued agent session before it starts running", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });
    let sessionReadCount = 0;

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "WHERE s.repository_id = ? AND s.id = ?",
        first: () => {
          sessionReadCount += 1;
          return buildAgentSessionRow({
            id: "session-cancel",
            status: sessionReadCount >= 2 ? "cancelled" : "queued",
            completed_at: sessionReadCount >= 2 ? Date.now() : null
          });
        }
      },
      {
        when: "SET status = 'cancelled', completed_at = ?, updated_at = ?",
        run: () => ({
          success: true,
          meta: {
            changes: 1
          }
        })
      },
      {
        when: "INSERT INTO agent_session_interventions",
        run: () => ({ success: true })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/agent-sessions/session-cancel/cancel", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { session: { status: string } };
    expect(body.session.status).toBe("cancelled");
  });

  it("allows collaborators to create actions workflows", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-2",
      username: "bob"
    });

    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () => buildRepositoryRow()
      },
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "read" })
      },
      {
        when: "INSERT INTO action_workflows",
        run: () => ({ success: true })
      },
      {
        when: "FROM action_workflows",
        first: () => ({
          id: "workflow-1",
          repository_id: "repo-1",
          name: "CI",
          trigger_event: "pull_request_created",
          agent_type: "codex",
          prompt: "请执行测试并修复失败。",
          push_branch_regex: null,
          push_tag_regex: null,
          enabled: 1,
          created_by: "user-2",
          created_at: Date.now(),
          updated_at: Date.now()
        })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/actions/workflows", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "CI",
          triggerEvent: "pull_request_created",
          agentType: "codex",
          prompt: "请执行测试并修复失败。"
        })
      }),
      createBaseEnv(db)
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      workflow: { name: string; trigger_event: string; agent_type: string; prompt: string };
    };
    expect(body.workflow.name).toBe("CI");
    expect(body.workflow.trigger_event).toBe("pull_request_created");
    expect(body.workflow.agent_type).toBe("codex");
    expect(body.workflow.prompt).toBe("请执行测试并修复失败。");
  });
});
