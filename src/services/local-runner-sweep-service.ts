import type { AppBindings } from "../types";
import { AgentSessionService } from "./agent-session-service";

const LOCAL_RUNNER_HEARTBEAT_TIMEOUT_MS = 90_000;

type StaleAttemptRow = {
  id: string;
  session_id: string;
  repository_id: string;
};

export async function sweepStaleLocalRunnerSessions(
  env: Pick<AppBindings, "DB" | "GIT_BUCKET" | "ACTION_LOGS_BUCKET" | "REPOSITORY_OBJECTS">
): Promise<void> {
  const cutoff = Date.now() - LOCAL_RUNNER_HEARTBEAT_TIMEOUT_MS;
  const staleAttempts = await env.DB
    .prepare(
      `SELECT a.id, a.session_id, a.repository_id
       FROM agent_session_attempts a
       WHERE a.runner_type = 'local'
         AND a.status = 'running'
         AND a.updated_at < ?
       LIMIT 10`
    )
    .bind(cutoff)
    .all<StaleAttemptRow>();

  if (!staleAttempts.results.length) {
    return;
  }

  const agentSessionService = new AgentSessionService(env.DB);
  for (const attempt of staleAttempts.results) {
    const completedAt = Date.now();
    const completed = await agentSessionService.completeAttempt({
      repositoryId: attempt.repository_id,
      sessionId: attempt.session_id,
      attemptId: attempt.id,
      status: "failed",
      exitCode: null,
      failureReason: "heartbeat_timeout",
      failureStage: "runtime",
      completedAt
    });
    if (!completed) {
      console.log("sweep skipped already-completed attempt", { attemptId: attempt.id });
      continue;
    }
    await agentSessionService.syncSessionForAttempt({
      repositoryId: attempt.repository_id,
      sessionId: attempt.session_id,
      sessionStatus: "failed",
      activeAttemptId: null,
      latestAttemptId: attempt.id,
      exitCode: null,
      containerInstance: null,
      failureReason: "heartbeat_timeout",
      failureStage: "runtime",
      completedAt,
      updatedAt: completedAt
    });
    console.log("swept stale local runner session", {
      sessionId: attempt.session_id,
      attemptId: attempt.id
    });
  }
}
