import type { AgentSessionRecord, RepositoryActionsConfig, RepositoryRecord } from "../types";

export const CODEX_CONFIG_FILE_PATH = "/home/rootless/.codex/config.toml";
export const CLAUDE_CODE_CONFIG_FILE_PATH = "/home/rootless/.claude/settings.json";

export function buildActionRunnerEnv(input: {
  repository: Pick<RepositoryRecord, "id" | "owner_username" | "name">;
  session: Pick<
    AgentSessionRecord,
    "id" | "origin" | "status" | "branch_ref" | "source_type" | "source_number"
  >;
  sessionNumber: number;
  attemptId: string;
  attemptNumber: number;
  requestOrigin: string;
}): Record<string, string> {
  return {
    GITS_ACTION_RUN_ID: input.session.id,
    GITS_ACTION_RUN_NUMBER: String(input.sessionNumber),
    GITS_ACTION_ATTEMPT_ID: input.attemptId,
    GITS_ACTION_ATTEMPT_NUMBER: String(input.attemptNumber),
    GITS_REPOSITORY: `${input.repository.owner_username}/${input.repository.name}`,
    GITS_PLATFORM_API_BASE: input.requestOrigin,
    GITS_REPOSITORY_OWNER: input.repository.owner_username,
    GITS_REPOSITORY_NAME: input.repository.name,
    ...(input.session.source_type === "issue" && input.session.source_number !== null
      ? { GITS_TRIGGER_ISSUE_NUMBER: String(input.session.source_number) }
      : {}),
    GITS_AGENT_SESSION_ID: input.session.id,
    GITS_AGENT_SESSION_ORIGIN: input.session.origin,
    GITS_AGENT_SESSION_STATUS: input.session.status,
    GITS_AGENT_SESSION_BRANCH_REF: input.session.branch_ref ?? ""
  };
}

export function buildActionRunnerConfigFiles(
  repositoryConfig: Pick<
    RepositoryActionsConfig,
    "codexConfigFileContent" | "claudeCodeConfigFileContent"
  >
): Record<string, string> {
  const configFiles: Record<string, string> = {};

  if (repositoryConfig.codexConfigFileContent.length > 0) {
    configFiles[CODEX_CONFIG_FILE_PATH] = repositoryConfig.codexConfigFileContent;
  }

  if (repositoryConfig.claudeCodeConfigFileContent.length > 0) {
    configFiles[CLAUDE_CODE_CONFIG_FILE_PATH] = repositoryConfig.claudeCodeConfigFileContent;
  }

  return configFiles;
}
