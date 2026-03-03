import type { ActionRunQueueMessage, AppBindings } from "../types";
import { executeActionRun } from "./action-runner-service";
import { ActionsService } from "./actions-service";
import { AuthService } from "./auth-service";
import { RepositoryService } from "./repository-service";

function isActionRunQueueMessage(value: unknown): value is ActionRunQueueMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.repositoryId === "string" &&
    payload.repositoryId.length > 0 &&
    typeof payload.runId === "string" &&
    payload.runId.length > 0 &&
    typeof payload.requestOrigin === "string" &&
    payload.requestOrigin.length > 0
  );
}

export async function enqueueActionRunExecution(
  env: Pick<AppBindings, "ACTIONS_QUEUE">,
  message: ActionRunQueueMessage
): Promise<boolean> {
  if (!env.ACTIONS_QUEUE) {
    return false;
  }
  await env.ACTIONS_QUEUE.send(message);
  return true;
}

export async function consumeActionRunQueueMessage(input: {
  env: Pick<AppBindings, "DB" | "JWT_SECRET" | "ACTIONS_RUNNER">;
  message: ActionRunQueueMessage;
}): Promise<void> {
  const repositoryService = new RepositoryService(input.env.DB);
  const repository = await repositoryService.findRepositoryById(input.message.repositoryId);
  if (!repository) {
    return;
  }

  const actionsService = new ActionsService(input.env.DB);
  const run = await actionsService.findRunById(repository.id, input.message.runId);
  if (!run || run.status !== "queued") {
    return;
  }

  const authService = new AuthService(input.env.DB, input.env.JWT_SECRET);
  const triggeredByUser =
    run.triggered_by !== null ? await authService.getUserById(run.triggered_by) : null;

  await executeActionRun({
    env: input.env,
    repository,
    run: {
      id: run.id,
      run_number: run.run_number,
      repository_id: run.repository_id,
      agent_type: run.agent_type,
      prompt: run.prompt,
      trigger_ref: run.trigger_ref,
      trigger_sha: run.trigger_sha
    },
    ...(triggeredByUser ? { triggeredByUser } : {}),
    requestOrigin: input.message.requestOrigin
  });
}

export async function consumeActionRunQueueBatch(input: {
  batch: MessageBatch<unknown>;
  env: Pick<AppBindings, "DB" | "JWT_SECRET" | "ACTIONS_RUNNER">;
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
      console.error("consume action run queue message failed", error);
      queueMessage.retry();
    }
  }
}
