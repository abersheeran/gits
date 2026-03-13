import type {
  ActionAgentType,
  ActionContainerInstanceType,
  AgentSessionArtifactKind,
  AgentSessionArtifactRecord,
  AgentSessionAttemptEventRecord,
  AgentSessionAttemptEventStream,
  AgentSessionAttemptEventType,
  AgentSessionAttemptFailureReason,
  AgentSessionAttemptFailureStage,
  AgentSessionAttemptRecord,
  AgentSessionAttemptStatus,
  AgentSessionOrigin,
  AgentSessionRecord,
  AgentSessionSourceType,
  AgentSessionStatus,
  AgentSessionStepKind,
  AgentSessionStepRecord,
  AgentSessionValidationReport
} from "../types";
import {
  ActionLogStorageService,
  buildLogExcerpt,
  type AgentLogArtifactKind
} from "./action-log-storage-service";

export type AgentSessionTimelineEvent = {
  id: string;
  type:
    | "session_created"
    | "session_queued"
    | "session_claimed"
    | "session_started"
    | "log"
    | "session_completed"
    | "session_cancelled"
    | "intervention";
  title: string;
  detail: string | null;
  timestamp: number | null;
  level: "info" | "success" | "warning" | "error";
  stream: "system" | "stdout" | "stderr" | "error" | null;
};

