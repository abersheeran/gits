import type {
  ActionContainerInstanceType,
  ActionRunLogStreamEvent,
  ActionRunRecord,
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

export function isPendingRun(run: ActionRunRecord): boolean {
  return run.status === "queued" || run.status === "running";
}

export function isPendingAgentSession(session: AgentSessionRecord): boolean {
  return session.status === "queued" || session.status === "running";
}

export function canCancelAgentSession(session: AgentSessionRecord): boolean {
  return session.status === "queued";
}

export function formatDuration(
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

export function runSourceLabel(run: ActionRunRecord): string {
  if (run.trigger_source_type && run.trigger_source_number) {
    return `${run.trigger_source_type} #${run.trigger_source_number}`;
  }
  if (run.source_number !== null) {
    return `${run.source_type} #${run.source_number}`;
  }
  return run.workflow_name ?? run.origin;
}

export function runGroupLabel(run: ActionRunRecord): string {
  return run.workflow_name ?? run.origin ?? "session";
}

export function sessionSourceLabel(session: AgentSessionRecord): string {
  if (session.source_number !== null) {
    return `${session.source_type} #${session.source_number}`;
  }
  return session.source_type;
}

function isActionRunStatus(value: unknown): value is ActionRunRecord["status"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "cancelled"
  );
}

export function insertOrReplaceRun(
  currentRuns: ActionRunRecord[],
  nextRun: ActionRunRecord
): ActionRunRecord[] {
  const existingIndex = currentRuns.findIndex((run) => run.id === nextRun.id);
  if (existingIndex === -1) {
    return [...currentRuns, nextRun].sort(
      (left, right) =>
        (right.run_number ?? right.session_number) -
        (left.run_number ?? left.session_number)
    );
  }

  return currentRuns.map((run) => (run.id === nextRun.id ? nextRun : run));
}

export function insertOrReplaceSession(
  currentSessions: AgentSessionRecord[],
  nextSession: AgentSessionRecord
): AgentSessionRecord[] {
  const existingIndex = currentSessions.findIndex(
    (session) => session.id === nextSession.id
  );
  if (existingIndex === -1) {
    return [...currentSessions, nextSession].sort(
      (left, right) => right.created_at - left.created_at
    );
  }

  return currentSessions.map((session) =>
    session.id === nextSession.id ? nextSession : session
  );
}

function shouldPreferCurrentRun(
  currentRun: ActionRunRecord,
  nextRun: ActionRunRecord
): boolean {
  if (currentRun.updated_at !== nextRun.updated_at) {
    return currentRun.updated_at > nextRun.updated_at;
  }
  if (currentRun.status !== nextRun.status) {
    return false;
  }
  return currentRun.logs.length > nextRun.logs.length;
}

export function mergeRuns(
  currentRuns: ActionRunRecord[],
  nextRuns: ActionRunRecord[]
): ActionRunRecord[] {
  const mergedRuns = new Map(nextRuns.map((run) => [run.id, run] as const));

  for (const currentRun of currentRuns) {
    const nextRun = mergedRuns.get(currentRun.id);
    if (!nextRun) {
      mergedRuns.set(currentRun.id, currentRun);
      continue;
    }
    if (shouldPreferCurrentRun(currentRun, nextRun)) {
      mergedRuns.set(currentRun.id, currentRun);
    }
  }

  return Array.from(mergedRuns.values()).sort(
    (left, right) =>
      (right.run_number ?? right.session_number) -
      (left.run_number ?? left.session_number)
  );
}

function isActionRunRecord(value: unknown): value is ActionRunRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const run = value as Partial<ActionRunRecord>;
  return (
    typeof run.id === "string" &&
    typeof run.run_number === "number" &&
    typeof run.status === "string" &&
    typeof run.logs === "string" &&
    typeof run.updated_at === "number"
  );
}

export function parseActionRunLogStreamEvent(
  eventName: ActionRunLogStreamEvent["event"],
  rawData: string
): ActionRunLogStreamEvent | null {
  type StreamStatusData = {
    runId?: unknown;
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
    const data = parsed as { run?: unknown };
    return isActionRunRecord(data.run)
      ? {
          event: eventName,
          data: {
            run: data.run
          }
        }
      : null;
  }

  if (eventName === "append") {
    const data = parsed as StreamStatusData & { chunk?: unknown };
    return typeof data.runId === "string" &&
      typeof data.chunk === "string" &&
      isActionRunStatus(data.status) &&
      (typeof data.exitCode === "number" || data.exitCode === null) &&
      (typeof data.completedAt === "number" || data.completedAt === null) &&
      typeof data.updatedAt === "number"
      ? {
          event: "append",
          data: {
            runId: data.runId,
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
    return typeof data.runId === "string" &&
      isActionRunStatus(data.status) &&
      (typeof data.exitCode === "number" || data.exitCode === null) &&
      (typeof data.completedAt === "number" || data.completedAt === null) &&
      typeof data.updatedAt === "number"
      ? {
          event: eventName,
          data: {
            runId: data.runId,
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

export function applyRunStreamEvent(
  currentRuns: ActionRunRecord[],
  streamEvent: ActionRunLogStreamEvent
): ActionRunRecord[] {
  if (streamEvent.event === "heartbeat" || streamEvent.event === "stream-error") {
    return currentRuns;
  }

  if (streamEvent.event === "snapshot" || streamEvent.event === "replace") {
    return insertOrReplaceRun(currentRuns, streamEvent.data.run);
  }

  if (streamEvent.event === "append") {
    return currentRuns.map((run) =>
      run.id === streamEvent.data.runId
        ? {
            ...run,
            logs: `${run.logs ?? ""}${streamEvent.data.chunk}`,
            status: streamEvent.data.status,
            exit_code: streamEvent.data.exitCode,
            completed_at: streamEvent.data.completedAt,
            updated_at: streamEvent.data.updatedAt
          }
        : run
    );
  }

  if (streamEvent.event === "status" || streamEvent.event === "done") {
    return currentRuns.map((run) =>
      run.id === streamEvent.data.runId
        ? {
            ...run,
            status: streamEvent.data.status,
            exit_code: streamEvent.data.exitCode,
            completed_at: streamEvent.data.completedAt,
            updated_at: streamEvent.data.updatedAt
          }
        : run
    );
  }

  return currentRuns;
}
