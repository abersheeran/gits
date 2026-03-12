import type {
  ActionAgentType,
  ActionContainerInstanceType,
  ActionRunRecord,
  ActionRunSourceType,
  ActionRunStatus,
  ActionsGlobalConfig,
  RepositoryActionsConfig,
  ActionWorkflowRecord,
  ActionWorkflowTrigger
} from "../types";
import { AgentSessionService } from "./agent-session-service";

type GlobalSettingsKey =
  | "actions.codex.config_file_content"
  | "actions.claude_code.config_file_content";

type GlobalSettingsRow = {
  key: GlobalSettingsKey;
  value: string;
  updated_at: number;
};

type RepositoryActionsConfigRow = {
  repository_id: string;
  instance_type: ActionContainerInstanceType | null;
  codex_config_file_content: string | null;
  claude_code_config_file_content: string | null;
  updated_at: number;
};

const GLOBAL_SETTING_KEYS: readonly GlobalSettingsKey[] = [
  "actions.codex.config_file_content",
  "actions.claude_code.config_file_content"
];

export class ActionsService {
  constructor(private readonly db: D1Database) {}

  private get agentSessionService(): AgentSessionService {
    return new AgentSessionService(this.db);
  }

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

  private async findRepositoryConfigRow(
    repositoryId: string
  ): Promise<RepositoryActionsConfigRow | null> {
    const row = await this.db
      .prepare(
        `SELECT
          repository_id,
          instance_type,
          codex_config_file_content,
          claude_code_config_file_content,
          updated_at
         FROM repository_actions_configs
         WHERE repository_id = ?
         LIMIT 1`
      )
      .bind(repositoryId)
      .first<RepositoryActionsConfigRow>();

    return row ?? null;
  }

  async getRepositoryConfig(repositoryId: string): Promise<RepositoryActionsConfig> {
    const [globalConfig, repositoryConfig] = await Promise.all([
      this.getGlobalConfig(),
      this.findRepositoryConfigRow(repositoryId)
    ]);

    const inheritsGlobalCodexConfig =
      repositoryConfig === null || repositoryConfig.codex_config_file_content === null;
    const inheritsGlobalClaudeCodeConfig =
      repositoryConfig === null || repositoryConfig.claude_code_config_file_content === null;

    return {
      instanceType: repositoryConfig?.instance_type ?? "lite",
      codexConfigFileContent:
        repositoryConfig?.codex_config_file_content ?? globalConfig.codexConfigFileContent,
      claudeCodeConfigFileContent:
        repositoryConfig?.claude_code_config_file_content ?? globalConfig.claudeCodeConfigFileContent,
      inheritsGlobalCodexConfig,
      inheritsGlobalClaudeCodeConfig,
      updated_at: repositoryConfig?.updated_at ?? globalConfig.updated_at
    };
  }

