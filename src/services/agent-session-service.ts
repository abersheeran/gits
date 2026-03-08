import type {
  ActionAgentType,
  ActionRunRecord,
  AgentSessionArtifactKind,
  AgentSessionArtifactRecord,
  AgentSessionInterventionKind,
  AgentSessionInterventionRecord,
  AgentSessionOrigin,
  AgentSessionRecord,
  AgentSessionStepKind,
  AgentSessionStepRecord,
  AgentSessionSourceType,
  AgentSessionStatus,
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
    | "run_queued"
    | "run_claimed"
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
  source_type: AgentSessionSourceType;
  source_number: number | null;
  source_comment_id: string | null;
  origin: AgentSessionOrigin;
  status: AgentSessionStatus;
  agent_type: ActionAgentType;
  prompt: string;
  branch_ref: string | null;
  trigger_ref: string | null;
  trigger_sha: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  linked_run_id: string | null;
  created_by: string | null;
  created_by_username: string | null;
  delegated_from_user_id: string | null;
  delegated_from_username: string | null;
  created_at: number;
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
  prompt: string;
  triggerRef?: string | null;
  triggerSha?: string | null;
  workflowId?: string | null;
  linkedRunId?: string | null;
  createdBy?: string | null;
  delegatedFromUserId?: string | null;
};

export type CreateAgentSessionForRunInput = {
  repositoryId: string;
  run: Pick<
    ActionRunRecord,
    | "id"
    | "run_number"
    | "workflow_id"
    | "workflow_name"
    | "trigger_source_type"
    | "trigger_source_number"
    | "trigger_source_comment_id"
    | "agent_type"
    | "prompt"
    | "trigger_ref"
    | "trigger_sha"
  >;
  origin: AgentSessionOrigin;
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
  return kind === "run_logs" || kind === "stdout" || kind === "stderr";
}

export class AgentSessionService {
  constructor(
    private readonly db: D1Database,
    private readonly logStorage: ActionLogStorageService | null = null
  ) {}

