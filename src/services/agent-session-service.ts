import type {
  ActionAgentType,
  ActionContainerInstanceType,
  AgentSessionArtifactKind,
  AgentSessionArtifactRecord,
  AgentSessionInterventionKind,
  AgentSessionInterventionRecord,
  AgentSessionOrigin,
  AgentSessionRecord,
  AgentSessionSourceType,
  AgentSessionStatus,
  AgentSessionStepKind,
  AgentSessionStepRecord,
  AgentSessionUsageKind,
  AgentSessionUsageRecord,
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

const TIMELINE_SYSTEM_LOG_SECTIONS = new Set([
  "attempted",
  "mcp_setup",
  "status_reconciliation_warning",
  "log_stream_warning"
]);

const TIMELINE_ERROR_LOG_SECTIONS = new Set(["error", "runner_error", "runner_spawn_error"]);

type AgentSessionRow = {
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
  logs: string;
  exit_code: number | null;
  container_instance: string | null;
  created_at: number;
  claimed_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

type AgentSessionStepRow = {
  id: number;
  session_id: string;
  repository_id: string;
  kind: AgentSessionStepKind;
  title: string;
  detail: string | null;
  payload_json: string | null;
  created_at: number;
};

type AgentSessionArtifactRow = {
  id: string;
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

type AgentSessionUsageRow = {
  id: number;
  session_id: string;
  repository_id: string;
  kind: AgentSessionUsageKind;
  value: number;
  unit: string;
  detail: string | null;
  payload_json: string | null;
  created_at: number;
  updated_at: number;
};

type AgentSessionInterventionRow = {
  id: number;
  session_id: string;
  repository_id: string;
  kind: AgentSessionInterventionKind;
  title: string;
  detail: string | null;
  created_by: string | null;
  created_by_username: string | null;
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

function isLogArtifactKind(kind: AgentSessionArtifactKind): kind is AgentLogArtifactKind {
  return kind === "session_logs" || kind === "stdout" || kind === "stderr";
}

function mapCompletionStep(status: AgentSessionStatus): {
  kind: AgentSessionStepKind;
  title: string;
  level: AgentSessionTimelineEvent["level"];
} {
  if (status === "cancelled") {
    return {
      kind: "session_cancelled",
      title: "Session cancelled",
      level: "warning"
    };
  }
  if (status === "failed") {
    return {
      kind: "session_completed",
      title: "Session failed",
      level: "error"
    };
  }
  return {
    kind: "session_completed",
    title: "Session completed",
    level: "success"
  };
}

export class AgentSessionService {
  constructor(
    private readonly db: D1Database,
    private readonly logStorage: ActionLogStorageService | null = null
  ) {}

  private sessionSelectSql = `SELECT
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
      s.logs,
      s.exit_code,
      s.container_instance,
      s.created_at,
      s.claimed_at,
      s.started_at,
      s.completed_at,
      s.updated_at
     FROM agent_sessions s
     LEFT JOIN action_workflows w ON w.id = s.workflow_id
     LEFT JOIN users created_by_user ON created_by_user.id = s.created_by
     LEFT JOIN users delegated_user ON delegated_user.id = s.delegated_from_user_id`;

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

  private mapRow(row: AgentSessionRow): AgentSessionRecord {
    const triggerSourceType = row.source_type === "manual" ? null : row.source_type;
    return {
      id: row.id,
      repository_id: row.repository_id,
      session_number: row.session_number,
      run_number: row.session_number,
      source_type: row.source_type,
      source_number: row.source_number,
      source_comment_id: row.source_comment_id,
      trigger_source_type: triggerSourceType,
      trigger_source_number: row.source_number,
      trigger_source_comment_id: row.source_comment_id,
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
      linked_run_id: null,
      created_by: row.created_by,
      created_by_username: row.created_by_username,
      delegated_from_user_id: row.delegated_from_user_id,
      delegated_from_username: row.delegated_from_username,
      triggered_by: row.created_by,
      triggered_by_username: row.created_by_username,
      logs: row.logs,
      has_full_logs: true,
      logs_url: null,
      exit_code: row.exit_code,
      container_instance: row.container_instance,
      created_at: row.created_at,
      claimed_at: row.claimed_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at
    };
  }

  private mapStepRow(row: AgentSessionStepRow): AgentSessionStepRecord {
    return {
      id: row.id,
      session_id: row.session_id,
      repository_id: row.repository_id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      payload: parsePayloadJson(row.payload_json),
      created_at: row.created_at
    };
  }

  private mapArtifactRow(row: AgentSessionArtifactRow): AgentSessionArtifactRecord {
    return {
      id: row.id,
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

  private mapUsageRow(row: AgentSessionUsageRow): AgentSessionUsageRecord {
    return {
      id: row.id,
      session_id: row.session_id,
      repository_id: row.repository_id,
      kind: row.kind,
      value: row.value,
      unit: row.unit,
      detail: row.detail,
      payload: parsePayloadJson(row.payload_json),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapInterventionRow(row: AgentSessionInterventionRow): AgentSessionInterventionRecord {
    return {
      id: row.id,
      session_id: row.session_id,
      repository_id: row.repository_id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      created_by: row.created_by,
      created_by_username: row.created_by_username,
      payload: parsePayloadJson(row.payload_json),
      created_at: row.created_at
    };
  }

  private buildBranchRef(sessionId: string): string {
    return `refs/heads/agent/${sessionId}`;
  }

  private async insertStep(input: {
    sessionId: string;
    repositoryId: string;
    kind: AgentSessionStepKind;
    title: string;
    detail?: string | null;
    payload?: Record<string, unknown> | null;
    createdAt?: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_session_steps (
          session_id,
          repository_id,
          kind,
          title,
          detail,
          payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.sessionId,
        input.repositoryId,
        input.kind,
        input.title,
        input.detail ?? null,
        input.payload ? JSON.stringify(input.payload) : null,
        input.createdAt ?? Date.now()
      )
      .run();
  }

  private async upsertArtifact(input: {
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
    const now = input.updatedAt ?? Date.now();
    const createdAt = input.createdAt ?? now;
    await this.db
      .prepare(
        `INSERT INTO agent_session_artifacts (
          id,
          session_id,
          repository_id,
          kind,
          title,
          media_type,
          size_bytes,
          content_text,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, kind)
        DO UPDATE SET
          title = excluded.title,
          media_type = excluded.media_type,
          size_bytes = excluded.size_bytes,
          content_text = excluded.content_text,
          updated_at = excluded.updated_at`
      )
      .bind(
        crypto.randomUUID(),
        input.sessionId,
        input.repositoryId,
        input.kind,
        input.title,
        input.mediaType,
        input.sizeBytes ?? input.contentText.length,
        input.contentText,
        createdAt,
        now
      )
      .run();
  }

  private async upsertUsageRecord(input: {
    sessionId: string;
    repositoryId: string;
    kind: AgentSessionUsageKind;
    value: number;
    unit: string;
    detail?: string | null;
    payload?: Record<string, unknown> | null;
    createdAt?: number;
    updatedAt?: number;
  }): Promise<void> {
    const now = input.updatedAt ?? Date.now();
    const createdAt = input.createdAt ?? now;
    await this.db
      .prepare(
        `INSERT INTO agent_session_usage_records (
          session_id,
          repository_id,
          kind,
          value,
          unit,
          detail,
          payload_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, kind)
        DO UPDATE SET
          value = excluded.value,
          unit = excluded.unit,
          detail = excluded.detail,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at`
      )
      .bind(
        input.sessionId,
        input.repositoryId,
        input.kind,
        input.value,
        input.unit,
        input.detail ?? null,
        input.payload ? JSON.stringify(input.payload) : null,
        createdAt,
        now
      )
      .run();
  }

  private async findRows(input: {
    repositoryId: string;
    limit?: number;
    sourceType?: AgentSessionSourceType;
    sourceNumber?: number;
  }): Promise<AgentSessionRow[]> {
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
      .all<AgentSessionRow>();

    return rows.results;
  }

  private parseLogEvents(session: AgentSessionRecord): AgentSessionTimelineEvent[] {
    const logs = session.logs ?? "";
    if (!logs.trim()) {
      return [];
    }

    const lines = logs.split(/\r?\n/);
    const logEvents: AgentSessionTimelineEvent[] = [];
    let section: string | null = null;
    const baseTimestamp = session.started_at ?? session.created_at;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const sectionMatch = trimmed.match(/^\[([a-z_]+)\]$/i);
      if (sectionMatch) {
        section = sectionMatch[1]?.toLowerCase() ?? null;
        continue;
      }
      if (!section) {
        continue;
      }
      if (!TIMELINE_SYSTEM_LOG_SECTIONS.has(section) && !TIMELINE_ERROR_LOG_SECTIONS.has(section)) {
        continue;
      }
      const isErrorSection = TIMELINE_ERROR_LOG_SECTIONS.has(section);
      logEvents.push({
        id: `${session.id}-log-${logEvents.length}`,
        type: "log",
        title: section.replaceAll("_", " "),
        detail: line,
        timestamp: baseTimestamp + logEvents.length,
        level: isErrorSection ? "error" : section === "mcp_setup" ? "warning" : "info",
        stream: isErrorSection ? "error" : "system"
      });
    }

    return logEvents;
  }

  async listSessions(input: {
    repositoryId: string;
    limit?: number;
    sourceType?: AgentSessionSourceType;
    sourceNumber?: number;
  }): Promise<AgentSessionRecord[]> {
    const rows = await this.findRows(input);
    return rows.map((row) => this.mapRow(row));
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
      .all<AgentSessionRow>();

    const latestBySourceNumber = new Map<number, AgentSessionRecord>();
    for (const row of rows.results) {
      if (row.source_number === null || latestBySourceNumber.has(row.source_number)) {
        continue;
      }
      latestBySourceNumber.set(row.source_number, this.mapRow(row));
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
      .all<AgentSessionRow>();

    const latestByCommentId = new Map<string, AgentSessionRecord>();
    for (const row of rows.results) {
      if (!row.source_comment_id || latestByCommentId.has(row.source_comment_id)) {
        continue;
      }
      latestByCommentId.set(row.source_comment_id, this.mapRow(row));
    }

    return Array.from(latestByCommentId.values());
  }

  async findSessionById(
    repositoryId: string,
    sessionId: string
  ): Promise<AgentSessionRecord | null> {
    const row = await this.db
      .prepare(
        `${this.sessionSelectSql}
         WHERE s.repository_id = ? AND s.id = ?
         LIMIT 1`
      )
      .bind(repositoryId, sessionId)
      .first<AgentSessionRow>();

    return row ? this.mapRow(row) : null;
  }

  async listSteps(repositoryId: string, sessionId: string): Promise<AgentSessionStepRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          session_id,
          repository_id,
          kind,
          title,
          detail,
          payload_json,
          created_at
         FROM agent_session_steps
         WHERE repository_id = ? AND session_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .bind(repositoryId, sessionId)
      .all<AgentSessionStepRow>();

    return rows.results.map((row) => this.mapStepRow(row));
  }

  async listArtifacts(
    repositoryId: string,
    sessionId: string
  ): Promise<AgentSessionArtifactRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          session_id,
          repository_id,
          kind,
          title,
          media_type,
          size_bytes,
          content_text,
          created_at,
          updated_at
         FROM agent_session_artifacts
         WHERE repository_id = ? AND session_id = ?
         ORDER BY updated_at DESC, created_at DESC, id DESC`
      )
      .bind(repositoryId, sessionId)
      .all<AgentSessionArtifactRow>();

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
          session_id,
          repository_id,
          kind,
          title,
          media_type,
          size_bytes,
          content_text,
          created_at,
          updated_at
         FROM agent_session_artifacts
         WHERE repository_id = ? AND session_id = ? AND id = ?
         LIMIT 1`
      )
      .bind(repositoryId, sessionId, artifactId)
      .first<AgentSessionArtifactRow>();

    return row ? this.mapArtifactRow(row) : null;
  }

  async readSessionLogs(repositoryId: string, sessionId: string): Promise<string | null> {
    const session = await this.findSessionById(repositoryId, sessionId);
    if (!session) {
      return null;
    }
    if (this.logStorage) {
      const fullLogs = await this.logStorage.readSessionLogs(repositoryId, sessionId);
      if (fullLogs !== null) {
        return fullLogs;
      }
    }
    return session.logs;
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
      const content =
        artifact.kind === "session_logs"
          ? await this.logStorage.readSessionLogs(repositoryId, sessionId)
          : await this.logStorage.readSessionArtifactLogs(repositoryId, sessionId, artifact.kind);
      if (content !== null) {
        return { artifact, content };
      }
    }

    return { artifact, content: artifact.content_text };
  }

  async listUsageRecords(
    repositoryId: string,
    sessionId: string
  ): Promise<AgentSessionUsageRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          session_id,
          repository_id,
          kind,
          value,
          unit,
          detail,
          payload_json,
          created_at,
          updated_at
         FROM agent_session_usage_records
         WHERE repository_id = ? AND session_id = ?
         ORDER BY updated_at DESC, id DESC`
      )
      .bind(repositoryId, sessionId)
      .all<AgentSessionUsageRow>();

    return rows.results.map((row) => this.mapUsageRow(row));
  }

  async listInterventions(
    repositoryId: string,
    sessionId: string
  ): Promise<AgentSessionInterventionRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          i.id,
          i.session_id,
          i.repository_id,
          i.kind,
          i.title,
          i.detail,
          i.created_by,
          u.username AS created_by_username,
          i.payload_json,
          i.created_at
         FROM agent_session_interventions i
         LEFT JOIN users u ON u.id = i.created_by
         WHERE i.repository_id = ? AND i.session_id = ?
         ORDER BY i.created_at ASC, i.id ASC`
      )
      .bind(repositoryId, sessionId)
      .all<AgentSessionInterventionRow>();

    return rows.results.map((row) => this.mapInterventionRow(row));
  }

  async recordIntervention(input: {
    repositoryId: string;
    sessionId: string;
    kind: AgentSessionInterventionKind;
    title: string;
    detail?: string | null;
    createdBy?: string | null;
    payload?: Record<string, unknown> | null;
    createdAt?: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_session_interventions (
          session_id,
          repository_id,
          kind,
          title,
          detail,
          created_by,
          payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.sessionId,
        input.repositoryId,
        input.kind,
        input.title,
        input.detail ?? null,
        input.createdBy ?? null,
        input.payload ? JSON.stringify(input.payload) : null,
        input.createdAt ?? Date.now()
      )
      .run();
  }

  async createSessionExecution(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const sessionNumber = await this.nextSessionNumber(input.repositoryId);
    const branchRef = this.buildBranchRef(id);

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
          logs,
          exit_code,
          container_instance,
          created_at,
          claimed_at,
          started_at,
          completed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
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
        "",
        null,
        null,
        now,
        null,
        null,
        null,
        now
      )
      .run();

    const session = await this.findSessionById(input.repositoryId, id);
    if (!session) {
      throw new Error("Created agent session not found");
    }

    const sourceLabel =
      session.source_number !== null ? `${session.source_type} #${session.source_number}` : session.source_type;
    await this.insertStep({
      sessionId: session.id,
      repositoryId: input.repositoryId,
      kind: "session_created",
      title: "Session created",
      detail: `${sourceLabel} · ${session.origin} · ${session.created_by_username ?? "system"}`,
      payload: {
        sourceType: session.source_type,
        sourceNumber: session.source_number,
        origin: session.origin,
        createdBy: session.created_by,
        parentSessionId: session.parent_session_id
      },
      createdAt: now
    });

    if (session.status === "queued") {
      await this.insertStep({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "session_queued",
        title: `Session #${session.session_number} queued`,
        detail: session.workflow_name?.trim() ? `${session.workflow_name} · queued` : "queued",
        payload: {
          sessionId: session.id,
          sessionNumber: session.session_number,
          workflowId: session.workflow_id,
          workflowName: session.workflow_name
        },
        createdAt: now
      });
    }

    return session;
  }

  async claimQueuedSession(
    repositoryId: string,
    sessionId: string,
    containerInstance: string
  ): Promise<number | null> {
    const now = Date.now();
    const result = await this.db
      .prepare(
        `UPDATE agent_sessions
         SET container_instance = ?, claimed_at = ?, updated_at = ?
         WHERE repository_id = ? AND id = ? AND status = 'queued' AND container_instance IS NULL`
      )
      .bind(containerInstance, now, now, repositoryId, sessionId)
      .run();

    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      return null;
    }

    await this.insertStep({
      sessionId,
      repositoryId,
      kind: "session_claimed",
      title: "Runner claimed queued session",
      detail: `container: ${containerInstance}`,
      payload: {
        sessionId,
        containerInstance
      },
      createdAt: now
    });
    return now;
  }

  async updateSessionToRunning(
    repositoryId: string,
    sessionId: string,
    containerInstance: string
  ): Promise<number | null> {
    const now = Date.now();
    const result = await this.db
      .prepare(
        `UPDATE agent_sessions
         SET status = 'running', started_at = ?, updated_at = ?
         WHERE repository_id = ? AND id = ? AND status = 'queued' AND container_instance = ?`
      )
      .bind(now, now, repositoryId, sessionId, containerInstance)
      .run();

    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      return null;
    }

    const session = await this.findSessionById(repositoryId, sessionId);
    await this.insertStep({
      sessionId,
      repositoryId,
      kind: "session_started",
      title: "Session started",
      detail: session?.branch_ref ?? null,
      payload: {
        sessionId,
        branchRef: session?.branch_ref ?? null,
        containerInstance
      },
      createdAt: now
    });
    return now;
  }

  async updateRunningSessionLogs(
    repositoryId: string,
    sessionId: string,
    logs: string
  ): Promise<boolean> {
    const updatedAt = Date.now();
    const result = await this.db
      .prepare(
        `UPDATE agent_sessions
         SET logs = ?, updated_at = ?
         WHERE repository_id = ? AND id = ? AND status = 'running'`
      )
      .bind(logs, updatedAt, repositoryId, sessionId)
      .run();

    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    return changes > 0;
  }

  async replaceSessionLogs(repositoryId: string, sessionId: string, logs: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET logs = ?, updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(logs, Date.now(), repositoryId, sessionId)
      .run();
  }

  async completeSession(
    repositoryId: string,
    sessionId: string,
    input: {
      status: Extract<AgentSessionStatus, "success" | "failed" | "cancelled">;
      logs: string;
      exitCode?: number | null;
    }
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET status = ?, logs = ?, exit_code = ?, completed_at = ?, updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(input.status, input.logs, input.exitCode ?? null, now, now, repositoryId, sessionId)
      .run();

    const completion = mapCompletionStep(input.status);
    await this.insertStep({
      sessionId,
      repositoryId,
      kind: completion.kind,
      title: completion.title,
      detail: input.status,
      payload: {
        sessionId,
        status: input.status,
        exitCode: input.exitCode ?? null
      },
      createdAt: now
    });
  }

  async failPendingSessionIfStillPending(
    repositoryId: string,
    sessionId: string,
    input: {
      logs: string;
      exitCode?: number | null;
      completedAt?: number;
    }
  ): Promise<{ updated: boolean; completedAt: number }> {
    const completedAt = input.completedAt ?? Date.now();
    const result = await this.db
      .prepare(
        `UPDATE agent_sessions
         SET status = 'failed',
             logs = ?,
             exit_code = ?,
             completed_at = ?,
             updated_at = ?
         WHERE repository_id = ? AND id = ? AND status IN ('queued', 'running')`
      )
      .bind(input.logs, input.exitCode ?? null, completedAt, completedAt, repositoryId, sessionId)
      .run();

    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes > 0) {
      await this.insertStep({
        sessionId,
        repositoryId,
        kind: "session_completed",
        title: "Session failed",
        detail: "failed",
        payload: {
          sessionId,
          status: "failed",
          exitCode: input.exitCode ?? null
        },
        createdAt: completedAt
      });
    }

    return {
      updated: changes > 0,
      completedAt
    };
  }

  async cancelQueuedSession(input: {
    repositoryId: string;
    sessionId: string;
    cancelledBy?: string | null;
    completedAt?: number;
  }): Promise<{ cancelled: boolean; completedAt: number }> {
    const completedAt = input.completedAt ?? Date.now();
    const result = await this.db
      .prepare(
        `UPDATE agent_sessions
         SET status = 'cancelled', completed_at = ?, updated_at = ?
         WHERE repository_id = ? AND id = ? AND status = 'queued'`
      )
      .bind(completedAt, completedAt, input.repositoryId, input.sessionId)
      .run();

    const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes > 0) {
      await this.insertStep({
        sessionId: input.sessionId,
        repositoryId: input.repositoryId,
        kind: "session_cancelled",
        title: "Session cancelled",
        detail: "cancelled",
        payload: {
          sessionId: input.sessionId,
          status: "cancelled"
        },
        createdAt: completedAt
      });
      if (input.cancelledBy) {
        await this.recordIntervention({
          repositoryId: input.repositoryId,
          sessionId: input.sessionId,
          kind: "cancel_requested",
          title: "Cancellation requested",
          detail: "A user cancelled the queued session before it started.",
          createdBy: input.cancelledBy,
          payload: {
            sessionId: input.sessionId,
            status: "cancelled"
          },
          createdAt: completedAt
        });
      }
    }

    return {
      cancelled: changes > 0,
      completedAt
    };
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
    if (!session) {
      return;
    }

    const recordedAt = input.recordedAt ?? Date.now();
    const payloadBase = {
      sessionId: input.sessionId,
      ...(input.result?.validationReport ? { validationReport: input.result.validationReport } : {})
    };

    if (input.logs.trim()) {
      if (this.logStorage) {
        await this.logStorage.writeSessionLogs(input.repositoryId, input.sessionId, input.logs);
      }
      await this.upsertArtifact({
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
      await this.upsertUsageRecord({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "log_chars",
        value: input.logs.length,
        unit: "chars",
        detail: "Persisted session log length",
        payload: payloadBase,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
    }

    if (input.result?.stdout?.length) {
      if (this.logStorage) {
        await this.logStorage.writeSessionArtifactLogs(
          input.repositoryId,
          session.id,
          "stdout",
          input.result.stdout
        );
      }
      await this.upsertArtifact({
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
      await this.upsertUsageRecord({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "stdout_chars",
        value: input.result.stdout.length,
        unit: "chars",
        detail: "Captured runner stdout length",
        payload: payloadBase,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
    }

    if (input.result?.stderr?.length) {
      if (this.logStorage) {
        await this.logStorage.writeSessionArtifactLogs(
          input.repositoryId,
          session.id,
          "stderr",
          input.result.stderr
        );
      }
      await this.upsertArtifact({
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
      await this.upsertUsageRecord({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "stderr_chars",
        value: input.result.stderr.length,
        unit: "chars",
        detail: "Captured runner stderr length",
        payload: payloadBase,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
    }

    if (input.result?.durationMs !== undefined) {
      await this.upsertUsageRecord({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "duration_ms",
        value: input.result.durationMs,
        unit: "ms",
        detail: "Container execution duration",
        payload: payloadBase,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
    }

    if (input.result?.exitCode !== undefined) {
      await this.upsertUsageRecord({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "exit_code",
        value: input.result.exitCode,
        unit: "count",
        detail: "Runner exit code",
        payload: {
          ...payloadBase,
          ...(input.result.attemptedCommand ? { attemptedCommand: input.result.attemptedCommand } : {})
        },
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
    }

    if (input.result?.mcpSetupWarning?.trim()) {
      await this.recordIntervention({
        repositoryId: input.repositoryId,
        sessionId: session.id,
        kind: "mcp_setup_warning",
        title: "MCP setup warning",
        detail: input.result.mcpSetupWarning.trim(),
        payload: {
          ...payloadBase,
          ...(input.result.attemptedCommand ? { attemptedCommand: input.result.attemptedCommand } : {}),
          ...(input.result.error ? { runnerError: input.result.error } : {})
        },
        createdAt: recordedAt
      });
    }
  }

  async findSessionByRunId(
    repositoryId: string,
    runId: string
  ): Promise<AgentSessionRecord | null> {
    return this.findSessionById(repositoryId, runId);
  }

  async recordRunClaimed(input: {
    repositoryId: string;
    runId: string;
    containerInstance: string;
    claimedAt?: number;
  }): Promise<void> {
    const claimedAt = input.claimedAt ?? Date.now();
    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET container_instance = COALESCE(container_instance, ?),
             claimed_at = COALESCE(claimed_at, ?),
             updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(
        input.containerInstance,
        claimedAt,
        claimedAt,
        input.repositoryId,
        input.runId
      )
      .run();
  }

  async syncSessionForRun(input: {
    repositoryId: string;
    runId: string;
    status?: AgentSessionStatus;
    startedAt?: number | null;
    completedAt?: number | null;
    updatedAt?: number;
  }): Promise<void> {
    const updates: string[] = [];
    const bindings: unknown[] = [];
    if (input.status !== undefined) {
      updates.push("status = ?");
      bindings.push(input.status);
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
    if (updates.length === 0) {
      return;
    }
    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET ${updates.join(", ")}
         WHERE repository_id = ? AND id = ?`
      )
      .bind(...bindings, input.repositoryId, input.runId)
      .run();
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
      ...(input.recordedAt ? { recordedAt: input.recordedAt } : {})
    });
  }

  buildTimeline(input: {
    session: AgentSessionRecord;
    steps?: AgentSessionStepRecord[];
    interventions?: AgentSessionInterventionRecord[];
  }): AgentSessionTimelineEvent[] {
    const { session, steps = [], interventions = [] } = input;
    const sourceLabel =
      session.source_number !== null ? `${session.source_type} #${session.source_number}` : session.source_type;
    const actorLabel = session.created_by_username ?? "system";

    const fallbackLifecycleEvents: AgentSessionTimelineEvent[] = [
      {
        id: `${session.id}-created`,
        type: "session_created",
        title: "Session created",
        detail: `${sourceLabel} · ${session.origin} · ${actorLabel}`,
        timestamp: session.created_at,
        level: "info",
        stream: "system"
      },
      {
        id: `${session.id}-queued`,
        type: "session_queued",
        title: `Session #${session.session_number} queued`,
        detail: session.workflow_name?.trim() ? `${session.workflow_name} · queued` : "queued",
        timestamp: session.created_at,
        level: "info",
        stream: "system"
      },
      ...(session.claimed_at
        ? [
            {
              id: `${session.id}-claimed`,
              type: "session_claimed" as const,
              title: "Runner claimed queued session",
              detail: session.container_instance ? `container: ${session.container_instance}` : null,
              timestamp: session.claimed_at,
              level: "info" as const,
              stream: "system" as const
            }
          ]
        : []),
      ...(session.started_at
        ? [
            {
              id: `${session.id}-started`,
              type: "session_started" as const,
              title: "Session started",
              detail: session.branch_ref ?? null,
              timestamp: session.started_at,
              level: "info" as const,
              stream: "system" as const
            }
          ]
        : []),
      ...(session.completed_at
        ? [
            {
              id: `${session.id}-completed`,
              type: session.status === "cancelled" ? ("session_cancelled" as const) : ("session_completed" as const),
              title:
                session.status === "cancelled"
                  ? "Session cancelled"
                  : session.status === "failed"
                    ? "Session failed"
                    : "Session completed",
              detail:
                session.exit_code !== null && session.exit_code !== undefined
                  ? `exit code: ${session.exit_code}`
                  : session.status,
              timestamp: session.completed_at,
              level:
                session.status === "cancelled"
                  ? ("warning" as const)
                  : session.status === "failed"
                    ? ("error" as const)
                    : ("success" as const),
              stream: "system" as const
            }
          ]
        : [])
    ];

    const lifecycleEvents: AgentSessionTimelineEvent[] =
      steps.length > 0
        ? steps.map<AgentSessionTimelineEvent>((step) => {
            const level =
              step.kind === "session_cancelled"
                ? "warning"
                : step.kind === "session_completed" &&
                    step.payload &&
                    step.payload.status === "failed"
                  ? "error"
                  : step.kind === "session_completed"
                    ? "success"
                    : "info";
            return {
              id: `step-${step.id}`,
              type: step.kind,
              title: step.title,
              detail: step.detail,
              timestamp: step.created_at,
              level,
              stream: "system"
            };
          })
        : fallbackLifecycleEvents;

    const events = [
      ...lifecycleEvents,
      ...interventions.map<AgentSessionTimelineEvent>((intervention) => ({
        id: `intervention-${intervention.id}`,
        type: "intervention",
        title: intervention.title,
        detail: intervention.detail,
        timestamp: intervention.created_at,
        level: intervention.kind === "cancel_requested" ? "warning" : "info",
        stream: "system"
      })),
      ...this.parseLogEvents(session)
    ];

    return events.sort((left, right) => {
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
}
