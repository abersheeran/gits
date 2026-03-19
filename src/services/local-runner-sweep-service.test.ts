import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionService } from "./agent-session-service";
import { sweepStaleLocalRunnerSessions } from "./local-runner-sweep-service";
import { createMockD1Database } from "../test-utils/mock-d1";

describe("sweepStaleLocalRunnerSessions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails stale running local attempts", async () => {
    const completeAttempt = vi
      .spyOn(AgentSessionService.prototype, "completeAttempt")
      .mockResolvedValue(true);
    const syncSessionForAttempt = vi
      .spyOn(AgentSessionService.prototype, "syncSessionForAttempt")
      .mockResolvedValue();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const db = createMockD1Database([
      {
        when: "FROM agent_session_attempts a",
        all: () => [
          {
            id: "attempt-1",
            session_id: "session-1",
            repository_id: "repo-1"
          }
        ]
      }
    ]);

    await sweepStaleLocalRunnerSessions({
      DB: db,
      GIT_BUCKET: {} as R2Bucket,
      ACTION_LOGS_BUCKET: {} as R2Bucket,
      REPOSITORY_OBJECTS: {} as DurableObjectNamespace
    });

    expect(completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-1",
        attemptId: "attempt-1",
        status: "failed",
        failureReason: "heartbeat_timeout",
        failureStage: "runtime"
      })
    );
    expect(syncSessionForAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo-1",
        sessionId: "session-1",
        sessionStatus: "failed",
        activeAttemptId: null,
        latestAttemptId: "attempt-1",
        containerInstance: null,
        failureReason: "heartbeat_timeout",
        failureStage: "runtime"
      })
    );
    expect(consoleLog).toHaveBeenCalledWith("swept stale local runner session", {
      sessionId: "session-1",
      attemptId: "attempt-1"
    });
  });
});