  private mapRow(row: AgentSessionRow): AgentSessionRecord {
    return {
      id: row.id,
      repository_id: row.repository_id,
      source_type: row.source_type,
      source_number: row.source_number,
      source_comment_id: row.source_comment_id,
      origin: row.origin,
      status: row.status,
      agent_type: row.agent_type,
      prompt: row.prompt,
      branch_ref: row.branch_ref,
      trigger_ref: row.trigger_ref,
      trigger_sha: row.trigger_sha,
      workflow_id: row.workflow_id,
      workflow_name: row.workflow_name,
      linked_run_id: row.linked_run_id,
      created_by: row.created_by,
      created_by_username: row.created_by_username,
      delegated_from_user_id: row.delegated_from_user_id,
      delegated_from_username: row.delegated_from_username,
      created_at: row.created_at,
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

  private mapInterventionRow(
    row: AgentSessionInterventionRow
  ): AgentSessionInterventionRecord {
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

  private buildDerivedLifecycleEvents(input: {
    session: AgentSessionRecord;
    run: ActionRunRecord | null;
  }): AgentSessionTimelineEvent[] {
    const { session, run } = input;
    const actorLabel = session.created_by_username ?? "system";
    const sourceLabel =
      session.source_number !== null
        ? `${session.source_type} #${session.source_number}`
        : session.source_type;

    const events: AgentSessionTimelineEvent[] = [
      {
        id: `${session.id}-created`,
        type: "session_created",
        title: "Session created",
        detail: `${sourceLabel} · ${session.origin} · ${actorLabel}`,
        timestamp: session.created_at,
        level: "info",
        stream: "system"
      }
    ];

    if (run) {
      events.push({
        id: `${session.id}-run-queued`,
        type: "run_queued",
        title: `Linked run #${run.run_number} queued`,
        detail: `${run.workflow_name} · ${run.status}`,
        timestamp: run.created_at,
        level: "info",
        stream: "system"
      });
    }

    if (run?.claimed_at) {
      events.push({
        id: `${session.id}-run-claimed`,
        type: "run_claimed",
        title: "Runner claimed queued run",
        detail: run.container_instance ? `container: ${run.container_instance}` : null,
        timestamp: run.claimed_at,
        level: "info",
        stream: "system"
      });
    }

    const startedAt = session.started_at ?? run?.started_at ?? null;
    if (startedAt) {
      events.push({
        id: `${session.id}-started`,
        type: "session_started",
        title: "Session started",
        detail: session.branch_ref ?? run?.trigger_ref ?? null,
        timestamp: startedAt,
        level: "info",
        stream: "system"
      });
    }

    const completedAt = session.completed_at ?? run?.completed_at ?? null;
    if (completedAt) {
      const cancelled = session.status === "cancelled";
      const failed = session.status === "failed";
      events.push({
        id: `${session.id}-completed`,
        type: cancelled ? "session_cancelled" : "session_completed",
        title: cancelled
          ? "Session cancelled"
          : failed
            ? "Session failed"
            : "Session completed",
        detail:
          run?.exit_code !== null && run?.exit_code !== undefined
            ? `exit code: ${run.exit_code}`
            : session.status,
        timestamp: completedAt,
        level: cancelled ? "warning" : failed ? "error" : "success",
        stream: "system"
      });
    }

    return events;
  }

  private parseRunLogEvents(
    session: AgentSessionRecord,
    run: ActionRunRecord
  ): AgentSessionTimelineEvent[] {
    if (!run.logs.trim()) {
      return [];
    }

    const lines = run.logs.split(/\r?\n/);
    const logEvents: AgentSessionTimelineEvent[] = [];
    let section: string | null = null;
    const baseTimestamp = run.started_at ?? session.started_at ?? run.created_at ?? session.created_at;

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
      if (section === null) {
        continue;
      }
      if (!TIMELINE_SYSTEM_LOG_SECTIONS.has(section) && !TIMELINE_ERROR_LOG_SECTIONS.has(section)) {
        continue;
      }

      const timestamp = baseTimestamp !== null ? baseTimestamp + logEvents.length : null;
      const isErrorSection = TIMELINE_ERROR_LOG_SECTIONS.has(section);
      logEvents.push({
        id: `${session.id}-log-${logEvents.length}`,
        type: "log",
        title: section.replaceAll("_", " "),
        detail: line,
        timestamp,
        level: isErrorSection ? "error" : section === "mcp_setup" ? "warning" : "info",
        stream: isErrorSection ? "error" : "system"
      });
    }

    return logEvents;
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
        `SELECT
          s.id,
          s.repository_id,
          s.source_type,
          s.source_number,
          s.source_comment_id,
          s.origin,
          s.status,
          s.agent_type,
          s.prompt,
          s.branch_ref,
          s.trigger_ref,
          s.trigger_sha,
          s.workflow_id,
          w.name AS workflow_name,
          s.linked_run_id,
          s.created_by,
          created_by_user.username AS created_by_username,
          s.delegated_from_user_id,
          delegated_user.username AS delegated_from_username,
          s.created_at,
          s.started_at,
          s.completed_at,
          s.updated_at
         FROM agent_sessions s
         LEFT JOIN action_workflows w ON w.id = s.workflow_id
         LEFT JOIN users created_by_user ON created_by_user.id = s.created_by
         LEFT JOIN users delegated_user ON delegated_user.id = s.delegated_from_user_id
         WHERE ${whereClauses.join(" AND ")}
         ORDER BY s.created_at DESC
         LIMIT ?`
      )
      .bind(...params, limit)
      .all<AgentSessionRow>();

    return rows.results;
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

    const placeholders = Array.from(new Set(sourceNumbers)).map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `SELECT
          s.id,
          s.repository_id,
          s.source_type,
          s.source_number,
          s.source_comment_id,
          s.origin,
          s.status,
          s.agent_type,
          s.prompt,
          s.branch_ref,
          s.trigger_ref,
          s.trigger_sha,
          s.workflow_id,
          w.name AS workflow_name,
          s.linked_run_id,
          s.created_by,
          created_by_user.username AS created_by_username,
          s.delegated_from_user_id,
          delegated_user.username AS delegated_from_username,
          s.created_at,
          s.started_at,
          s.completed_at,
          s.updated_at
         FROM agent_sessions s
         LEFT JOIN action_workflows w ON w.id = s.workflow_id
         LEFT JOIN users created_by_user ON created_by_user.id = s.created_by
         LEFT JOIN users delegated_user ON delegated_user.id = s.delegated_from_user_id
         WHERE s.repository_id = ?
           AND s.source_type = ?
           AND s.source_number IN (${placeholders})
         ORDER BY s.created_at DESC`
      )
      .bind(repositoryId, sourceType, ...Array.from(new Set(sourceNumbers)))
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

  async findSessionById(
    repositoryId: string,
    sessionId: string
  ): Promise<AgentSessionRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          s.id,
          s.repository_id,
          s.source_type,
          s.source_number,
          s.source_comment_id,
          s.origin,
          s.status,
          s.agent_type,
          s.prompt,
          s.branch_ref,
          s.trigger_ref,
          s.trigger_sha,
          s.workflow_id,
          w.name AS workflow_name,
          s.linked_run_id,
          s.created_by,
          created_by_user.username AS created_by_username,
          s.delegated_from_user_id,
          delegated_user.username AS delegated_from_username,
          s.created_at,
          s.started_at,
          s.completed_at,
          s.updated_at
         FROM agent_sessions s
         LEFT JOIN action_workflows w ON w.id = s.workflow_id
         LEFT JOIN users created_by_user ON created_by_user.id = s.created_by
         LEFT JOIN users delegated_user ON delegated_user.id = s.delegated_from_user_id
         WHERE s.repository_id = ? AND s.id = ?
         LIMIT 1`
      )
      .bind(repositoryId, sessionId)
      .first<AgentSessionRow>();

    return row ? this.mapRow(row) : null;
  }

  async findSessionByRunId(
    repositoryId: string,
    runId: string
  ): Promise<AgentSessionRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          s.id,
          s.repository_id,
          s.source_type,
          s.source_number,
          s.source_comment_id,
          s.origin,
          s.status,
          s.agent_type,
          s.prompt,
          s.branch_ref,
          s.trigger_ref,
          s.trigger_sha,
          s.workflow_id,
          w.name AS workflow_name,
          s.linked_run_id,
          s.created_by,
          created_by_user.username AS created_by_username,
          s.delegated_from_user_id,
          delegated_user.username AS delegated_from_username,
          s.created_at,
          s.started_at,
          s.completed_at,
          s.updated_at
         FROM agent_sessions s
         LEFT JOIN action_workflows w ON w.id = s.workflow_id
         LEFT JOIN users created_by_user ON created_by_user.id = s.created_by
         LEFT JOIN users delegated_user ON delegated_user.id = s.delegated_from_user_id
         WHERE s.repository_id = ? AND s.linked_run_id = ?
         LIMIT 1`
      )
      .bind(repositoryId, runId)
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
      const content = await this.logStorage.readSessionArtifactLogs(
        repositoryId,
        sessionId,
        artifact.kind
      );
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

