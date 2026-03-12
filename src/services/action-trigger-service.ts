import type {
  ActionAgentType,
  AgentSessionExecutionSourceType,
  AgentSessionOrigin,
  AgentSessionRecord,
  ActionRunRecord,
  ActionWorkflowRecord,
  AppBindings,
  AuthUser,
  RepositoryRecord
} from "../types";
import { AgentSessionService } from "./agent-session-service";
import { enqueueActionRunExecution } from "./action-run-queue-service";
import { executeActionRun } from "./action-runner-service";
import { ActionsService } from "./actions-service";

const ACTIONS_MENTION_PATTERN = /@\s*actions\b/i;
const MENTION_WORKFLOW_NAME = "__mention_actions_internal__";
const ISSUE_CREATED_WORKFLOW_NAME = "__issue_created_internal__";
const AGENT_SESSION_WORKFLOW_NAME_PREFIX = "__agent_session_internal__";
const ISSUE_CREATED_DEFAULT_PROMPT =
  "You are the repository issue automation agent. Follow the provided issue context and required decision strictly.";

function testRegex(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function matchesPushWorkflow(workflow: ActionWorkflowRecord, ref: string | null): boolean {
  if (workflow.trigger_event !== "push") {
    return true;
  }

  const branchPattern = workflow.push_branch_regex?.trim() ?? "";
  const tagPattern = workflow.push_tag_regex?.trim() ?? "";
  const hasAnyPattern = branchPattern.length > 0 || tagPattern.length > 0;

  if (!ref) {
    return !hasAnyPattern;
  }

  if (ref.startsWith("refs/heads/")) {
    const branchName = ref.slice("refs/heads/".length);
    if (!branchPattern) {
      return !tagPattern;
    }
    return testRegex(branchPattern, branchName);
  }

  if (ref.startsWith("refs/tags/")) {
    const tagName = ref.slice("refs/tags/".length);
    if (!tagPattern) {
      return !branchPattern;
    }
    return testRegex(tagPattern, tagName);
  }

  return false;
}

function resolveSessionSourceType(
  sourceType: AgentSessionExecutionSourceType | null | undefined
): AgentSessionRecord["source_type"] {
  return sourceType ?? "manual";
}

export async function createLinkedAgentSessionForRun(input: {
  db: D1Database;
  repositoryId: string;
  run: ActionRunRecord;
  origin: AgentSessionOrigin;
  createdBy?: string | null;
  delegatedFromUserId?: string | null;
}): Promise<AgentSessionRecord> {
  const agentSessionService = new AgentSessionService(input.db);
  return agentSessionService.createSessionExecution({
    repositoryId: input.repositoryId,
    sourceType: resolveSessionSourceType(input.run.trigger_source_type ?? null),
    sourceNumber: input.run.trigger_source_number ?? null,
    sourceCommentId: input.run.trigger_source_comment_id ?? null,
    origin: input.origin,
    agentType: input.run.agent_type,
    instanceType: input.run.instance_type,
    prompt: input.run.prompt,
    triggerRef: input.run.trigger_ref ?? null,
    triggerSha: input.run.trigger_sha ?? null,
    workflowId: input.run.workflow_id ?? null,
    parentSessionId: input.run.parent_session_id ?? null,
    createdBy: input.createdBy ?? input.run.created_by ?? null,
    delegatedFromUserId:
      input.delegatedFromUserId ?? input.run.delegated_from_user_id ?? null
  });
}

export function containsActionsMention(input: { title?: string; body?: string }): boolean {
  const title = input.title ?? "";
  const body = input.body ?? "";
  return ACTIONS_MENTION_PATTERN.test(`${title}\n${body}`);
}

function canScheduleActionRun(
  env: Pick<
    AppBindings,
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
    | "ACTIONS_QUEUE"
  >
): boolean {
  return Boolean(
    env.ACTIONS_RUNNER ||
      env.ACTIONS_RUNNER_BASIC ||
      env.ACTIONS_RUNNER_STANDARD_1 ||
      env.ACTIONS_RUNNER_STANDARD_2 ||
      env.ACTIONS_RUNNER_STANDARD_3 ||
      env.ACTIONS_RUNNER_STANDARD_4 ||
      env.ACTIONS_QUEUE
  );
}

export async function scheduleActionRunExecution(input: {
  env: Pick<
    AppBindings,
    | "DB"
    | "GIT_BUCKET"
    | "REPOSITORY_OBJECTS"
    | "JWT_SECRET"
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
    | "ACTIONS_QUEUE"
  >;
  executionCtx?: ExecutionContext;
  repository: RepositoryRecord;
  session: AgentSessionRecord;
  triggeredByUser?: AuthUser;
  requestOrigin: string;
}): Promise<void> {
  const enqueued = await enqueueActionRunExecution(input.env, {
    repositoryId: input.repository.id,
    sessionId: input.session.id,
    requestOrigin: input.requestOrigin
  });
  if (enqueued) {
    return;
  }

  const execution = executeActionRun({
    env: input.env,
    repository: input.repository,
    session: input.session,
    ...(input.triggeredByUser ? { triggeredByUser: input.triggeredByUser } : {}),
    requestOrigin: input.requestOrigin
  });
  if (input.executionCtx) {
    input.executionCtx.waitUntil(execution);
  } else {
    void execution;
  }
}

async function ensureMentionWorkflow(
  actionsService: ActionsService,
  repository: RepositoryRecord
): Promise<ActionWorkflowRecord> {
  const workflows = await actionsService.listWorkflows(repository.id);
  const existing = workflows.find(
    (workflow) =>
      workflow.trigger_event === "mention_actions" && workflow.name === MENTION_WORKFLOW_NAME
  );
  if (existing) {
    return existing;
  }
  return actionsService.createWorkflow({
    repositoryId: repository.id,
    name: MENTION_WORKFLOW_NAME,
    triggerEvent: "mention_actions",
    agentType: "codex",
    prompt: "internal mention actions workflow",
    pushBranchRegex: null,
    pushTagRegex: null,
    enabled: true,
    createdBy: repository.owner_id
  });
}

async function ensureIssueCreatedWorkflow(
  actionsService: ActionsService,
  repository: RepositoryRecord
): Promise<ActionWorkflowRecord> {
  const workflows = await actionsService.listWorkflows(repository.id);
  const existing = workflows.find(
    (workflow) =>
      workflow.trigger_event === "issue_created" && workflow.name === ISSUE_CREATED_WORKFLOW_NAME
  );
  if (existing && existing.enabled === 1) {
    return existing;
  }
  if (existing) {
    const updated = await actionsService.updateWorkflow(repository.id, existing.id, {
      enabled: true,
      prompt: existing.prompt || ISSUE_CREATED_DEFAULT_PROMPT
    });
    if (updated) {
      return updated;
    }
  }

  return actionsService.createWorkflow({
    repositoryId: repository.id,
    name: ISSUE_CREATED_WORKFLOW_NAME,
    triggerEvent: "issue_created",
    agentType: "codex",
    prompt: ISSUE_CREATED_DEFAULT_PROMPT,
    pushBranchRegex: null,
    pushTagRegex: null,
    enabled: true,
    createdBy: repository.owner_id
  });
}

async function ensureInteractiveAgentWorkflow(
  actionsService: ActionsService,
  repository: RepositoryRecord,
  agentType: ActionAgentType
): Promise<ActionWorkflowRecord> {
  const workflowName = `${AGENT_SESSION_WORKFLOW_NAME_PREFIX}_${agentType}`;
  const workflows = await actionsService.listWorkflows(repository.id);
  const existing = workflows.find(
    (workflow) =>
      workflow.trigger_event === "mention_actions" && workflow.name === workflowName
  );
  if (existing && existing.enabled === 1 && existing.agent_type === agentType) {
    return existing;
  }
  if (existing) {
    const updated = await actionsService.updateWorkflow(repository.id, existing.id, {
      enabled: true,
      agentType
    });
    if (updated) {
      return updated;
    }
  }

  return actionsService.createWorkflow({
    repositoryId: repository.id,
    name: workflowName,
    triggerEvent: "mention_actions",
    agentType,
    prompt: "internal interactive agent session workflow",
    pushBranchRegex: null,
    pushTagRegex: null,
    enabled: true,
    createdBy: repository.owner_id
  });
}

export async function triggerMentionActionRun(input: {
  env: Pick<
    AppBindings,
    | "DB"
    | "GIT_BUCKET"
    | "REPOSITORY_OBJECTS"
    | "JWT_SECRET"
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
    | "ACTIONS_QUEUE"
  >;
  executionCtx?: ExecutionContext;
  repository: RepositoryRecord;
  prompt: string;
  triggerRef?: string | null;
  triggerSha?: string | null;
  triggerSourceType?: AgentSessionExecutionSourceType | null;
  triggerSourceNumber?: number | null;
  triggerSourceCommentId?: string | null;
  triggeredByUser?: AuthUser;
  requestOrigin: string;
}): Promise<AgentSessionRecord | null> {
  const prompt = input.prompt.trim();
  if (!prompt || !canScheduleActionRun(input.env)) {
    return null;
  }

  const actionsService = new ActionsService(input.env.DB);
  const workflow = await ensureMentionWorkflow(actionsService, input.repository);
  const repositoryConfig = await actionsService.getRepositoryConfig(input.repository.id);
  const agentSessionService = new AgentSessionService(input.env.DB);
  const session = await agentSessionService.createSessionExecution({
    repositoryId: input.repository.id,
    sourceType: resolveSessionSourceType(input.triggerSourceType),
    sourceNumber: input.triggerSourceNumber ?? null,
    sourceCommentId: input.triggerSourceCommentId ?? null,
    origin: "mention",
    agentType: workflow.agent_type,
    instanceType: repositoryConfig.instanceType,
    prompt,
    triggerRef: input.triggerRef ?? null,
    triggerSha: input.triggerSha ?? null,
    workflowId: workflow.id,
    createdBy: input.triggeredByUser?.id ?? null,
    delegatedFromUserId: input.triggeredByUser?.id ?? null
  });

  await scheduleActionRunExecution({
    env: input.env,
    ...(input.executionCtx ? { executionCtx: input.executionCtx } : {}),
    repository: input.repository,
    session,
    ...(input.triggeredByUser ? { triggeredByUser: input.triggeredByUser } : {}),
    requestOrigin: input.requestOrigin
  });
  return session;
}

export async function triggerActionWorkflows(input: {
  env: Pick<
    AppBindings,
    | "DB"
    | "GIT_BUCKET"
    | "REPOSITORY_OBJECTS"
    | "JWT_SECRET"
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
    | "ACTIONS_QUEUE"
  >;
  executionCtx?: ExecutionContext;
  repository: RepositoryRecord;
  triggerEvent: ActionWorkflowRecord["trigger_event"];
  triggerRef?: string | null;
  triggerSha?: string | null;
  triggerSourceType?: AgentSessionExecutionSourceType | null;
  triggerSourceNumber?: number | null;
  triggerSourceCommentId?: string | null;
  triggeredByUser?: AuthUser;
  requestOrigin: string;
  buildPrompt?: (workflow: ActionWorkflowRecord) => string;
}): Promise<AgentSessionRecord[]> {
  if (!canScheduleActionRun(input.env)) {
    return [];
  }

  const actionsService = new ActionsService(input.env.DB);
  let workflows = await actionsService.listEnabledWorkflowsByEvent(
    input.repository.id,
    input.triggerEvent
  );
  if (input.triggerEvent === "issue_created" && workflows.length === 0) {
    workflows = [await ensureIssueCreatedWorkflow(actionsService, input.repository)];
  }

  const matchedWorkflows =
    input.triggerEvent === "push"
      ? workflows.filter((workflow) => matchesPushWorkflow(workflow, input.triggerRef ?? null))
      : workflows;
  const repositoryConfig = await actionsService.getRepositoryConfig(input.repository.id);
  const agentSessionService = new AgentSessionService(input.env.DB);

  const sessions: AgentSessionRecord[] = [];
  for (const workflow of matchedWorkflows) {
    const prompt = input.buildPrompt ? input.buildPrompt(workflow) : workflow.prompt;
    const session = await agentSessionService.createSessionExecution({
      repositoryId: input.repository.id,
      sourceType: resolveSessionSourceType(input.triggerSourceType),
      sourceNumber: input.triggerSourceNumber ?? null,
      sourceCommentId: input.triggerSourceCommentId ?? null,
      origin: "workflow",
      agentType: workflow.agent_type,
      instanceType: repositoryConfig.instanceType,
      prompt,
      triggerRef: input.triggerRef ?? null,
      triggerSha: input.triggerSha ?? null,
      workflowId: workflow.id,
      createdBy: input.triggeredByUser?.id ?? null,
      delegatedFromUserId: input.triggeredByUser?.id ?? null
    });
    sessions.push(session);
    await scheduleActionRunExecution({
      env: input.env,
      ...(input.executionCtx ? { executionCtx: input.executionCtx } : {}),
      repository: input.repository,
      session,
      ...(input.triggeredByUser ? { triggeredByUser: input.triggeredByUser } : {}),
      requestOrigin: input.requestOrigin
    });
  }

  return sessions;
}

export async function triggerInteractiveAgentSession(input: {
  env: Pick<
    AppBindings,
    | "DB"
    | "GIT_BUCKET"
    | "REPOSITORY_OBJECTS"
    | "JWT_SECRET"
    | "ACTIONS_RUNNER"
    | "ACTIONS_RUNNER_BASIC"
    | "ACTIONS_RUNNER_STANDARD_1"
    | "ACTIONS_RUNNER_STANDARD_2"
    | "ACTIONS_RUNNER_STANDARD_3"
    | "ACTIONS_RUNNER_STANDARD_4"
    | "ACTIONS_QUEUE"
  >;
  executionCtx?: ExecutionContext;
  repository: RepositoryRecord;
  origin: Extract<
    AgentSessionOrigin,
    "manual" | "issue_assign" | "issue_resume" | "pull_request_resume"
  >;
  agentType: ActionAgentType;
  prompt: string;
  triggerRef?: string | null;
  triggerSha?: string | null;
  triggerSourceType?: AgentSessionExecutionSourceType | null;
  triggerSourceNumber?: number | null;
  triggerSourceCommentId?: string | null;
  triggeredByUser?: AuthUser;
  requestOrigin: string;
  parentSessionId?: string | null;
}): Promise<{ session: AgentSessionRecord }> {
  const actionsService = new ActionsService(input.env.DB);
  const workflow = await ensureInteractiveAgentWorkflow(
    actionsService,
    input.repository,
    input.agentType
  );
  const repositoryConfig = await actionsService.getRepositoryConfig(input.repository.id);
  const agentSessionService = new AgentSessionService(input.env.DB);
  const session = await agentSessionService.createSessionExecution({
    repositoryId: input.repository.id,
    sourceType: resolveSessionSourceType(input.triggerSourceType),
    sourceNumber: input.triggerSourceNumber ?? null,
    sourceCommentId: input.triggerSourceCommentId ?? null,
    origin: input.origin,
    agentType: input.agentType,
    instanceType: repositoryConfig.instanceType,
    prompt: input.prompt,
    triggerRef: input.triggerRef ?? null,
    triggerSha: input.triggerSha ?? null,
    workflowId: workflow.id,
    parentSessionId: input.parentSessionId ?? null,
    createdBy: input.triggeredByUser?.id ?? null,
    delegatedFromUserId: input.triggeredByUser?.id ?? null
  });

  await scheduleActionRunExecution({
    env: input.env,
    ...(input.executionCtx ? { executionCtx: input.executionCtx } : {}),
    repository: input.repository,
    session,
    ...(input.triggeredByUser ? { triggeredByUser: input.triggeredByUser } : {}),
    requestOrigin: input.requestOrigin
  });

  return { session };
}
