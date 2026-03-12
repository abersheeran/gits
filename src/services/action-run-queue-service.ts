import type { AgentSessionQueueMessage, AppBindings } from "../types";
import { executeActionRun } from "./action-runner-service";
import { AuthService } from "./auth-service";
import { AgentSessionService } from "./agent-session-service";
import { RepositoryService } from "./repository-service";

function isActionRunQueueMessage(value: unknown): value is AgentSessionQueueMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.repositoryId === "string" &&
    payload.repositoryId.length > 0 &&
    typeof payload.sessionId === "string" &&
    payload.sessionId.length > 0 &&
    typeof payload.attemptId === "string" &&
    payload.attemptId.length > 0 &&
    typeof payload.requestOrigin === "string" &&
    payload.requestOrigin.length > 0
  );
}

export async function enqueueActionRunExecution(
  env: Pick<AppBindings, "ACTIONS_QUEUE">,
  message: AgentSessionQueueMessage
): Promise<boolean> {
  if (!env.ACTIONS_QUEUE) {
    return false;
  }
  await env.ACTIONS_QUEUE.send(message);
  return true;
}

export async function consumeActionRunQueueMessage(input: {
  env: Pick<
    AppBindings,
    | "DB"
    | "GIT_BUCKET"
    | "REPOSITORY_OBJECTS"
    | "JWT_SECRET"
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
  >;
  message: AgentSessionQueueMessage;
}): Promise<void> {
  const repositoryService = new RepositoryService(input.env.DB);
  const repository = await repositoryService.findRepositoryById(input.message.repositoryId);
  if (!repository) {
    return;
  }

  const agentSessionService = new AgentSessionService(input.env.DB);
  const session = await agentSessionService.findSessionById(repository.id, input.message.sessionId);
  if (!session) {
    return;
  }
  const attempt = await agentSessionService.findAttemptById(repository.id, input.message.attemptId);
  if (!attempt || attempt.session_id !== session.id || attempt.status !== "queued") {
    return;
  }

  const authService = new AuthService(input.env.DB, input.env.JWT_SECRET);
  const triggeredByUser =
    session.created_by !== null ? await authService.getUserById(session.created_by) : null;

  await executeActionRun({
    env: input.env,
    repository,
    session,
    attempt,
    ...(triggeredByUser ? { triggeredByUser } : {}),
    requestOrigin: input.message.requestOrigin
  });
}

export async function consumeActionRunQueueBatch(input: {
  batch: MessageBatch<unknown>;
  env: Pick<
    AppBindings,
    | "DB"
    | "GIT_BUCKET"
    | "REPOSITORY_OBJECTS"
    | "JWT_SECRET"
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
  >;
}): Promise<void> {
  for (const queueMessage of input.batch.messages) {
    const body = queueMessage.body;
    if (!isActionRunQueueMessage(body)) {
      queueMessage.ack();
      continue;
    }

    try {
      await consumeActionRunQueueMessage({
        env: input.env,
        message: body
      });
      queueMessage.ack();
    } catch (error) {
      console.error("consume agent session queue message failed", error);
      queueMessage.retry();
    }
  }
}
