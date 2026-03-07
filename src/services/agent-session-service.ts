import type {
  ActionAgentType,
  ActionRunRecord,
  AgentSessionOrigin,
  AgentSessionRecord,
  AgentSessionSourceType,
  AgentSessionStatus
} from "../types";

export type AgentSessionTimelineEvent = {
  id: string;
  type:
    | "session_created"
    | "run_queued"
    | "run_claimed"
    | "session_started"
    | "log"
    | "session_completed"
    | "session_cancelled";
  title: string;
  detail: string | null;
  timestamp: number | null;
  level: "info" | "success" | "warning" | "error";
  stream: "system" | "stdout" | "stderr" | "error" | null;
};

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
    | "workflow_id"
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

export class AgentSessionService {
  constructor(private readonly db: D1Database) {}

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

  private buildBranchRef(sessionId: string): string {
    return `refs/heads/agent/${sessionId}`;
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
    let section: "stdout" | "stderr" | "error" | null = null;
    const baseTimestamp = run.started_at ?? session.started_at ?? run.created_at ?? session.created_at;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed === "[stdout]") {
        section = "stdout";
        continue;
      }
      if (trimmed === "[stderr]") {
        section = "stderr";
        continue;
      }
      if (trimmed === "[error]" || trimmed === "[runner_error]") {
        section = "error";
        continue;
      }
      if (section === null) {
        continue;
      }

      const timestamp = baseTimestamp !== null ? baseTimestamp + logEvents.length : null;
      logEvents.push({
        id: `${session.id}-log-${logEvents.length}`,
        type: "log",
        title:
          section === "stdout"
            ? "stdout"
            : section === "stderr"
              ? "stderr"
              : "runner error",
        detail: line,
        timestamp,
        level: section === "stdout" ? "info" : "error",
        stream: section
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

  buildTimeline(input: {
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

    if (run) {
      events.push(...this.parseRunLogEvents(session, run));
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
      return created;
    }

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

    return this.createSession({
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
  }

  async cancelSession(input: {
    repositoryId: string;
    sessionId: string;
    completedAt?: number;
    updatedAt?: number;
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

    return this.findSessionById(input.repositoryId, input.sessionId);
  }
}
