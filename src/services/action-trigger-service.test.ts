import { afterEach, describe, expect, it, vi } from "vitest";
import {
  triggerActionWorkflows,
  triggerInteractiveAgentSession,
  triggerMentionActionRun
} from "./action-trigger-service";
import { ActionsService } from "./actions-service";
import { AgentSessionService } from "./agent-session-service";
import type { AgentSessionRecord, RepositoryRecord } from "../types";

function buildRepository(): RepositoryRecord {
  return {
    id: "repo-1",
    owner_id: "user-1",
    owner_username: "alice",
    name: "demo",
    description: "demo",
    is_private: 1,
    created_at: 1
  };
}

function buildSession(overrides?: Partial<AgentSessionRecord>): AgentSessionRecord {
  return {
    id: "session-1",
    repository_id: "repo-1",
    session_number: 1,
    source_type: "issue",
    source_number: 42,
    source_comment_id: null,
    origin: "workflow",
    status: "queued",
    agent_type: "codex",
    instance_type: "lite",
    runner_type: "local",
    prompt: "Run the workflow",
    branch_ref: "refs/heads/agent/session-1",
    trigger_ref: "refs/heads/main",
    trigger_sha: null,
    workflow_id: "workflow-1",
    workflow_name: "workflow",
    parent_session_id: null,
    created_by: "user-1",
    created_by_username: "alice",
    delegated_from_user_id: "user-1",
    delegated_from_username: "alice",
    active_attempt_id: "attempt-1",
    latest_attempt_id: "attempt-1",
    exit_code: null,
    container_instance: null,
    failure_reason: null,
    failure_stage: null,
    created_at: 1,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    updated_at: 1,
    ...(overrides ?? {})
  };
}

describe("action-trigger-service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates mention sessions for local runners without requiring queue binding", async () => {
    vi.spyOn(ActionsService.prototype, "listWorkflows").mockResolvedValue([
      {
        id: "workflow-1",
        repository_id: "repo-1",
        name: "__mention_actions_internal__",
        trigger_event: "mention_actions",
        agent_type: "codex",
        prompt: "internal mention actions workflow",
        push_branch_regex: null,
        push_tag_regex: null,
        enabled: 1,
        created_by: "user-1",
        created_at: 1,
        updated_at: 1
      }
    ]);
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      instanceType: "lite",
      runnerType: "local",
      codexConfigFileContent: null,
      claudeCodeConfigFileContent: null,
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });
    const createSessionExecution = vi
      .spyOn(AgentSessionService.prototype, "createSessionExecution")
      .mockResolvedValue(buildSession({ origin: "mention" }));

    const session = await triggerMentionActionRun({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "secret",
        ACTIONS_RUNNER: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_BASIC: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_1: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_2: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_3: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_4: {} as DurableObjectNamespace
      },
      repository: buildRepository(),
      prompt: "Fix it",
      requestOrigin: "http://localhost"
    });

    expect(session?.id).toBe("session-1");
    expect(createSessionExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerType: "local"
      })
    );
  });

  it("creates workflow sessions for local runners without requiring queue binding", async () => {
    vi.spyOn(ActionsService.prototype, "listEnabledWorkflowsByEvent").mockResolvedValue([
      {
        id: "workflow-1",
        repository_id: "repo-1",
        name: "CI",
        trigger_event: "push",
        agent_type: "codex",
        prompt: "run ci",
        push_branch_regex: null,
        push_tag_regex: null,
        enabled: 1,
        created_by: "user-1",
        created_at: 1,
        updated_at: 1
      }
    ]);
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      instanceType: "lite",
      runnerType: "local",
      codexConfigFileContent: null,
      claudeCodeConfigFileContent: null,
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });
    const createSessionExecution = vi
      .spyOn(AgentSessionService.prototype, "createSessionExecution")
      .mockResolvedValue(buildSession());

    const sessions = await triggerActionWorkflows({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "secret",
        ACTIONS_RUNNER: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_BASIC: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_1: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_2: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_3: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_4: {} as DurableObjectNamespace
      },
      repository: buildRepository(),
      triggerEvent: "push",
      requestOrigin: "http://localhost"
    });

    expect(sessions).toHaveLength(1);
    expect(createSessionExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerType: "local"
      })
    );
  });

  it("creates interactive local sessions without scheduling queue execution", async () => {
    vi.spyOn(ActionsService.prototype, "listWorkflows").mockResolvedValue([
      {
        id: "workflow-1",
        repository_id: "repo-1",
        name: "__agent_session_internal___codex",
        trigger_event: "mention_actions",
        agent_type: "codex",
        prompt: "internal interactive agent session workflow",
        push_branch_regex: null,
        push_tag_regex: null,
        enabled: 1,
        created_by: "user-1",
        created_at: 1,
        updated_at: 1
      }
    ]);
    vi.spyOn(ActionsService.prototype, "getRepositoryConfig").mockResolvedValue({
      instanceType: "lite",
      runnerType: "local",
      codexConfigFileContent: null,
      claudeCodeConfigFileContent: null,
      inheritsGlobalCodexConfig: true,
      inheritsGlobalClaudeCodeConfig: true,
      updated_at: 1
    });
    const createSessionExecution = vi
      .spyOn(AgentSessionService.prototype, "createSessionExecution")
      .mockResolvedValue(buildSession({ origin: "manual" }));

    const result = await triggerInteractiveAgentSession({
      env: {
        DB: {} as D1Database,
        GIT_BUCKET: {} as R2Bucket,
        REPOSITORY_OBJECTS: {} as DurableObjectNamespace,
        JWT_SECRET: "secret",
        ACTIONS_RUNNER: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_BASIC: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_1: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_2: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_3: {} as DurableObjectNamespace,
        ACTIONS_RUNNER_STANDARD_4: {} as DurableObjectNamespace
      },
      repository: buildRepository(),
      origin: "manual",
      agentType: "codex",
      prompt: "Handle this",
      requestOrigin: "http://localhost"
    });

    expect(result.session.id).toBe("session-1");
    expect(createSessionExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerType: "local"
      })
    );
  });
});
