import type {
  ActionAgentType,
  ActionContainerInstanceType,
  ActionsGlobalConfig,
  RepositoryActionsConfig,
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
          agent_type,
          prompt,
          push_branch_regex,
          push_tag_regex,
          enabled,
          created_by,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.repositoryId,
        input.name,
        input.triggerEvent,
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

}
