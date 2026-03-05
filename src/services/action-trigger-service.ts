import type {
  ActionRunRecord,
  ActionRunSourceType,
  ActionWorkflowRecord,
  AppBindings,
  AuthUser,
  RepositoryRecord
} from "../types";
import { enqueueActionRunExecution } from "./action-run-queue-service";
import { executeActionRun } from "./action-runner-service";
import { ActionsService } from "./actions-service";

const ACTIONS_MENTION_PATTERN = /@\s*actions\b/i;
const MENTION_WORKFLOW_NAME = "__mention_actions_internal__";
const ISSUE_CREATED_WORKFLOW_NAME = "__issue_created_internal__";
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

export function containsActionsMention(input: { title?: string; body?: string }): boolean {
  const title = input.title ?? "";
  const body = input.body ?? "";
  return ACTIONS_MENTION_PATTERN.test(`${title}\n${body}`);
}

function canScheduleActionRun(env: Pick<AppBindings, "ACTIONS_RUNNER" | "ACTIONS_QUEUE">): boolean {
  return Boolean(env.ACTIONS_RUNNER || env.ACTIONS_QUEUE);
}

export async function scheduleActionRunExecution(input: {
  env: Pick<AppBindings, "DB" | "JWT_SECRET" | "ACTIONS_RUNNER" | "ACTIONS_QUEUE">;
  executionCtx?: ExecutionContext;
  repository: RepositoryRecord;
  run: {
    id: string;
    run_number: number;
    repository_id: string;
    agent_type: "codex" | "claude_code";
    prompt: string;
    trigger_ref: string | null;
    trigger_sha: string | null;
    trigger_source_type: ActionRunSourceType | null;
    trigger_source_number: number | null;
  };
  triggeredByUser?: AuthUser;
  requestOrigin: string;
}): Promise<void> {
  const enqueued = await enqueueActionRunExecution(input.env, {
    repositoryId: input.repository.id,
    runId: input.run.id,
    requestOrigin: input.requestOrigin
  });
  if (enqueued) {
    return;
  }

  const execution = executeActionRun({
    env: input.env,
    repository: input.repository,
    run: input.run,
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

export async function triggerMentionActionRun(input: {
  env: Pick<AppBindings, "DB" | "JWT_SECRET" | "ACTIONS_RUNNER" | "ACTIONS_QUEUE">;
  executionCtx?: ExecutionContext;
  repository: RepositoryRecord;
  prompt: string;
  triggerRef?: string | null;
  triggerSha?: string | null;
  triggerSourceType?: ActionRunSourceType | null;
  triggerSourceNumber?: number | null;
  triggerSourceCommentId?: string | null;
  triggeredByUser?: AuthUser;
  requestOrigin: string;
}): Promise<ActionRunRecord | null> {
  const prompt = input.prompt.trim();
  if (!prompt || !canScheduleActionRun(input.env)) {
    return null;
  }

  const actionsService = new ActionsService(input.env.DB);
  const workflow = await ensureMentionWorkflow(actionsService, input.repository);
  const run = await actionsService.createRun({
    repositoryId: input.repository.id,
    workflowId: workflow.id,
    triggerEvent: "mention_actions",
    ...(input.triggerRef ? { triggerRef: input.triggerRef } : {}),
    ...(input.triggerSha ? { triggerSha: input.triggerSha } : {}),
    ...(input.triggerSourceType ? { triggerSourceType: input.triggerSourceType } : {}),
    ...(input.triggerSourceNumber ? { triggerSourceNumber: input.triggerSourceNumber } : {}),
    ...(input.triggerSourceCommentId ? { triggerSourceCommentId: input.triggerSourceCommentId } : {}),
    ...(input.triggeredByUser ? { triggeredBy: input.triggeredByUser.id } : {}),
    agentType: workflow.agent_type,
    prompt
  });

  await scheduleActionRunExecution({
    env: input.env,
    ...(input.executionCtx ? { executionCtx: input.executionCtx } : {}),
    repository: input.repository,
    run,
    ...(input.triggeredByUser ? { triggeredByUser: input.triggeredByUser } : {}),
    requestOrigin: input.requestOrigin
  });
  return run;
}

export async function triggerActionWorkflows(input: {
  env: Pick<AppBindings, "DB" | "JWT_SECRET" | "ACTIONS_RUNNER" | "ACTIONS_QUEUE">;
  executionCtx?: ExecutionContext;
  repository: RepositoryRecord;
  triggerEvent: ActionWorkflowRecord["trigger_event"];
  triggerRef?: string | null;
  triggerSha?: string | null;
  triggerSourceType?: ActionRunSourceType | null;
  triggerSourceNumber?: number | null;
  triggerSourceCommentId?: string | null;
  triggeredByUser?: AuthUser;
  requestOrigin: string;
  buildPrompt?: (workflow: ActionWorkflowRecord) => string;
}): Promise<ActionRunRecord[]> {
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

  const runs: ActionRunRecord[] = [];
  for (const workflow of matchedWorkflows) {
    const prompt = input.buildPrompt ? input.buildPrompt(workflow) : workflow.prompt;
    const run = await actionsService.createRun({
      repositoryId: input.repository.id,
      workflowId: workflow.id,
      triggerEvent: input.triggerEvent,
      ...(input.triggerRef ? { triggerRef: input.triggerRef } : {}),
      ...(input.triggerSha ? { triggerSha: input.triggerSha } : {}),
      ...(input.triggerSourceType ? { triggerSourceType: input.triggerSourceType } : {}),
      ...(input.triggerSourceNumber ? { triggerSourceNumber: input.triggerSourceNumber } : {}),
      ...(input.triggerSourceCommentId
        ? { triggerSourceCommentId: input.triggerSourceCommentId }
        : {}),
      ...(input.triggeredByUser ? { triggeredBy: input.triggeredByUser.id } : {}),
      agentType: workflow.agent_type,
      prompt
    });
    runs.push(run);
    await scheduleActionRunExecution({
      env: input.env,
      ...(input.executionCtx ? { executionCtx: input.executionCtx } : {}),
      repository: input.repository,
      run,
      ...(input.triggeredByUser ? { triggeredByUser: input.triggeredByUser } : {}),
      requestOrigin: input.requestOrigin
    });
  }

  return runs;
}
