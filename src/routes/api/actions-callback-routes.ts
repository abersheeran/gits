import type {
  CallbackMeta,
  CompletionCallbackPayload,
  ContainerCallbackPayload,
  HeartbeatCallbackPayload
} from "../../services/action-container-callback-service";
import {
  handleContainerCompletion,
  handleContainerHeartbeat
} from "../../services/action-container-callback-service";
import { HTTPException } from "./deps";
import {
  assertActionContainerInstanceType,
  assertPositiveIntegerInput,
  assertString,
  parseJsonObject,
  type ApiRouter
} from "./shared";

function assertIntegerInput(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HTTPException(400, { message: `Field '${field}' must be an integer` });
  }
  return value;
}

function assertNonNegativeIntegerInput(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HTTPException(400, { message: `Field '${field}' must be a non-negative integer` });
  }
  return value;
}

function assertStringField(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string` });
  }
  return value;
}

function parseCallbackMeta(body: Record<string, unknown>): CallbackMeta {
  return {
    repositoryId: assertString(body.repositoryId, "repositoryId"),
    sessionId: assertString(body.sessionId, "sessionId"),
    attemptId: assertString(body.attemptId, "attemptId"),
    instanceType: assertActionContainerInstanceType(body.instanceType, "instanceType"),
    containerInstance: assertString(body.containerInstance, "containerInstance"),
    sessionNumber: assertPositiveIntegerInput(body.sessionNumber, "sessionNumber"),
    attemptNumber: assertPositiveIntegerInput(body.attemptNumber, "attemptNumber")
  };
}

function parseContainerCallbackPayload(body: Record<string, unknown>): ContainerCallbackPayload {
  const type = assertString(body.type, "type");
  const base = {
    ...parseCallbackMeta(body),
    callbackSecret: assertString(body.callbackSecret, "callbackSecret")
  };

  if (type === "heartbeat") {
    const payload: HeartbeatCallbackPayload = {
      type,
      ...base,
      ...(body.stdout !== undefined
        ? { stdout: assertStringField(body.stdout, "stdout") }
        : {}),
      ...(body.stderr !== undefined
        ? { stderr: assertStringField(body.stderr, "stderr") }
        : {})
    };
    return payload;
  }

  if (type === "completion") {
    const payload: CompletionCallbackPayload = {
      type,
      ...base,
      exitCode: assertIntegerInput(body.exitCode, "exitCode"),
      durationMs: assertNonNegativeIntegerInput(body.durationMs, "durationMs"),
      ...(body.stdout !== undefined
        ? { stdout: assertStringField(body.stdout, "stdout") }
        : {}),
      ...(body.stderr !== undefined
        ? { stderr: assertStringField(body.stderr, "stderr") }
        : {}),
      ...(body.error !== undefined ? { error: assertStringField(body.error, "error") } : {}),
      ...(body.spawnError !== undefined
        ? { spawnError: assertStringField(body.spawnError, "spawnError") }
        : {}),
      ...(body.attemptedCommand !== undefined
        ? { attemptedCommand: assertStringField(body.attemptedCommand, "attemptedCommand") }
        : {}),
      ...(body.mcpSetupWarning !== undefined
        ? { mcpSetupWarning: assertStringField(body.mcpSetupWarning, "mcpSetupWarning") }
        : {})
    };
    return payload;
  }

  throw new HTTPException(400, {
    message: "Field 'type' must be one of: heartbeat, completion"
  });
}

export function registerActionsCallbackRoutes(router: ApiRouter): void {
  router.post("/internal/container-callback", async (c) => {
    const payload = parseContainerCallbackPayload(await parseJsonObject(c.req.raw));

    if (payload.type === "heartbeat") {
      await handleContainerHeartbeat({
        env: c.env,
        payload
      });
      return c.json({ ok: true });
    }

    await handleContainerCompletion({
      env: c.env,
      payload,
      requestOrigin: new URL(c.req.url).origin
    });
    return c.json({ ok: true });
  });
}