  async recordRunClaimed(input: {
    repositoryId: string;
    runId: string;
    containerInstance?: string | null;
    claimedAt?: number;
  }): Promise<void> {
    const session = await this.findSessionByRunId(input.repositoryId, input.runId);
    if (!session) {
      return;
    }

    await this.insertStep({
      sessionId: session.id,
      repositoryId: input.repositoryId,
      kind: "run_claimed",
      title: "Runner claimed queued run",
      detail: input.containerInstance ? `container: ${input.containerInstance}` : null,
      payload: {
        runId: input.runId,
        ...(input.containerInstance ? { containerInstance: input.containerInstance } : {})
      },
      ...(input.claimedAt !== undefined ? { createdAt: input.claimedAt } : {})
    });
  }

  buildTimeline(input: {
    session: AgentSessionRecord;
    run: ActionRunRecord | null;
    steps?: AgentSessionStepRecord[];
    interventions?: AgentSessionInterventionRecord[];
  }): AgentSessionTimelineEvent[] {
    const { session, run, steps = [], interventions = [] } = input;
    const lifecycleEvents =
      steps.length > 0
        ? steps.map<AgentSessionTimelineEvent>((step) => ({
            id: `step-${step.id}`,
            type:
              step.kind === "session_cancelled"
                ? "session_cancelled"
                : step.kind === "session_completed"
                  ? "session_completed"
                  : step.kind,
            title: step.title,
            detail: step.detail,
            timestamp: step.created_at,
            level:
              step.kind === "session_cancelled"
                ? "warning"
                : step.kind === "session_completed" &&
                    step.payload &&
                    step.payload.status === "failed"
                  ? "error"
                  : step.kind === "session_completed"
                    ? "success"
                    : "info",
            stream: "system"
          }))
        : this.buildDerivedLifecycleEvents({ session, run });

    const events = [...lifecycleEvents];

    events.push(
      ...interventions.map<AgentSessionTimelineEvent>((intervention) => ({
        id: `intervention-${intervention.id}`,
        type: "intervention",
        title: intervention.title,
        detail: intervention.detail,
        timestamp: intervention.created_at,
        level: intervention.kind === "cancel_requested" ? "warning" : "info",
        stream: "system"
      }))
    );

    if (run) {
      events.push(...this.parseRunLogEvents(session, run));
    }

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
    const session = await this.findSessionByRunId(input.repositoryId, input.runId);
    if (!session) {
      return;
    }

    const recordedAt = input.recordedAt ?? Date.now();
    const payloadBase = {
      runId: input.runId,
      ...(input.result?.validationReport ? { validationReport: input.result.validationReport } : {})
    };
    const runLogs = input.logs.trim();
    if (runLogs) {
      if (this.logStorage) {
        await this.logStorage.writeRunLogs(input.repositoryId, input.runId, input.logs);
        await this.logStorage.writeSessionArtifactLogs(
          input.repositoryId,
          session.id,
          "run_logs",
          input.logs
        );
      }
      await this.upsertArtifact({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "run_logs",
        title: "Run logs",
        mediaType: "text/plain",
        contentText: buildLogExcerpt(input.logs),
        sizeBytes: input.logs.length,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
      await this.upsertUsageRecord({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "run_log_chars",
        value: input.logs.length,
        unit: "chars",
        detail: "Persisted action run log length",
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
          ...(input.result.attemptedCommand
            ? { attemptedCommand: input.result.attemptedCommand }
            : {})
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
          ...(input.result.attemptedCommand
            ? { attemptedCommand: input.result.attemptedCommand }
            : {}),
          ...(input.result.error ? { runnerError: input.result.error } : {})
        },
        createdAt: recordedAt
      });
    }
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const branchRef = this.buildBranchRef(id);

    await this.db
      .prepare(
        `INSERT INTO agent_sessions (
          id,
          repository_id,
          source_type,
          source_number,
          source_comment_id,
          origin,
          status,
          agent_type,
          prompt,
          branch_ref,
          trigger_ref,
          trigger_sha,
          workflow_id,
          linked_run_id,
          created_by,
          delegated_from_user_id,
          created_at,
          started_at,
          completed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.repositoryId,
        input.sourceType,
        input.sourceNumber ?? null,
        input.sourceCommentId ?? null,
        input.origin,
        input.status ?? "queued",
        input.agentType,
        input.prompt,
        branchRef,
        input.triggerRef ?? null,
        input.triggerSha ?? null,
        input.workflowId ?? null,
        input.linkedRunId ?? null,
        input.createdBy ?? null,
        input.delegatedFromUserId ?? null,
        now,
        null,
        null,
        now
      )
      .run();

    const created = await this.findSessionById(input.repositoryId, id);
    if (created) {
      const sourceLabel =
        created.source_number !== null
          ? `${created.source_type} #${created.source_number}`
          : created.source_type;
      await this.insertStep({
        sessionId: created.id,
        repositoryId: input.repositoryId,
        kind: "session_created",
        title: "Session created",
        detail: `${sourceLabel} · ${created.origin} · ${created.created_by_username ?? "system"}`,
        payload: {
          sourceType: created.source_type,
          sourceNumber: created.source_number,
          origin: created.origin,
          createdBy: created.created_by
        },
        createdAt: now
      });
      return created;
    }

    const sourceLabel =
      input.sourceNumber !== undefined && input.sourceNumber !== null
        ? `${input.sourceType} #${input.sourceNumber}`
        : input.sourceType;
    await this.insertStep({
      sessionId: id,
      repositoryId: input.repositoryId,
      kind: "session_created",
      title: "Session created",
      detail: `${sourceLabel} · ${input.origin} · ${input.createdBy ?? "system"}`,
      payload: {
        sourceType: input.sourceType,
        sourceNumber: input.sourceNumber ?? null,
        origin: input.origin,
        createdBy: input.createdBy ?? null
      },
      createdAt: now
    });

    return {
      id,
      repository_id: input.repositoryId,
      source_type: input.sourceType,
      source_number: input.sourceNumber ?? null,
      source_comment_id: input.sourceCommentId ?? null,
      origin: input.origin,
      status: input.status ?? "queued",
      agent_type: input.agentType,
      prompt: input.prompt,
      branch_ref: branchRef,
      trigger_ref: input.triggerRef ?? null,
      trigger_sha: input.triggerSha ?? null,
      workflow_id: input.workflowId ?? null,
      workflow_name: null,
      linked_run_id: input.linkedRunId ?? null,
      created_by: input.createdBy ?? null,
      created_by_username: null,
      delegated_from_user_id: input.delegatedFromUserId ?? null,
      delegated_from_username: null,
      created_at: now,
      started_at: null,
      completed_at: null,
      updated_at: now
    };
  }

  async createSessionForRun(input: CreateAgentSessionForRunInput): Promise<AgentSessionRecord> {
    const existing = await this.findSessionByRunId(input.repositoryId, input.run.id);
    if (existing) {
      return existing;
    }

    const created = await this.createSession({
      repositoryId: input.repositoryId,
      sourceType: input.run.trigger_source_type ?? "manual",
      sourceNumber: input.run.trigger_source_number ?? null,
      sourceCommentId: input.run.trigger_source_comment_id ?? null,
      origin: input.origin,
      status: "queued",
      agentType: input.run.agent_type,
      prompt: input.run.prompt,
      triggerRef: input.run.trigger_ref,
      triggerSha: input.run.trigger_sha,
      workflowId: input.run.workflow_id,
      linkedRunId: input.run.id,
      createdBy: input.createdBy ?? null,
      delegatedFromUserId: input.delegatedFromUserId ?? input.createdBy ?? null
    });

    await this.insertStep({
      sessionId: created.id,
      repositoryId: input.repositoryId,
      kind: "run_queued",
      title: `Linked run #${input.run.run_number} queued`,
      detail:
        input.run.workflow_name && input.run.workflow_name.trim()
          ? `${input.run.workflow_name} · queued`
          : "queued",
      payload: {
        runId: input.run.id,
        runNumber: input.run.run_number,
        workflowId: input.run.workflow_id,
        workflowName: input.run.workflow_name
      },
      createdAt: created.created_at
    });

    return created;
  }

  async syncSessionForRun(input: {
    repositoryId: string;
    runId: string;
    status: AgentSessionStatus;
    startedAt?: number | null;
    completedAt?: number | null;
    updatedAt?: number;
  }): Promise<void> {
    const updates: string[] = ["status = ?"];
    const params: unknown[] = [input.status];

    if (input.startedAt !== undefined) {
      updates.push("started_at = ?");
      params.push(input.startedAt);
    }
    if (input.completedAt !== undefined) {
      updates.push("completed_at = ?");
      params.push(input.completedAt);
    }
    updates.push("updated_at = ?");
    params.push(input.updatedAt ?? Date.now());

    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET ${updates.join(", ")}
         WHERE repository_id = ? AND linked_run_id = ?`
      )
      .bind(...params, input.repositoryId, input.runId)
      .run();

    const session = await this.findSessionByRunId(input.repositoryId, input.runId);
    if (!session) {
      return;
    }

    if (input.startedAt !== undefined && input.startedAt !== null) {
      await this.insertStep({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: "session_started",
        title: "Session started",
        detail: session.branch_ref ?? session.trigger_ref ?? null,
        payload: {
          runId: input.runId,
          branchRef: session.branch_ref,
          triggerRef: session.trigger_ref
        },
        createdAt: input.startedAt
      });
    }

    if (input.completedAt !== undefined && input.completedAt !== null) {
      const completedStepKind: AgentSessionStepKind =
        input.status === "cancelled" ? "session_cancelled" : "session_completed";
      const completedTitle =
        input.status === "cancelled"
          ? "Session cancelled"
          : input.status === "failed"
            ? "Session failed"
            : "Session completed";
      await this.insertStep({
        sessionId: session.id,
        repositoryId: input.repositoryId,
        kind: completedStepKind,
        title: completedTitle,
        detail: input.status,
        payload: {
          runId: input.runId,
          status: input.status
        },
        createdAt: input.completedAt
      });
    }
  }

  async cancelSession(input: {
    repositoryId: string;
    sessionId: string;
    completedAt?: number;
    updatedAt?: number;
    cancelledBy?: string | null;
  }): Promise<AgentSessionRecord | null> {
    const completedAt = input.completedAt ?? Date.now();
    const updatedAt = input.updatedAt ?? completedAt;
    await this.db
      .prepare(
        `UPDATE agent_sessions
         SET status = 'cancelled',
             completed_at = ?,
             updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(completedAt, updatedAt, input.repositoryId, input.sessionId)
      .run();

    await this.insertStep({
      sessionId: input.sessionId,
      repositoryId: input.repositoryId,
      kind: "session_cancelled",
      title: "Session cancelled",
      detail: "cancelled",
      payload: {
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
          status: "cancelled"
        },
        createdAt: completedAt
      });
    }

    return this.findSessionById(input.repositoryId, input.sessionId);
  }
}
