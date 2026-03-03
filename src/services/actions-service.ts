import type {
  ActionAgentType,
  ActionRunRecord,
  ActionRunSourceType,
  ActionRunStatus,
  ActionsGlobalConfig,
  ActionWorkflowRecord,
  ActionWorkflowTrigger
} from "../types";

type GlobalSettingsKey =
  | "actions.codex.config_file_content"
  | "actions.claude_code.config_file_content";

type GlobalSettingsRow = {
  key: GlobalSettingsKey;
  value: string;
  updated_at: number;
};

const GLOBAL_SETTING_KEYS: readonly GlobalSettingsKey[] = [
  "actions.codex.config_file_content",
  "actions.claude_code.config_file_content"
];

export class ActionsService {
  constructor(private readonly db: D1Database) {}

  private normalizeGlobalConfig(rows: GlobalSettingsRow[]): ActionsGlobalConfig {
    const values = new Map<string, string>();
    let updatedAt: number | null = null;
    for (const row of rows) {
      values.set(row.key, row.value);
      updatedAt = updatedAt === null ? row.updated_at : Math.max(updatedAt, row.updated_at);
    }

    return {
      codexConfigFileContent: values.get("actions.codex.config_file_content") ?? "",
      claudeCodeConfigFileContent: values.get("actions.claude_code.config_file_content") ?? "",
      updated_at: updatedAt
    };
  }

  private async loadGlobalSettingsRows(): Promise<GlobalSettingsRow[]> {
    const placeholders = GLOBAL_SETTING_KEYS.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `SELECT key, value, updated_at
         FROM global_settings
         WHERE key IN (${placeholders})`
      )
      .bind(...GLOBAL_SETTING_KEYS)
      .all<GlobalSettingsRow>();