  async updateRepositoryConfig(
    repositoryId: string,
    patch: {
      instanceType?: ActionContainerInstanceType | null;
      codexConfigFileContent?: string | null;
      claudeCodeConfigFileContent?: string | null;
    }
  ): Promise<RepositoryActionsConfig> {
    const existing = await this.findRepositoryConfigRow(repositoryId);
    const nextInstanceType =
      patch.instanceType !== undefined
        ? patch.instanceType
        : (existing?.instance_type ?? null);
    const nextCodexConfigFileContent =
      patch.codexConfigFileContent !== undefined
        ? patch.codexConfigFileContent
        : (existing?.codex_config_file_content ?? null);
    const nextClaudeCodeConfigFileContent =
      patch.claudeCodeConfigFileContent !== undefined
        ? patch.claudeCodeConfigFileContent
        : (existing?.claude_code_config_file_content ?? null);

    if (
      nextInstanceType === null &&
      nextCodexConfigFileContent === null &&
      nextClaudeCodeConfigFileContent === null
    ) {
      await this.db
        .prepare(`DELETE FROM repository_actions_configs WHERE repository_id = ?`)
        .bind(repositoryId)
        .run();
      return this.getRepositoryConfig(repositoryId);
    }

    await this.db
      .prepare(
        `INSERT INTO repository_actions_configs (
          repository_id,
          instance_type,
          codex_config_file_content,
          claude_code_config_file_content,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(repository_id)
        DO UPDATE SET
          instance_type = excluded.instance_type,
          codex_config_file_content = excluded.codex_config_file_content,
          claude_code_config_file_content = excluded.claude_code_config_file_content,
          updated_at = excluded.updated_at`
      )
      .bind(
        repositoryId,
        nextInstanceType,
        nextCodexConfigFileContent,
        nextClaudeCodeConfigFileContent,
        Date.now()
      )
      .run();

    return this.getRepositoryConfig(repositoryId);
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

  private mapSessionAsRun(session: ActionRunRecord): ActionRunRecord {
    const triggerSourceType =
      session.source_type === "manual" ? null : (session.source_type as ActionRunSourceType);
    return {
      ...session,
      run_number: session.run_number ?? session.session_number,
      trigger_source_type: session.trigger_source_type ?? triggerSourceType,
      trigger_source_number: session.trigger_source_number ?? session.source_number,
      trigger_source_comment_id: session.trigger_source_comment_id ?? session.source_comment_id,
      linked_run_id: session.linked_run_id ?? null,
      triggered_by: session.triggered_by ?? session.created_by,
      triggered_by_username: session.triggered_by_username ?? session.created_by_username
    };
  }

  private mapSessionsAsRuns(sessions: ActionRunRecord[]): ActionRunRecord[] {
    return sessions.map((session) => this.mapSessionAsRun(session));
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
    instanceType: ActionContainerInstanceType;
    prompt: string;
  }): Promise<ActionRunRecord> {
    const session = await this.agentSessionService.createSessionExecution({
      repositoryId: input.repositoryId,
      sourceType: input.triggerSourceType ?? "manual",
      sourceNumber: input.triggerSourceNumber ?? null,
      sourceCommentId: input.triggerSourceCommentId ?? null,
      origin: input.triggerEvent === "mention_actions" ? "mention" : "workflow",
      agentType: input.agentType,
      instanceType: input.instanceType,
      prompt: input.prompt,
      triggerRef: input.triggerRef ?? null,
      triggerSha: input.triggerSha ?? null,
      workflowId: input.workflowId,
      createdBy: input.triggeredBy ?? null,
      delegatedFromUserId: input.triggeredBy ?? null
    });
    return this.mapSessionAsRun(session);
  }

  async listRuns(repositoryId: string, limit = 30): Promise<ActionRunRecord[]> {
    return this.mapSessionsAsRuns(
      await this.agentSessionService.listSessions({ repositoryId, limit })
    );
  }

  async findRunById(repositoryId: string, runId: string): Promise<ActionRunRecord | null> {
    const session = await this.agentSessionService.findSessionById(repositoryId, runId);
    return session ? this.mapSessionAsRun(session) : null;
  }

  async claimQueuedRun(
    repositoryId: string,
    runId: string,
    containerInstance: string
  ): Promise<number | null> {
    return this.agentSessionService.claimQueuedSession(repositoryId, runId, containerInstance);
  }

  async updateRunToRunning(
    repositoryId: string,
    runId: string,
    containerInstance: string
  ): Promise<number | null> {
    return this.agentSessionService.updateSessionToRunning(repositoryId, runId, containerInstance);
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
    await this.agentSessionService.completeSession(repositoryId, runId, input);
  }

  async updateRunningRunLogs(repositoryId: string, runId: string, logs: string): Promise<boolean> {
    return this.agentSessionService.updateRunningSessionLogs(repositoryId, runId, logs);
  }

  async replaceRunLogs(repositoryId: string, runId: string, logs: string): Promise<void> {
    await this.agentSessionService.replaceSessionLogs(repositoryId, runId, logs);
  }

  async failPendingRunIfStillPending(
    repositoryId: string,
    runId: string,
    input: {
      logs: string;
      exitCode?: number | null;
      completedAt?: number;
    }
  ): Promise<{ updated: boolean; completedAt: number }> {
    return this.agentSessionService.failPendingSessionIfStillPending(repositoryId, runId, input);
  }

  async cancelQueuedRun(
    repositoryId: string,
    runId: string
  ): Promise<{ cancelled: boolean; completedAt: number }> {
    return this.agentSessionService.cancelQueuedSession({
      repositoryId,
      sessionId: runId
    });
  }

  async listLatestRunsBySource(
    repositoryId: string,
    sourceType: ActionRunSourceType,
    sourceNumbers: readonly number[]
  ): Promise<ActionRunRecord[]> {
    return this.mapSessionsAsRuns(
      await this.agentSessionService.listLatestSessionsBySource(
        repositoryId,
        sourceType,
        sourceNumbers
      )
    );
  }

  async listLatestRunsByCommentIds(
    repositoryId: string,
    commentIds: readonly string[]
  ): Promise<ActionRunRecord[]> {
    return this.mapSessionsAsRuns(
      await this.agentSessionService.listLatestSessionsByCommentIds(repositoryId, commentIds)
    );
  }
}