type SessionRow = {
  id: string;
  repository_id: string;
  session_number: number;
  source_type: AgentSessionSourceType;
  source_number: number | null;
  source_comment_id: string | null;
  origin: AgentSessionOrigin;
  status: AgentSessionStatus;
  agent_type: ActionAgentType;
  instance_type: ActionContainerInstanceType;
  prompt: string;
  branch_ref: string | null;
  trigger_ref: string | null;
  trigger_sha: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  parent_session_id: string | null;
  created_by: string | null;
  created_by_username: string | null;
  delegated_from_user_id: string | null;
  delegated_from_username: string | null;
  exit_code: number | null;
  container_instance: string | null;
  active_attempt_id: string | null;
  latest_attempt_id: string | null;
  failure_reason: AgentSessionAttemptFailureReason | null;
  failure_stage: AgentSessionAttemptFailureStage | null;
  created_at: number;
  claimed_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

type AttemptRow = {
  id: string;
  session_id: string;
  repository_id: string;
  attempt_number: number;
  status: AgentSessionAttemptStatus;
  instance_type: ActionContainerInstanceType;
  promoted_from_instance_type: ActionContainerInstanceType | null;
  container_instance: string | null;
  exit_code: number | null;
  failure_reason: AgentSessionAttemptFailureReason | null;
  failure_stage: AgentSessionAttemptFailureStage | null;
  created_at: number;
  claimed_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

type ArtifactRow = {
  id: string;
  attempt_id: string;
  session_id: string;
  repository_id: string;
  kind: AgentSessionArtifactKind;
  title: string;
  media_type: string;
  size_bytes: number;
  content_text: string;
  created_at: number;
  updated_at: number;
};

type EventRow = {
  id: number;
  attempt_id: string;
  session_id: string;
  repository_id: string;
  type: AgentSessionAttemptEventType;
  stream: AgentSessionAttemptEventStream;
  message: string;
  payload_json: string | null;
  created_at: number;
};

export type CreateAgentSessionInput = {
  repositoryId: string;
  sourceType: AgentSessionSourceType;
  sourceNumber?: number | null;
  sourceCommentId?: string | null;
  origin: AgentSessionOrigin;
  status?: AgentSessionStatus;
  agentType: ActionAgentType;
  instanceType: ActionContainerInstanceType;
  prompt: string;
  triggerRef?: string | null;
  triggerSha?: string | null;
  workflowId?: string | null;
  parentSessionId?: string | null;
  createdBy?: string | null;
  delegatedFromUserId?: string | null;
};

type AttemptEventInput = {
  type: AgentSessionAttemptEventType;
  stream: AgentSessionAttemptEventStream;
  message: string;
  payload?: Record<string, unknown> | null;
  createdAt?: number;
};

function parsePayloadJson(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function asJson(value: Record<string, unknown> | null | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

function isLogArtifactKind(kind: AgentSessionArtifactKind): kind is AgentLogArtifactKind {
  return kind === "session_logs" || kind === "stdout" || kind === "stderr";
}

function mapAttemptStatusToSessionStatus(status: AgentSessionAttemptStatus): AgentSessionStatus {
  if (status === "success") {
    return "success";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "failed" || status === "retryable_failed") {
    return "failed";
  }
  if (status === "running" || status === "booting") {
    return "running";
  }
  return "queued";
}

function eventLevel(event: AgentSessionAttemptEventRecord): AgentSessionTimelineEvent["level"] {
  if (event.stream === "error") {
    return "error";
  }
  if (event.type === "warning" || event.type === "retry_scheduled") {
    return "warning";
  }
  if (event.type === "attempt_completed") {
    const status = event.payload?.status;
    if (status === "success") {
      return "success";
    }
    if (status === "failed" || status === "retryable_failed" || status === "cancelled") {
      return status === "cancelled" ? "warning" : "error";
    }
  }
  return "info";
}

export class AgentSessionService {
  constructor(
    private readonly db: D1Database,
    private readonly logStorage: ActionLogStorageService | null = null
  ) {}

  private readonly sessionSelectSql = `SELECT
      s.id,
      s.repository_id,
      s.session_number,
      s.source_type,
      s.source_number,
      s.source_comment_id,
      s.origin,
      s.status,
      s.agent_type,
      s.instance_type,
      s.prompt,
      s.branch_ref,
      s.trigger_ref,
      s.trigger_sha,
      s.workflow_id,
      w.name AS workflow_name,
      s.parent_session_id,
      s.created_by,
      created_by_user.username AS created_by_username,
      s.delegated_from_user_id,
      delegated_user.username AS delegated_from_username,
      s.exit_code,
      s.container_instance,
      s.active_attempt_id,
      s.latest_attempt_id,
      s.failure_reason,
      s.failure_stage,
      s.created_at,
      s.claimed_at,
      s.started_at,
      s.completed_at,
      s.updated_at
    FROM agent_sessions s
    LEFT JOIN action_workflows w ON w.id = s.workflow_id
    LEFT JOIN users created_by_user ON created_by_user.id = s.created_by
    LEFT JOIN users delegated_user ON delegated_user.id = s.delegated_from_user_id`;

  private readonly attemptSelectSql = `SELECT
      id,
      session_id,
      repository_id,
      attempt_number,
      status,
      instance_type,
      promoted_from_instance_type,
      container_instance,
      exit_code,
      failure_reason,
      failure_stage,
      created_at,
      claimed_at,
      started_at,
      completed_at,
      updated_at
    FROM agent_session_attempts`;

  private async nextSessionNumber(repositoryId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO repository_counters (
          repository_id,
          issue_number_seq,
          pull_number_seq,
          session_number_seq
        )
        VALUES (?, 0, 0, 1)
        ON CONFLICT(repository_id)
        DO UPDATE SET session_number_seq = session_number_seq + 1
        RETURNING session_number_seq AS session_number`
      )
      .bind(repositoryId)
      .first<{ session_number: number }>();
    if (!row) {
      throw new Error("Unable to allocate agent session number");
    }
    return row.session_number;
  }

  private async nextAttemptNumber(sessionId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
         FROM agent_session_attempts
         WHERE session_id = ?`
      )
      .bind(sessionId)
      .first<{ attempt_number: number }>();
    return row?.attempt_number ?? 1;
  }

  private buildBranchRef(sessionId: string): string {
    return `refs/heads/agent/${sessionId}`;
  }

  private mapSessionRow(row: SessionRow): AgentSessionRecord {
    return {
      id: row.id,
      repository_id: row.repository_id,
      session_number: row.session_number,
      source_type: row.source_type,
      source_number: row.source_number,
      source_comment_id: row.source_comment_id,
      origin: row.origin,
      status: row.status,
      agent_type: row.agent_type,
      instance_type: row.instance_type,
      prompt: row.prompt,
      branch_ref: row.branch_ref,
      trigger_ref: row.trigger_ref,
      trigger_sha: row.trigger_sha,
      workflow_id: row.workflow_id,
      workflow_name: row.workflow_name,
      parent_session_id: row.parent_session_id,
      created_by: row.created_by,
      created_by_username: row.created_by_username,
      delegated_from_user_id: row.delegated_from_user_id,
      delegated_from_username: row.delegated_from_username,
      active_attempt_id: row.active_attempt_id,
      latest_attempt_id: row.latest_attempt_id,
      exit_code: row.exit_code,
      container_instance: row.container_instance,
      failure_reason: row.failure_reason,
      failure_stage: row.failure_stage,
      created_at: row.created_at,
      claimed_at: row.claimed_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at
    };
  }

  private mapAttemptRow(row: AttemptRow): AgentSessionAttemptRecord {
    return {
      id: row.id,
      session_id: row.session_id,
      repository_id: row.repository_id,
      attempt_number: row.attempt_number,
      status: row.status,
      instance_type: row.instance_type,
      promoted_from_instance_type: row.promoted_from_instance_type,
      container_instance: row.container_instance,
      exit_code: row.exit_code,
      failure_reason: row.failure_reason,
      failure_stage: row.failure_stage,
      created_at: row.created_at,
      claimed_at: row.claimed_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at
    };
  }

  private mapArtifactRow(row: ArtifactRow): AgentSessionArtifactRecord {
    return {
      id: row.id,
      attempt_id: row.attempt_id,
      session_id: row.session_id,
      repository_id: row.repository_id,
      kind: row.kind,
      title: row.title,
      media_type: row.media_type,
      size_bytes: row.size_bytes,
      content_text: row.content_text,
      has_full_content: isLogArtifactKind(row.kind),
      content_url: null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapEventRow(row: EventRow): AgentSessionAttemptEventRecord {
    return {
      id: row.id,
      attempt_id: row.attempt_id,
      session_id: row.session_id,
      repository_id: row.repository_id,
      type: row.type,
      stream: row.stream,
      message: row.message,
      payload: parsePayloadJson(row.payload_json),
      created_at: row.created_at
    };
  }

  async createSessionExecution(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    const sessionId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const now = Date.now();
    const sessionNumber = await this.nextSessionNumber(input.repositoryId);
    const branchRef = this.buildBranchRef(sessionId);

    await this.db
      .prepare(
        `INSERT INTO agent_sessions (
          id,
          repository_id,
          session_number,
          source_type,
          source_number,
          source_comment_id,
          origin,
          status,
          agent_type,
          instance_type,
          prompt,
          branch_ref,
          trigger_ref,
          trigger_sha,
          workflow_id,
          parent_session_id,
          created_by,
          delegated_from_user_id,
          exit_code,
          container_instance,
          active_attempt_id,
          latest_attempt_id,
          failure_reason,
          failure_stage,
          created_at,
          claimed_at,
          started_at,
          completed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        sessionId,
        input.repositoryId,
        sessionNumber,
        input.sourceType,
        input.sourceNumber ?? null,
        input.sourceCommentId ?? null,
        input.origin,
        input.status ?? "queued",
        input.agentType,
        input.instanceType,
        input.prompt,
        branchRef,
        input.triggerRef ?? null,
        input.triggerSha ?? null,
        input.workflowId ?? null,
        input.parentSessionId ?? null,
        input.createdBy ?? null,
        input.delegatedFromUserId ?? null,
        null,
        null,
        attemptId,
        attemptId,
        null,
        null,
        now,
        null,
        null,
        null,
        now
      )
      .run();

    await this.db
      .prepare(
        `INSERT INTO agent_session_attempts (
          id,
          session_id,
          repository_id,
          attempt_number,
          status,
          instance_type,
          promoted_from_instance_type,
          container_instance,
          exit_code,
          failure_reason,
          failure_stage,
          created_at,
          claimed_at,
          started_at,
          completed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        attemptId,
        sessionId,
        input.repositoryId,
        1,
        "queued",
        input.instanceType,
        null,
        null,
        null,
        null,
        null,
        now,
        null,
        null,
        null,
        now
      )
      .run();

    await this.appendAttemptEvents(input.repositoryId, sessionId, attemptId, [
      {
        type: "attempt_created",
        stream: "system",
        message: "Attempt #1 queued.",
        payload: {
          attemptNumber: 1,
          instanceType: input.instanceType
        },
        createdAt: now
      }
    ]);

    const session = await this.findSessionById(input.repositoryId, sessionId);
    if (!session) {
      throw new Error("Created agent session not found");
    }
    return {
      ...session,
      active_attempt_id: session.active_attempt_id ?? attemptId,
      latest_attempt_id: session.latest_attempt_id ?? attemptId
    };
  }

  async createRetryAttempt(input: {
    repositoryId: string;
    sessionId: string;
    instanceType: ActionContainerInstanceType;
    promotedFromInstanceType?: ActionContainerInstanceType | null;
    createdAt?: number;
  }): Promise<AgentSessionAttemptRecord> {
    const createdAt = input.createdAt ?? Date.now();
    const attemptId = crypto.randomUUID();
    const attemptNumber = await this.nextAttemptNumber(input.sessionId);
    await this.db
      .prepare(
        `INSERT INTO agent_session_attempts (
          id,
          session_id,
          repository_id,
          attempt_number,
          status,
          instance_type,
          promoted_from_instance_type,
          container_instance,
          exit_code,
          failure_reason,
          failure_stage,
          created_at,
          claimed_at,
          started_at,
          completed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, NULL, ?)`
      )
      .bind(
        attemptId,
        input.sessionId,
        input.repositoryId,
        attemptNumber,
        input.instanceType,
        input.promotedFromInstanceType ?? null,
        createdAt,
        createdAt
      )
      .run();

    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET status = 'queued',
             active_attempt_id = ?,
             latest_attempt_id = ?,
             container_instance = NULL,
             exit_code = NULL,
             failure_reason = NULL,
             failure_stage = NULL,
             updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(attemptId, attemptId, createdAt, input.repositoryId, input.sessionId)
      .run();

    await this.appendAttemptEvents(input.repositoryId, input.sessionId, attemptId, [
      {
        type: "attempt_created",
        stream: "system",
        message: `Attempt #${attemptNumber} queued.`,
        payload: {
          attemptNumber,
          instanceType: input.instanceType,
          promotedFromInstanceType: input.promotedFromInstanceType ?? null
        },
        createdAt
      }
    ]);

    const attempt = await this.findAttemptById(input.repositoryId, attemptId);
    if (!attempt) {
      throw new Error("Created retry attempt not found");
    }
    return attempt;
  }

  async listSessions(input: {
    repositoryId: string;
    limit?: number;
    sourceType?: AgentSessionSourceType;
    sourceNumber?: number;
  }): Promise<AgentSessionRecord[]> {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    const whereClauses = ["s.repository_id = ?"];
    const params: unknown[] = [input.repositoryId];
    if (input.sourceType !== undefined) {
      whereClauses.push("s.source_type = ?");
      params.push(input.sourceType);
    }
    if (input.sourceNumber !== undefined) {
      whereClauses.push("s.source_number = ?");
      params.push(input.sourceNumber);
    }
    const rows = await this.db
      .prepare(
        `${this.sessionSelectSql}
         WHERE ${whereClauses.join(" AND ")}
         ORDER BY s.created_at DESC
         LIMIT ?`
      )
      .bind(...params, limit)
      .all<SessionRow>();
    return rows.results.map((row) => this.mapSessionRow(row));
  }

  async listLatestSessionsBySource(
    repositoryId: string,
    sourceType: AgentSessionSourceType,
    sourceNumbers: readonly number[]
  ): Promise<AgentSessionRecord[]> {
    if (sourceNumbers.length === 0) {
      return [];
    }
    const uniqueSourceNumbers = Array.from(new Set(sourceNumbers));
    const placeholders = uniqueSourceNumbers.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `${this.sessionSelectSql}
         WHERE s.repository_id = ?
           AND s.source_type = ?
           AND s.source_number IN (${placeholders})
         ORDER BY s.created_at DESC`
      )
      .bind(repositoryId, sourceType, ...uniqueSourceNumbers)
      .all<SessionRow>();
    const latestBySourceNumber = new Map<number, AgentSessionRecord>();
    for (const row of rows.results) {
      if (row.source_number === null || latestBySourceNumber.has(row.source_number)) {
        continue;
      }
      latestBySourceNumber.set(row.source_number, this.mapSessionRow(row));
    }
    return Array.from(latestBySourceNumber.values());
  }

  async listLatestSessionsByCommentIds(
    repositoryId: string,
    commentIds: readonly string[]
  ): Promise<AgentSessionRecord[]> {
    if (commentIds.length === 0) {
      return [];
    }
    const uniqueCommentIds = Array.from(new Set(commentIds));
    const placeholders = uniqueCommentIds.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `${this.sessionSelectSql}
         WHERE s.repository_id = ?
           AND s.source_comment_id IN (${placeholders})
         ORDER BY s.created_at DESC`
      )
      .bind(repositoryId, ...uniqueCommentIds)
      .all<SessionRow>();
    const latestByCommentId = new Map<string, AgentSessionRecord>();
    for (const row of rows.results) {
      if (!row.source_comment_id || latestByCommentId.has(row.source_comment_id)) {
        continue;
      }
      latestByCommentId.set(row.source_comment_id, this.mapSessionRow(row));
    }
    return Array.from(latestByCommentId.values());
  }

  async findSessionById(repositoryId: string, sessionId: string): Promise<AgentSessionRecord | null> {
    const row = await this.db
      .prepare(
        `${this.sessionSelectSql}
         WHERE s.repository_id = ? AND s.id = ?
         LIMIT 1`
      )
      .bind(repositoryId, sessionId)
      .first<SessionRow>();
    return row ? this.mapSessionRow(row) : null;
  }

  async listAttempts(repositoryId: string, sessionId: string): Promise<AgentSessionAttemptRecord[]> {
    const rows = await this.db
      .prepare(
        `${this.attemptSelectSql}
         WHERE repository_id = ? AND session_id = ?
         ORDER BY attempt_number DESC`
      )
      .bind(repositoryId, sessionId)
      .all<AttemptRow>();
    return rows.results.map((row) => this.mapAttemptRow(row));
  }

  async findAttemptById(
    repositoryId: string,
    attemptId: string
  ): Promise<AgentSessionAttemptRecord | null> {
    const row = await this.db
      .prepare(
        `${this.attemptSelectSql}
         WHERE repository_id = ? AND id = ?
         LIMIT 1`
      )
      .bind(repositoryId, attemptId)
      .first<AttemptRow>();
    return row ? this.mapAttemptRow(row) : null;
  }

  async findActiveAttemptForSession(
    repositoryId: string,
    sessionId: string
  ): Promise<AgentSessionAttemptRecord | null> {
    const session = await this.findSessionById(repositoryId, sessionId);
    if (!session?.active_attempt_id) {
      return null;
    }
    return this.findAttemptById(repositoryId, session.active_attempt_id);
  }

  async findLatestAttemptForSession(
    repositoryId: string,
    sessionId: string
  ): Promise<AgentSessionAttemptRecord | null> {
    const session = await this.findSessionById(repositoryId, sessionId);
    if (!session?.latest_attempt_id) {
      return null;
    }
    return this.findAttemptById(repositoryId, session.latest_attempt_id);
  }

  async claimQueuedAttempt(input: {
    repositoryId: string;
    sessionId: string;
    attemptId: string;
    containerInstance: string;
    claimedAt?: number;
  }): Promise<number | null> {
    const claimedAt = input.claimedAt ?? Date.now();
    const result = await this.db
      .prepare(
        `UPDATE agent_session_attempts
         SET status = 'booting',
             container_instance = ?,
             claimed_at = ?,
             updated_at = ?
         WHERE repository_id = ? AND session_id = ? AND id = ? AND status = 'queued'`
      )
      .bind(
        input.containerInstance,
        claimedAt,
        claimedAt,
        input.repositoryId,
        input.sessionId,
        input.attemptId
      )
      .run();
    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      return null;
    }

    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET claimed_at = COALESCE(claimed_at, ?),
             active_attempt_id = ?,
             latest_attempt_id = ?,
             container_instance = ?,
             updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(
        claimedAt,
        input.attemptId,
        input.attemptId,
        input.containerInstance,
        claimedAt,
        input.repositoryId,
        input.sessionId
      )
      .run();

    await this.appendAttemptEvents(input.repositoryId, input.sessionId, input.attemptId, [
      {
        type: "attempt_claimed",
        stream: "system",
        message: "Runner claimed queued attempt.",
        payload: {
          containerInstance: input.containerInstance
        },
        createdAt: claimedAt
      }
    ]);

    return claimedAt;
  }

  async markAttemptRunning(input: {
    repositoryId: string;
    sessionId: string;
    attemptId: string;
    containerInstance: string;
    startedAt?: number;
  }): Promise<number | null> {
    const startedAt = input.startedAt ?? Date.now();
    const result = await this.db
      .prepare(
        `UPDATE agent_session_attempts
         SET status = 'running',
             container_instance = ?,
             started_at = ?,
             updated_at = ?
         WHERE repository_id = ? AND session_id = ? AND id = ?
           AND status IN ('queued', 'booting')`
      )
      .bind(
        input.containerInstance,
        startedAt,
        startedAt,
        input.repositoryId,
        input.sessionId,
        input.attemptId
      )
      .run();
    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      return null;
    }

    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET status = 'running',
             claimed_at = COALESCE(claimed_at, ?),
             started_at = COALESCE(started_at, ?),
             active_attempt_id = ?,
             latest_attempt_id = ?,
             container_instance = ?,
             updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(
        startedAt,
        startedAt,
        input.attemptId,
        input.attemptId,
        input.containerInstance,
        startedAt,
        input.repositoryId,
        input.sessionId
      )
      .run();

    await this.appendAttemptEvents(input.repositoryId, input.sessionId, input.attemptId, [
      {
        type: "attempt_started",
        stream: "system",
        message: "Attempt started.",
        payload: {
          containerInstance: input.containerInstance
        },
        createdAt: startedAt
      }
    ]);

    return startedAt;
  }

  async appendAttemptEvents(
    repositoryId: string,
    sessionId: string,
    attemptId: string,
    events: AttemptEventInput[]
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const statements = events.map((event) =>
      this.db
        .prepare(
          `INSERT INTO agent_session_attempt_events (
            attempt_id,
            session_id,
            repository_id,
            type,
            stream,
            message,
            payload_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          attemptId,
          sessionId,
          repositoryId,
          event.type,
          event.stream,
          event.message,
          asJson(event.payload),
          event.createdAt ?? Date.now()
        )
    );
    if (typeof this.db.batch === "function") {
      await this.db.batch(statements);
      return;
    }
    for (const statement of statements) {
      await statement.run();
    }
  }

  async listAttemptEvents(input: {
    repositoryId: string;
    sessionId: string;
    attemptId: string;
    afterId?: number;
    limit?: number;
  }): Promise<AgentSessionAttemptEventRecord[]> {
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          attempt_id,
          session_id,
          repository_id,
          type,
          stream,
          message,
          payload_json,
          created_at
         FROM agent_session_attempt_events
         WHERE repository_id = ? AND session_id = ? AND attempt_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`
      )
      .bind(
        input.repositoryId,
        input.sessionId,
        input.attemptId,
        input.afterId ?? 0,
        limit
      )
      .all<EventRow>();
    return rows.results.map((row) => this.mapEventRow(row));
  }

  async upsertAttemptArtifact(input: {
    attemptId: string;
    sessionId: string;
    repositoryId: string;
    kind: AgentSessionArtifactKind;
    title: string;
    mediaType: string;
    contentText: string;
    sizeBytes?: number;
    createdAt?: number;
    updatedAt?: number;
  }): Promise<void> {
    const updatedAt = input.updatedAt ?? Date.now();
    const createdAt = input.createdAt ?? updatedAt;
    await this.db
      .prepare(
        `INSERT INTO agent_session_attempt_artifacts (
          id,
          attempt_id,
          session_id,
          repository_id,
          kind,
          title,
          media_type,
          size_bytes,
          content_text,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id, kind)
        DO UPDATE SET
          title = excluded.title,
          media_type = excluded.media_type,
          size_bytes = excluded.size_bytes,
          content_text = excluded.content_text,
          updated_at = excluded.updated_at`
      )
      .bind(
        crypto.randomUUID(),
        input.attemptId,
        input.sessionId,
        input.repositoryId,
        input.kind,
        input.title,
        input.mediaType,
        input.sizeBytes ?? input.contentText.length,
        input.contentText,
        createdAt,
        updatedAt
      )
      .run();
  }

  async listArtifacts(repositoryId: string, sessionId: string): Promise<AgentSessionArtifactRecord[]> {
    const session = await this.findSessionById(repositoryId, sessionId);
    const attemptId = session?.latest_attempt_id ?? session?.active_attempt_id ?? null;
    if (!attemptId) {
      return [];
    }
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          attempt_id,
          session_id,
          repository_id,
          kind,
          title,
          media_type,
          size_bytes,
          content_text,
          created_at,
          updated_at
         FROM agent_session_attempt_artifacts
         WHERE repository_id = ? AND session_id = ? AND attempt_id = ?
         ORDER BY updated_at DESC, created_at DESC, id DESC`
      )
      .bind(repositoryId, sessionId, attemptId)
      .all<ArtifactRow>();
    return rows.results.map((row) => this.mapArtifactRow(row));
  }

  async findArtifactById(
    repositoryId: string,
    sessionId: string,
    artifactId: string
  ): Promise<AgentSessionArtifactRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          id,
          attempt_id,
          session_id,
          repository_id,
          kind,
          title,
          media_type,
          size_bytes,
          content_text,
          created_at,
          updated_at
         FROM agent_session_attempt_artifacts
         WHERE repository_id = ? AND session_id = ? AND id = ?
         LIMIT 1`
      )
      .bind(repositoryId, sessionId, artifactId)
      .first<ArtifactRow>();
    return row ? this.mapArtifactRow(row) : null;
  }

  async readSessionLogs(repositoryId: string, sessionId: string): Promise<string | null> {
    const session = await this.findSessionById(repositoryId, sessionId);
    const attemptId = session?.latest_attempt_id ?? session?.active_attempt_id ?? null;
    if (!session) {
      return null;
    }
    if (!attemptId) {
      return "";
    }
    if (this.logStorage) {
      const fullLogs = await this.logStorage.readAttemptArtifactLogs(
        repositoryId,
        sessionId,
        attemptId,
        "session_logs"
      );
      if (fullLogs !== null) {
        return fullLogs;
      }
    }
    const artifacts = await this.listArtifacts(repositoryId, sessionId);
    return artifacts.find((artifact) => artifact.kind === "session_logs")?.content_text ?? "";
  }

  async readArtifactContent(
    repositoryId: string,
    sessionId: string,
    artifactId: string
  ): Promise<{ artifact: AgentSessionArtifactRecord; content: string } | null> {
    const artifact = await this.findArtifactById(repositoryId, sessionId, artifactId);
    if (!artifact) {
      return null;
    }
    if (this.logStorage && isLogArtifactKind(artifact.kind)) {
      const content = await this.logStorage.readAttemptArtifactLogs(
        repositoryId,
        sessionId,
        artifact.attempt_id,
        artifact.kind
      );
      if (content !== null) {
        return { artifact, content };
      }
    }
    return { artifact, content: artifact.content_text };
  }

  async syncSessionForAttempt(input: {
    repositoryId: string;
    sessionId: string;
    sessionStatus?: AgentSessionStatus;
    activeAttemptId?: string | null;
    latestAttemptId?: string | null;
    exitCode?: number | null;
    containerInstance?: string | null;
    failureReason?: AgentSessionAttemptFailureReason | null;
    failureStage?: AgentSessionAttemptFailureStage | null;
    claimedAt?: number | null;
    startedAt?: number | null;
    completedAt?: number | null;
    updatedAt?: number;
  }): Promise<void> {
    const updates: string[] = [];
    const bindings: unknown[] = [];
    const whereClauses = ["repository_id = ?", "id = ?"];
    if (input.sessionStatus !== undefined) {
      updates.push("status = ?");
      bindings.push(input.sessionStatus);
      if (input.sessionStatus !== "cancelled") {
        whereClauses.push("status <> 'cancelled'");
      }
    }
    if (input.activeAttemptId !== undefined) {
      updates.push("active_attempt_id = ?");
      bindings.push(input.activeAttemptId);
    }
    if (input.latestAttemptId !== undefined) {
      updates.push("latest_attempt_id = ?");
      bindings.push(input.latestAttemptId);
    }
    if (input.exitCode !== undefined) {
      updates.push("exit_code = ?");
      bindings.push(input.exitCode);
    }
    if (input.containerInstance !== undefined) {
      updates.push("container_instance = ?");
      bindings.push(input.containerInstance);
    }
    if (input.failureReason !== undefined) {
      updates.push("failure_reason = ?");
      bindings.push(input.failureReason);
    }
    if (input.failureStage !== undefined) {
      updates.push("failure_stage = ?");
      bindings.push(input.failureStage);
    }
    if (input.claimedAt !== undefined) {
      updates.push("claimed_at = ?");
      bindings.push(input.claimedAt);
    }
    if (input.startedAt !== undefined) {
      updates.push("started_at = ?");
      bindings.push(input.startedAt);
    }
    if (input.completedAt !== undefined) {
      updates.push("completed_at = ?");
      bindings.push(input.completedAt);
    }
    updates.push("updated_at = ?");
    bindings.push(input.updatedAt ?? Date.now());
    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET ${updates.join(", ")}
         WHERE ${whereClauses.join(" AND ")}`
      )
      .bind(...bindings, input.repositoryId, input.sessionId)
      .run();
  }

  async completeAttempt(input: {
    repositoryId: string;
    sessionId: string;
    attemptId: string;
    status: Extract<
      AgentSessionAttemptStatus,
      "retryable_failed" | "failed" | "success" | "cancelled"
    >;
    exitCode?: number | null;
    failureReason?: AgentSessionAttemptFailureReason | null;
    failureStage?: AgentSessionAttemptFailureStage | null;
    completedAt?: number;
  }): Promise<boolean> {
    const completedAt = input.completedAt ?? Date.now();
    const result = await this.db
      .prepare(
        `UPDATE agent_session_attempts
         SET status = ?,
             exit_code = ?,
             failure_reason = ?,
             failure_stage = ?,
             completed_at = ?,
             updated_at = ?
         WHERE repository_id = ? AND session_id = ? AND id = ?
           AND status IN ('queued', 'booting', 'running')`
      )
      .bind(
        input.status,
        input.exitCode ?? null,
        input.failureReason ?? null,
        input.failureStage ?? null,
        completedAt,
        completedAt,
        input.repositoryId,
        input.sessionId,
        input.attemptId
      )
      .run();
    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      return false;
    }

    await this.appendAttemptEvents(input.repositoryId, input.sessionId, input.attemptId, [
      {
        type: "attempt_completed",
        stream: input.status === "success" ? "system" : input.status === "cancelled" ? "system" : "error",
        message:
          input.status === "success"
            ? "Attempt completed successfully."
            : input.status === "retryable_failed"
              ? "Attempt failed and is eligible for retry."
              : input.status === "cancelled"
                ? "Attempt cancelled."
                : "Attempt failed.",
        payload: {
          status: input.status,
          exitCode: input.exitCode ?? null,
          failureReason: input.failureReason ?? null,
          failureStage: input.failureStage ?? null
        },
        createdAt: completedAt
      }
    ]);
    return true;
  }

  async listSteps(repositoryId: string, sessionId: string): Promise<AgentSessionStepRecord[]> {
    const [session, attempts] = await Promise.all([
      this.findSessionById(repositoryId, sessionId),
      this.listAttempts(repositoryId, sessionId)
    ]);
    if (!session) {
      return [];
    }
    const steps: AgentSessionStepRecord[] = [
      {
        id: 1,
        session_id: session.id,
        repository_id: repositoryId,
        kind: "session_created",
        title: "Session created",
        detail: `${session.source_type}${session.source_number !== null ? ` #${session.source_number}` : ""}`,
        payload: null,
        created_at: session.created_at
      },
      {
        id: 2,
        session_id: session.id,
        repository_id: repositoryId,
        kind: "session_queued",
        title: `Session #${session.session_number} queued`,
        detail: session.workflow_name?.trim() ? `${session.workflow_name} · queued` : "queued",
        payload: null,
        created_at: session.created_at
      }
    ];

    let nextId = 3;
    for (const attempt of [...attempts].reverse()) {
      if (attempt.claimed_at) {
        steps.push({
          id: nextId++,
          session_id: session.id,
          repository_id: repositoryId,
          kind: "session_claimed",
          title: `Attempt #${attempt.attempt_number} claimed`,
          detail: attempt.container_instance ? `container: ${attempt.container_instance}` : null,
          payload: null,
          created_at: attempt.claimed_at
        });
      }
      if (attempt.started_at) {
        steps.push({
          id: nextId++,
          session_id: session.id,
          repository_id: repositoryId,
          kind: "session_started",
          title: `Attempt #${attempt.attempt_number} started`,
          detail: attempt.instance_type,
          payload: null,
          created_at: attempt.started_at
        });
      }
      if (attempt.completed_at) {
        const cancelled = attempt.status === "cancelled";
        steps.push({
          id: nextId++,
          session_id: session.id,
          repository_id: repositoryId,
          kind: cancelled ? "session_cancelled" : "session_completed",
          title: cancelled
            ? `Attempt #${attempt.attempt_number} cancelled`
            : `Attempt #${attempt.attempt_number} completed`,
          detail: attempt.status,
          payload: {
            status: attempt.status,
            exitCode: attempt.exit_code,
            failureReason: attempt.failure_reason,
            failureStage: attempt.failure_stage
          },
          created_at: attempt.completed_at
        });
      }
    }

    return steps.sort((left, right) => left.created_at - right.created_at || left.id - right.id);
  }

  buildTimeline(input: {
    session: AgentSessionRecord;
    steps?: AgentSessionStepRecord[];
    events?: AgentSessionAttemptEventRecord[];
  }): AgentSessionTimelineEvent[] {
    const lifecycleEvents =
      input.steps?.map<AgentSessionTimelineEvent>((step) => ({
        id: `step-${step.id}`,
        type: step.kind,
        title: step.title,
        detail: step.detail,
        timestamp: step.created_at,
        level:
          step.kind === "session_cancelled"
            ? "warning"
            : step.kind === "session_completed" &&
                step.payload?.status &&
                step.payload.status !== "success"
              ? "error"
              : step.kind === "session_completed"
                ? "success"
                : "info",
        stream: "system"
      })) ?? [];

    const logEvents =
      input.events?.map<AgentSessionTimelineEvent>((event) => ({
        id: `event-${event.id}`,
        type: "log",
        title: event.type.replaceAll("_", " "),
        detail: event.message,
        timestamp: event.created_at,
        level: eventLevel(event),
        stream: event.stream === "system" ? "system" : event.stream
      })) ?? [];

    return [...lifecycleEvents, ...logEvents].sort((left, right) => {
      if (left.timestamp === null && right.timestamp === null) {
        return left.id.localeCompare(right.id);
      }
      if (left.timestamp === null) {
        return 1;
      }
      if (right.timestamp === null) {
        return -1;
      }
      if (left.timestamp === right.timestamp) {
        return left.id.localeCompare(right.id);
      }
      return left.timestamp - right.timestamp;
    });
  }

  async cancelActiveSession(input: {
    repositoryId: string;
    sessionId: string;
    cancelledBy?: string | null;
    completedAt?: number;
  }): Promise<{
    cancelled: boolean;
    completedAt: number;
    containerInstance: string | null;
    instanceType: ActionContainerInstanceType | null;
    attemptStatus: AgentSessionAttemptStatus | null;
  }> {
    const completedAt = input.completedAt ?? Date.now();
    const session = await this.findSessionById(input.repositoryId, input.sessionId);
    if (!session) {
      return {
        cancelled: false,
        completedAt,
        containerInstance: null,
        instanceType: null,
        attemptStatus: null
      };
    }
    const attemptId = session.active_attempt_id ?? session.latest_attempt_id;
    const attempt = attemptId
      ? await this.findAttemptById(input.repositoryId, attemptId)
      : (await this.listAttempts(input.repositoryId, input.sessionId))[0] ?? null;
    if (
      !attempt ||
      (attempt.status !== "queued" &&
        attempt.status !== "booting" &&
        attempt.status !== "running")
    ) {
      return {
        cancelled: false,
        completedAt,
        containerInstance: attempt?.container_instance ?? session.container_instance ?? null,
        instanceType: attempt?.instance_type ?? session.instance_type,
        attemptStatus: attempt?.status ?? null
      };
    }

    const attemptStatus = attempt.status;
    const updated = await this.completeAttempt({
      repositoryId: input.repositoryId,
      sessionId: input.sessionId,
      attemptId: attempt.id,
      status: "cancelled",
      failureReason: "cancel_requested",
      failureStage: "unknown",
      completedAt
    });
    if (!updated) {
      return {
        cancelled: false,
        completedAt,
        containerInstance: attempt.container_instance ?? session.container_instance ?? null,
        instanceType: attempt.instance_type ?? session.instance_type,
        attemptStatus
      };
    }
    await this.syncSessionForAttempt({
      repositoryId: input.repositoryId,
      sessionId: input.sessionId,
      sessionStatus: "cancelled",
      activeAttemptId: null,
      latestAttemptId: attempt.id,
      exitCode: null,
      containerInstance: null,
      failureReason: "cancel_requested",
      failureStage: "unknown",
      completedAt,
      updatedAt: completedAt
    });

    await this.appendAttemptEvents(input.repositoryId, input.sessionId, attempt.id, [
      {
        type: "warning",
        stream: "system",
        message: "Cancellation requested.",
        payload: {
          kind: "cancel_requested",
          createdBy: input.cancelledBy ?? null,
          detail:
            attemptStatus === "queued"
              ? "A user cancelled the queued session before it started."
              : "A user cancelled the active session and asked the runner to stop."
        },
        createdAt: completedAt
      }
    ]);

    return {
      cancelled: true,
      completedAt,
      containerInstance: attempt.container_instance ?? session.container_instance ?? null,
      instanceType: attempt.instance_type ?? session.instance_type,
      attemptStatus
    };
  }

  async claimQueuedSession(
    repositoryId: string,
    sessionId: string,
    containerInstance: string
  ): Promise<number | null> {
    const session = await this.findSessionById(repositoryId, sessionId);
    if (!session) {
      return null;
    }
    const attemptId =
      session.active_attempt_id ??
      session.latest_attempt_id ??
      (await this.listAttempts(repositoryId, sessionId))[0]?.id;
    if (!attemptId) {
      return null;
    }
    return this.claimQueuedAttempt({
      repositoryId,
      sessionId,
      attemptId,
      containerInstance
    });
  }

  async updateSessionToRunning(
    repositoryId: string,
    sessionId: string,
    containerInstance: string
  ): Promise<number | null> {
    const session = await this.findSessionById(repositoryId, sessionId);
    if (!session) {
      return null;
    }
    const attemptId =
      session.active_attempt_id ??
      session.latest_attempt_id ??
      (await this.listAttempts(repositoryId, sessionId))[0]?.id;
    if (!attemptId) {
      return null;
    }
    return this.markAttemptRunning({
      repositoryId,
      sessionId,
      attemptId,
      containerInstance
    });
  }

  async recordSessionObservability(input: {
    repositoryId: string;
    sessionId: string;
    logs: string;
    result?: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      durationMs?: number;
      error?: string;
      attemptedCommand?: string;
      mcpSetupWarning?: string;
      validationReport?: AgentSessionValidationReport;
    };
    recordedAt?: number;
  }): Promise<void> {
    const session = await this.findSessionById(input.repositoryId, input.sessionId);
    const attemptId = session?.latest_attempt_id ?? session?.active_attempt_id ?? null;
    if (!session || !attemptId) {
      return;
    }
    const recordedAt = input.recordedAt ?? Date.now();

    if (input.logs.trim()) {
      if (this.logStorage) {
        await this.logStorage.writeAttemptArtifactLogs(
          input.repositoryId,
          session.id,
          attemptId,
          "session_logs",
          input.logs
        );
      }
      await this.upsertAttemptArtifact({
        attemptId,
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "session_logs",
        title: "Session logs",
        mediaType: "text/plain",
        contentText: buildLogExcerpt(input.logs),
        sizeBytes: input.logs.length,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
    }

    if (input.result?.stdout?.length) {
      if (this.logStorage) {
        await this.logStorage.writeAttemptArtifactLogs(
          input.repositoryId,
          session.id,
          attemptId,
          "stdout",
          input.result.stdout
        );
      }
      await this.upsertAttemptArtifact({
        attemptId,
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "stdout",
        title: "Runner stdout",
        mediaType: "text/plain",
        contentText: buildLogExcerpt(input.result.stdout),
        sizeBytes: input.result.stdout.length,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
    }

    if (input.result?.stderr?.length) {
      if (this.logStorage) {
        await this.logStorage.writeAttemptArtifactLogs(
          input.repositoryId,
          session.id,
          attemptId,
          "stderr",
          input.result.stderr
        );
      }
      await this.upsertAttemptArtifact({
        attemptId,
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "stderr",
        title: "Runner stderr",
        mediaType: "text/plain",
        contentText: buildLogExcerpt(input.result.stderr),
        sizeBytes: input.result.stderr.length,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
    }

    if (input.result) {
      await this.appendAttemptEvents(input.repositoryId, session.id, attemptId, [
        {
          type: "result_reported",
          stream:
            input.result.exitCode === undefined || input.result.exitCode === 0 ? "system" : "error",
          message:
            input.result.exitCode === undefined
              ? "Attempt reported an incomplete result."
              : `Attempt reported exit code ${input.result.exitCode}.`,
          payload: {
            exitCode: input.result.exitCode ?? null,
            durationMs: input.result.durationMs ?? null,
            stdoutChars: input.result.stdout?.length ?? 0,
            stderrChars: input.result.stderr?.length ?? 0,
            attemptedCommand: input.result.attemptedCommand ?? null,
            validationReport: input.result.validationReport ?? null,
            error: input.result.error ?? null
          },
          createdAt: recordedAt
        }
      ]);
    }

    if (input.result?.mcpSetupWarning?.trim()) {
      await this.appendAttemptEvents(input.repositoryId, session.id, attemptId, [
        {
          type: "warning",
          stream: "system",
          message: "MCP setup warning",
          payload: {
            detail: input.result.mcpSetupWarning.trim()
          },
          createdAt: recordedAt
        }
      ]);
    }
  }

  async recordRunClaimed(input: {
    repositoryId: string;
    runId: string;
    containerInstance: string;
    claimedAt?: number;
  }): Promise<void> {
    const session = await this.findSessionById(input.repositoryId, input.runId);
    if (!session?.active_attempt_id) {
      return;
    }
    await this.claimQueuedAttempt({
      repositoryId: input.repositoryId,
      sessionId: input.runId,
      attemptId: session.active_attempt_id,
      containerInstance: input.containerInstance,
      ...(input.claimedAt !== undefined ? { claimedAt: input.claimedAt } : {})
    });
  }

  async syncSessionForRun(input: {
    repositoryId: string;
    runId: string;
    status?: AgentSessionStatus;
    startedAt?: number | null;
    completedAt?: number | null;
    updatedAt?: number;
  }): Promise<void> {
    await this.syncSessionForAttempt({
      repositoryId: input.repositoryId,
      sessionId: input.runId,
      ...(input.status !== undefined ? { sessionStatus: input.status } : {}),
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {})
    });
  }

  async recordRunObservability(input: {
    repositoryId: string;
    runId: string;
    logs: string;
    result?: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      durationMs?: number;
      error?: string;
      attemptedCommand?: string;
      mcpSetupWarning?: string;
      validationReport?: AgentSessionValidationReport;
    };
    recordedAt?: number;
  }): Promise<void> {
    await this.recordSessionObservability({
      repositoryId: input.repositoryId,
      sessionId: input.runId,
      logs: input.logs,
      ...(input.result ? { result: input.result } : {}),
      ...(input.recordedAt !== undefined ? { recordedAt: input.recordedAt } : {})
    });
  }
}
