import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionService } from "../../services/agent-session-service";
import { createApp, createBaseEnv } from "./test-helpers";
import { createMockD1Database } from "../../test-utils/mock-d1";

describe("API action container callback routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renews container keepalive on heartbeat only after callback secret verification succeeds", async () => {
    const appendAttemptEvents = vi
      .spyOn(AgentSessionService.prototype, "appendAttemptEvents")
      .mockResolvedValue();
    const runnerFetch = vi.fn(async (url: string) => {
      if (url === "https://actions-container.internal/verify-callback-secret") {
        return new Response(JSON.stringify({ valid: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (url === "https://actions-container.internal/keepalive") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected runner fetch: ${url}`);
    });

    const response = await createApp().fetch(
      new Request("http://localhost:8787/api/internal/container-callback", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "heartbeat",
          callbackSecret: "secret-1",
          repositoryId: "repo-1",
          sessionId: "session-1",
          attemptId: "attempt-1",
          instanceType: "lite",
          containerInstance: "agent-session-session-1-attempt-1",
          sessionNumber: 1,
          attemptNumber: 1,
          stdout: "Analyzing repository"
        })
      }),
      {
        ...createBaseEnv(createMockD1Database([])),
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: runnerFetch
          })
        } as unknown as DurableObjectNamespace
      }
    );

    expect(response.status).toBe(200);
    expect(appendAttemptEvents).not.toHaveBeenCalled();
    expect(runnerFetch).toHaveBeenNthCalledWith(
      1,
      "https://actions-container.internal/verify-callback-secret",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(runnerFetch).toHaveBeenNthCalledWith(
      2,
      "https://actions-container.internal/keepalive",
      {
        method: "POST"
      }
    );
  });

  it("skips heartbeat side effects when callback secret verification fails", async () => {
    const appendAttemptEvents = vi
      .spyOn(AgentSessionService.prototype, "appendAttemptEvents")
      .mockResolvedValue();
    const runnerFetch = vi.fn(async (url: string) => {
      if (url === "https://actions-container.internal/verify-callback-secret") {
        return new Response(JSON.stringify({ valid: false }), {
          status: 403,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected runner fetch: ${url}`);
    });

    const response = await createApp().fetch(
      new Request("http://localhost:8787/api/internal/container-callback", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "heartbeat",
          callbackSecret: "secret-1",
          repositoryId: "repo-1",
          sessionId: "session-1",
          attemptId: "attempt-1",
          instanceType: "lite",
          containerInstance: "agent-session-session-1-attempt-1",
          sessionNumber: 1,
          attemptNumber: 1,
          stdout: "Analyzing repository"
        })
      }),
      {
        ...createBaseEnv(createMockD1Database([])),
        ACTIONS_RUNNER: {
          getByName: () => ({
            fetch: runnerFetch
          })
        } as unknown as DurableObjectNamespace
      }
    );

    expect(response.status).toBe(200);
    expect(appendAttemptEvents).not.toHaveBeenCalled();
    expect(runnerFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects callback payloads with invalid types", async () => {
    const response = await createApp().fetch(
      new Request("http://localhost:8787/api/internal/container-callback", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "unknown",
          callbackSecret: "secret-1",
          repositoryId: "repo-1",
          sessionId: "session-1",
          attemptId: "attempt-1",
          instanceType: "lite",
          containerInstance: "agent-session-session-1-attempt-1",
          sessionNumber: 1,
          attemptNumber: 1
        })
      }),
      createBaseEnv(createMockD1Database([]))
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Field 'type' must be one of: heartbeat, completion");
  });
});