    return rows.results;
  }

  private async upsertGlobalSetting(key: GlobalSettingsKey, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO global_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(key, value, Date.now())
      .run();
  }

  async getGlobalConfig(): Promise<ActionsGlobalConfig> {
    const rows = await this.loadGlobalSettingsRows();
    return this.normalizeGlobalConfig(rows);
  }

  async updateGlobalConfig(patch: {
    codexConfigFileContent?: string | null;
    claudeCodeConfigFileContent?: string | null;
  }): Promise<ActionsGlobalConfig> {
    if (patch.codexConfigFileContent !== undefined) {
      if (patch.codexConfigFileContent === null) {
        await this.db
          .prepare(`DELETE FROM global_settings WHERE key = ?`)
          .bind("actions.codex.config_file_content")
          .run();
      } else {
        await this.upsertGlobalSetting(
          "actions.codex.config_file_content",
          patch.codexConfigFileContent
        );
      }
    }

    if (patch.claudeCodeConfigFileContent !== undefined) {
      if (patch.claudeCodeConfigFileContent === null) {
        await this.db
          .prepare(`DELETE FROM global_settings WHERE key = ?`)
          .bind("actions.claude_code.config_file_content")
          .run();
      } else {
        await this.upsertGlobalSetting(
          "actions.claude_code.config_file_content",
          patch.claudeCodeConfigFileContent
        );
      }
    }

    return this.getGlobalConfig();
  }

  async listWorkflows(repositoryId: string): Promise<ActionWorkflowRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          repository_id,
          name,
          trigger_event,
          agent_type,
          prompt,
          push_branch_regex,
          push_tag_regex,
          enabled,
          created_by,
          created_at,
          updated_at
         FROM action_workflows
         WHERE repository_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .bind(repositoryId)
      .all<ActionWorkflowRecord>();

    return rows.results;
  }

  async listEnabledWorkflowsByEvent(
    repositoryId: string,
    triggerEvent: ActionWorkflowTrigger
  ): Promise<ActionWorkflowRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT
          id,
          repository_id,
          name,
          trigger_event,
          agent_type,
          prompt,
          push_branch_regex,
          push_tag_regex,
          enabled,
          created_by,
          created_at,
          updated_at
         FROM action_workflows
         WHERE repository_id = ? AND trigger_event = ? AND enabled = 1
         ORDER BY updated_at DESC, created_at DESC`
      )
      .bind(repositoryId, triggerEvent)
      .all<ActionWorkflowRecord>();

    return rows.results;
  }

  async findWorkflowById(
    repositoryId: string,
    workflowId: string
  ): Promise<ActionWorkflowRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          id,
          repository_id,
          name,
          trigger_event,
          agent_type,
          prompt,
          push_branch_regex,
          push_tag_regex,
          enabled,
          created_by,
          created_at,
          updated_at
         FROM action_workflows
         WHERE repository_id = ? AND id = ?
         LIMIT 1`
      )
      .bind(repositoryId, workflowId)
      .first<ActionWorkflowRecord>();

    return row ?? null;
  }

  async createWorkflow(input: {
    repositoryId: string;
    name: string;
    triggerEvent: ActionWorkflowTrigger;
    agentType: ActionAgentType;
    prompt: string;
    pushBranchRegex: string | null;
    pushTagRegex: string | null;
    enabled: boolean;
    createdBy: string;
  }): Promise<ActionWorkflowRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO action_workflows (
          id,
          repository_id,
          name,
          trigger_event,
          command,
          agent_type,
          prompt,
          push_branch_regex,
          push_tag_regex,
          enabled,
          created_by,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.repositoryId,
        input.name,
        input.triggerEvent,
        input.prompt,
        input.agentType,
        input.prompt,
        input.triggerEvent === "push" ? input.pushBranchRegex : null,
        input.triggerEvent === "push" ? input.pushTagRegex : null,
        input.enabled ? 1 : 0,
        input.createdBy,
        now,
        now
      )
      .run();

    const created = await this.findWorkflowById(input.repositoryId, id);
    if (!created) {
      throw new Error("Created workflow not found");
    }
    return created;
  }

  async updateWorkflow(
    repositoryId: string,
    workflowId: string,
    patch: {
      name?: string;
      triggerEvent?: ActionWorkflowTrigger;
      agentType?: ActionAgentType;
      prompt?: string;
      pushBranchRegex?: string | null;
      pushTagRegex?: string | null;
      enabled?: boolean;
    }
  ): Promise<ActionWorkflowRecord | null> {
    const existing = await this.findWorkflowById(repositoryId, workflowId);
    if (!existing) {
      return null;
    }

    const nextTriggerEvent = patch.triggerEvent ?? existing.trigger_event;
    const nextPrompt = patch.prompt ?? existing.prompt;
    const nextPushBranchRegex =
      nextTriggerEvent === "push"
        ? (patch.pushBranchRegex !== undefined
            ? patch.pushBranchRegex
            : existing.push_branch_regex)
        : null;
    const nextPushTagRegex =
      nextTriggerEvent === "push"
        ? (patch.pushTagRegex !== undefined ? patch.pushTagRegex : existing.push_tag_regex)
        : null;

    await this.db
      .prepare(
        `UPDATE action_workflows
         SET name = ?,
             trigger_event = ?,
             command = ?,
             agent_type = ?,
             prompt = ?,
             push_branch_regex = ?,
             push_tag_regex = ?,
             enabled = ?,
             updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(
        patch.name ?? existing.name,
        nextTriggerEvent,
        nextPrompt,
        patch.agentType ?? existing.agent_type,
        nextPrompt,
        nextPushBranchRegex,
        nextPushTagRegex,
        patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
        Date.now(),
        repositoryId,
        workflowId
      )
      .run();

    return this.findWorkflowById(repositoryId, workflowId);
  }

  private async nextActionRunNumber(repositoryId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO repository_counters (repository_id, issue_number_seq, pull_number_seq, action_run_seq)
         VALUES (?, 0, 0, 1)
         ON CONFLICT(repository_id)
         DO UPDATE SET action_run_seq = action_run_seq + 1
         RETURNING action_run_seq AS run_number`
      )
      .bind(repositoryId)
      .first<{ run_number: number }>();

    if (!row) {
      throw new Error("Unable to allocate action run number");
    }
    return row.run_number;
  }

  async createRun(input: {
    repositoryId: string;
    workflowId: string;
    triggerEvent: ActionWorkflowTrigger;
    triggerRef?: string;
    triggerSha?: string;
    triggerSourceType?: ActionRunSourceType | null;
    triggerSourceNumber?: number | null;
    triggerSourceCommentId?: string | null;
    triggeredBy?: string;
    agentType: ActionAgentType;
    prompt: string;
  }): Promise<ActionRunRecord> {
    const runNumber = await this.nextActionRunNumber(input.repositoryId);
    const id = crypto.randomUUID();
    const now = Date.now();

    await this.db
      .prepare(
        `INSERT INTO action_runs (
          id,
          repository_id,
          run_number,
          workflow_id,
          trigger_event,
          trigger_ref,
          trigger_sha,
          trigger_source_type,
          trigger_source_number,
          trigger_source_comment_id,
          triggered_by,
          status,
          command,
          agent_type,
          prompt,
          logs,
          exit_code,
          container_instance,
          created_at,
          started_at,
          completed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.repositoryId,
        runNumber,
        input.workflowId,
        input.triggerEvent,
        input.triggerRef ?? null,
        input.triggerSha ?? null,
        input.triggerSourceType ?? null,
        input.triggerSourceNumber ?? null,
        input.triggerSourceCommentId ?? null,
        input.triggeredBy ?? null,
        "queued",
        input.prompt,
        input.agentType,
        input.prompt,
        "",
        null,
        null,
        now,
        null,
        null,
        now
      )
      .run();

    const created = await this.findRunById(input.repositoryId, id);
    if (!created) {
      throw new Error("Created action run not found");
    }
    return created;
  }

  async listRuns(repositoryId: string, limit = 30): Promise<ActionRunRecord[]> {
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db
      .prepare(
        `SELECT
          r.id,
          r.repository_id,
          r.run_number,
          r.workflow_id,
          w.name AS workflow_name,
          r.trigger_event,
          r.trigger_ref,
          r.trigger_sha,
          r.trigger_source_type,
          r.trigger_source_number,
          r.trigger_source_comment_id,
          r.triggered_by,
          u.username AS triggered_by_username,
          r.status,
          r.agent_type,
          r.prompt,
          r.logs,
          r.exit_code,
          r.container_instance,
          r.created_at,
          r.started_at,
          r.completed_at,
          r.updated_at
         FROM action_runs r
         JOIN action_workflows w ON w.id = r.workflow_id
         LEFT JOIN users u ON u.id = r.triggered_by
         WHERE r.repository_id = ?
         ORDER BY r.run_number DESC
         LIMIT ?`
      )
      .bind(repositoryId, normalizedLimit)
      .all<ActionRunRecord>();

    return rows.results;
  }

  async findRunById(repositoryId: string, runId: string): Promise<ActionRunRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT
          r.id,
          r.repository_id,
          r.run_number,
          r.workflow_id,
          w.name AS workflow_name,
          r.trigger_event,
          r.trigger_ref,
          r.trigger_sha,
          r.trigger_source_type,
          r.trigger_source_number,
          r.trigger_source_comment_id,
          r.triggered_by,
          u.username AS triggered_by_username,
          r.status,
          r.agent_type,
          r.prompt,
          r.logs,
          r.exit_code,
          r.container_instance,
          r.created_at,
          r.started_at,
          r.completed_at,
          r.updated_at
         FROM action_runs r
         JOIN action_workflows w ON w.id = r.workflow_id
         LEFT JOIN users u ON u.id = r.triggered_by
         WHERE r.repository_id = ? AND r.id = ?
         LIMIT 1`
      )
      .bind(repositoryId, runId)
      .first<ActionRunRecord>();

    return row ?? null;
  }

  async updateRunToRunning(repositoryId: string, runId: string, containerInstance: string): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `UPDATE action_runs
         SET status = 'running', container_instance = ?, started_at = ?, updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(containerInstance, now, now, repositoryId, runId)
      .run();
  }

  async completeRun(
    repositoryId: string,
    runId: string,
    input: {
      status: Extract<ActionRunStatus, "success" | "failed" | "cancelled">;
      logs: string;
      exitCode?: number | null;
    }
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `UPDATE action_runs
         SET status = ?, logs = ?, exit_code = ?, completed_at = ?, updated_at = ?
         WHERE repository_id = ? AND id = ?`
      )
      .bind(input.status, input.logs, input.exitCode ?? null, now, now, repositoryId, runId)
      .run();
  }

  async listLatestRunsBySource(
    repositoryId: string,
    sourceType: ActionRunSourceType,
    sourceNumbers: readonly number[]
  ): Promise<ActionRunRecord[]> {
    if (sourceNumbers.length === 0) {
      return [];
    }
    const uniqueSourceNumbers = Array.from(new Set(sourceNumbers)).sort((a, b) => a - b);
    const placeholders = uniqueSourceNumbers.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `SELECT
          r.id,
          r.repository_id,
          r.run_number,
          r.workflow_id,
          w.name AS workflow_name,
          r.trigger_event,
          r.trigger_ref,
          r.trigger_sha,
          r.trigger_source_type,
          r.trigger_source_number,
          r.trigger_source_comment_id,
          r.triggered_by,
          u.username AS triggered_by_username,
          r.status,
          r.agent_type,
          r.prompt,
          r.logs,
          r.exit_code,
          r.container_instance,
          r.created_at,
          r.started_at,
          r.completed_at,
          r.updated_at
         FROM action_runs r
         JOIN action_workflows w ON w.id = r.workflow_id
         LEFT JOIN users u ON u.id = r.triggered_by
         JOIN (
           SELECT trigger_source_number, MAX(run_number) AS max_run_number
           FROM action_runs
           WHERE repository_id = ?
             AND trigger_source_type = ?
             AND trigger_source_number IN (${placeholders})
           GROUP BY trigger_source_number
         ) latest
           ON latest.trigger_source_number = r.trigger_source_number
          AND latest.max_run_number = r.run_number
         WHERE r.repository_id = ?
           AND r.trigger_source_type = ?
         ORDER BY r.trigger_source_number ASC`
      )
      .bind(
        repositoryId,
        sourceType,
        ...uniqueSourceNumbers,
        repositoryId,
        sourceType
      )
      .all<ActionRunRecord>();

    return rows.results;
  }

  async listLatestRunsByCommentIds(
    repositoryId: string,
    commentIds: readonly string[]
  ): Promise<ActionRunRecord[]> {
    if (commentIds.length === 0) {
      return [];
    }
    const uniqueCommentIds = Array.from(new Set(commentIds));
    const placeholders = uniqueCommentIds.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `SELECT
          r.id,
          r.repository_id,
          r.run_number,
          r.workflow_id,
          w.name AS workflow_name,
          r.trigger_event,
          r.trigger_ref,
          r.trigger_sha,
          r.trigger_source_type,
          r.trigger_source_number,
          r.trigger_source_comment_id,
          r.triggered_by,
          u.username AS triggered_by_username,
          r.status,
          r.agent_type,
          r.prompt,
          r.logs,
          r.exit_code,
          r.container_instance,
          r.created_at,
          r.started_at,
          r.completed_at,
          r.updated_at
         FROM action_runs r
         JOIN action_workflows w ON w.id = r.workflow_id
         LEFT JOIN users u ON u.id = r.triggered_by
         JOIN (
           SELECT trigger_source_comment_id, MAX(run_number) AS max_run_number
           FROM action_runs
           WHERE repository_id = ?
             AND trigger_source_comment_id IS NOT NULL
             AND trigger_source_comment_id IN (${placeholders})
           GROUP BY trigger_source_comment_id
         ) latest
           ON latest.trigger_source_comment_id = r.trigger_source_comment_id
          AND latest.max_run_number = r.run_number
         WHERE r.repository_id = ?
           AND r.trigger_source_comment_id IS NOT NULL
         ORDER BY r.run_number DESC`
      )
      .bind(repositoryId, ...uniqueCommentIds, repositoryId)
      .all<ActionRunRecord>();

    return rows.results;
  }
}
