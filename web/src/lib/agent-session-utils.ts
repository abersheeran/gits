import type {
  ActionContainerInstanceType,
  AgentSessionLogStreamEvent,
  AgentSessionRecord
} from "@/lib/api";

export const ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS: Array<{
  value: ActionContainerInstanceType;
  label: string;
  spec: string;
}> = [
  { value: "lite", label: "lite", spec: "1/16 vCPU · 256 MiB · 2 GB" },
  { value: "basic", label: "basic", spec: "1/4 vCPU · 1 GiB · 4 GB" },
  { value: "standard-1", label: "standard-1", spec: "1/2 vCPU · 4 GiB · 8 GB" },
  { value: "standard-2", label: "standard-2", spec: "1 vCPU · 6 GiB · 12 GB" },
  { value: "standard-3", label: "standard-3", spec: "2 vCPU · 8 GiB · 16 GB" },
  { value: "standard-4", label: "standard-4", spec: "4 vCPU · 12 GiB · 20 GB" }
];

export function isPendingAgentSession(
  session: Pick<AgentSessionRecord, "status"> | null | undefined
): boolean {
  return session?.status === "queued" || session?.status === "running";
}

export function canCancelAgentSession(
  session: Pick<AgentSessionRecord, "status"> | null | undefined
): boolean {
  return session?.status === "queued" || session?.status === "running";
}

export function formatSessionDuration(
  startedAt: number | null,
  completedAt: number | null
): string {
  if (!startedAt) {
    return "-";
  }
  const end = completedAt ?? Date.now();
  const totalSeconds = Math.max(Math.floor((end - startedAt) / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export function sessionSourceLabel(
  session: Pick<AgentSessionRecord, "source_type" | "source_number">
): string {
  if (session.source_number !== null) {
    return `${session.source_type} #${session.source_number}`;
  }
  return session.source_type;
}

export function sessionWorkflowLabel(
  session: Pick<AgentSessionRecord, "workflow_name" | "origin">
): string {
  return session.workflow_name?.trim() || session.origin;
}

export function insertOrReplaceSession(
  currentSessions: AgentSessionRecord[],
  nextSession: AgentSessionRecord
): AgentSessionRecord[] {
  const existingIndex = currentSessions.findIndex((session) => session.id === nextSession.id);
  if (existingIndex === -1) {
    return [...currentSessions, nextSession].sort((left, right) => right.created_at - left.created_at);
  }

  return currentSessions.map((session) =>
    session.id === nextSession.id ? { ...session, ...nextSession } : session
  );
}

function isAgentSessionStatus(value: unknown): value is AgentSessionRecord["status"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isAgentSessionRecord(value: unknown): value is AgentSessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as Partial<AgentSessionRecord>;
  return (
    typeof session.id === "string" &&
    typeof session.session_number === "number" &&
    typeof session.status === "string" &&
    typeof session.logs === "string" &&
    typeof session.updated_at === "number"
  );
}

export function parseAgentSessionLogStreamEvent(
  eventName: AgentSessionLogStreamEvent["event"],
  rawData: string
): AgentSessionLogStreamEvent | null {
  type StreamStatusData = {
    sessionId?: unknown;
    status?: unknown;
    exitCode?: unknown;
    completedAt?: unknown;
    updatedAt?: unknown;
  };

  const parsed = JSON.parse(rawData) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (eventName === "snapshot" || eventName === "replace") {
    const data = parsed as { session?: unknown };
    return isAgentSessionRecord(data.session)
      ? {
          event: eventName,
          data: {
            session: data.session
          }
        }
      : null;
  }

  if (eventName === "append") {
    const data = parsed as StreamStatusData & { chunk?: unknown };
    return typeof data.sessionId === "string" &&
      typeof data.chunk === "string" &&
      isAgentSessionStatus(data.status) &&
      (typeof data.exitCode === "number" || data.exitCode === null) &&
      (typeof data.completedAt === "number" || data.completedAt === null) &&
      typeof data.updatedAt === "number"
      ? {
          event: "append",
          data: {
            sessionId: data.sessionId,
            chunk: data.chunk,
            status: data.status,
            exitCode: data.exitCode,
            completedAt: data.completedAt,
            updatedAt: data.updatedAt
          }
        }
      : null;
  }

  if (eventName === "status" || eventName === "done") {
    const data = parsed as StreamStatusData;
    return typeof data.sessionId === "string" &&
      isAgentSessionStatus(data.status) &&
      (typeof data.exitCode === "number" || data.exitCode === null) &&
      (typeof data.completedAt === "number" || data.completedAt === null) &&
      typeof data.updatedAt === "number"
      ? {
          event: eventName,
          data: {
            sessionId: data.sessionId,
            status: data.status,
            exitCode: data.exitCode,
            completedAt: data.completedAt,
            updatedAt: data.updatedAt
          }
        }
      : null;
  }

  if (eventName === "heartbeat") {
    const data = parsed as { timestamp?: unknown };
    return typeof data.timestamp === "number"
      ? {
          event: "heartbeat",
          data: {
            timestamp: data.timestamp
          }
        }
      : null;
  }

  if (eventName === "stream-error") {
    const data = parsed as { message?: unknown };
    return typeof data.message === "string"
      ? {
          event: "stream-error",
          data: {
            message: data.message
          }
        }
      : null;
  }

  return null;
}

export function applyAgentSessionStreamEvent(
  currentSessions: AgentSessionRecord[],
  streamEvent: AgentSessionLogStreamEvent
): AgentSessionRecord[] {
  if (streamEvent.event === "heartbeat" || streamEvent.event === "stream-error") {
    return currentSessions;
  }

  if (streamEvent.event === "snapshot" || streamEvent.event === "replace") {
    return insertOrReplaceSession(currentSessions, streamEvent.data.session);
  }

  if (streamEvent.event === "append") {
    return currentSessions.map((session) =>
      session.id === streamEvent.data.sessionId
        ? {
            ...session,
            logs: `${session.logs ?? ""}${streamEvent.data.chunk}`,
            status: streamEvent.data.status,
            exit_code: streamEvent.data.exitCode,
            completed_at: streamEvent.data.completedAt,
            updated_at: streamEvent.data.updatedAt
          }
        : session
    );
  }

  if (streamEvent.event === "status" || streamEvent.event === "done") {
    return currentSessions.map((session) =>
      session.id === streamEvent.data.sessionId
        ? {
            ...session,
            status: streamEvent.data.status,
            exit_code: streamEvent.data.exitCode,
            completed_at: streamEvent.data.completedAt,
            updated_at: streamEvent.data.updatedAt
          }
        : session
    );
  }

  return currentSessions;
}
