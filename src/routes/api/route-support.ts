import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mustSessionUser, optionalSession, requireSession } from "../../middleware/auth";
import {
  ISSUE_PR_CREATE_TOKEN_PLACEHOLDER,
  ISSUE_REPLY_TOKEN_PLACEHOLDER
} from "../../services/action-runner-prompt-tokens";
import {
  containsActionsMention,
  createLinkedAgentSessionForRun,
  scheduleActionRunExecution,
  triggerInteractiveAgentSession,
  triggerActionWorkflows,
  triggerMentionActionRun
} from "../../services/action-trigger-service";
import { ACTION_CONTAINER_INSTANCE_TYPES } from "../../services/action-container-instance-types";
import { ActionLogStorageService } from "../../services/action-log-storage-service";
import { AgentSessionService } from "../../services/agent-session-service";
import { buildAgentSessionValidationSummary } from "../../services/agent-session-validation-summary";
import { ActionsService } from "../../services/actions-service";
import { AuthService } from "../../services/auth-service";
import { RepositoryMetadataService } from "../../services/repository-metadata-service";
import {
  collectPlatformMcpForwardHeaders,
  createPlatformMcpServer
} from "../../services/platform-mcp-service";
import {
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError,
  type RepositoryCompareResult,
  type RepositoryDiffHunk
} from "../../services/repository-browser-service";
import { IssueService, type IssueListState } from "../../services/issue-service";
import {
  PullRequestMergeBranchNotFoundError,
  PullRequestMergeConflictError,
  PullRequestMergeNotSupportedError
} from "../../services/pull-request-merge-service";
import {
  DuplicateOpenPullRequestError,
  PullRequestService,
  type PullRequestListState
} from "../../services/pull-request-service";
import { enrichPullRequestReviewThreads } from "../../services/pull-request-review-thread-anchor-service";
import { createRepositoryObjectClient } from "../../services/repository-object";
import { RepositoryService } from "../../services/repository-service";
import { WorkflowTaskFlowService } from "../../services/workflow-task-flow-service";
import type {
  ActionAgentType,
  ActionContainerInstanceType,
  ActionRunRecord,
  ActionRunSourceType,
  ActionWorkflowTrigger,
  AgentSessionRecord,
  AgentSessionSourceType,
  AppEnv,
  IssueCommentRecord,
  IssueRecord,
  IssueState,
  IssueTaskStatus,
  PullRequestReviewDecision,
  PullRequestReviewThreadRecord,
  PullRequestReviewThreadSide,
  PullRequestState,
  ReactionContent,
  ReactionSubjectType,
  RepositoryRecord
} from "../../types";


export async function findReadableRepositoryOr404(args: {
  repositoryService: RepositoryService;
  owner: string;
  repo: string;
  userId?: string;
}): Promise<RepositoryRecord> {
  const repository = await args.repositoryService.findRepository(args.owner, args.repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  const canRead = await args.repositoryService.canReadRepository(repository, args.userId);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  return repository;
}

export function buildAgentSessionSourceUrl(args: {
  owner: string;
  repo: string;
  session: Pick<AgentSessionRecord, "source_type" | "source_number">;
}): string | null {
  if (args.session.source_number === null) {
    return null;
  }
  if (args.session.source_type === "issue") {
    return `/repo/${args.owner}/${args.repo}/issues/${args.session.source_number}`;
  }
  if (args.session.source_type === "pull_request") {
    return `/repo/${args.owner}/${args.repo}/pulls/${args.session.source_number}`;
  }
  return null;
}

export async function buildAgentSessionSourceContext(args: {
  db: D1Database;
  repository: RepositoryRecord;
  owner: string;
  repo: string;
  session: AgentSessionRecord;
  viewerId?: string;
}): Promise<{
  type: AgentSessionRecord["source_type"];
  number: number | null;
  title: string | null;
  url: string | null;
  commentId: string | null;
}> {
  const url = buildAgentSessionSourceUrl({
    owner: args.owner,
    repo: args.repo,
    session: args.session
  });

  if (args.session.source_number === null) {
    return {
      type: args.session.source_type,
      number: null,
      title: null,
      url,
      commentId: args.session.source_comment_id
    };
  }

  if (args.session.source_type === "issue") {
    const issueService = new IssueService(args.db);
    const issue = await issueService.findIssueByNumber(
      args.repository.id,
      args.session.source_number,
      args.viewerId
    );
    return {
      type: args.session.source_type,
      number: args.session.source_number,
      title: issue?.title ?? null,
      url,
      commentId: args.session.source_comment_id
    };
  }

  if (args.session.source_type === "pull_request") {
    const pullRequestService = new PullRequestService(args.db);
    const pullRequest = await pullRequestService.findPullRequestByNumber(
      args.repository.id,
      args.session.source_number,
      args.viewerId
    );
    return {
      type: args.session.source_type,
      number: args.session.source_number,
      title: pullRequest?.title ?? null,
      url,
      commentId: args.session.source_comment_id
    };
  }

  return {
    type: args.session.source_type,
    number: args.session.source_number,
    title: null,
    url,
    commentId: args.session.source_comment_id
  };
}

export async function buildAgentSessionDetailPayload(args: {
  db: D1Database;
  repository: RepositoryRecord;
  owner: string;
  repo: string;
  session: AgentSessionRecord;
  viewerId?: string;
}): Promise<{
  session: AgentSessionRecord;
  linkedRun: ActionRunRecord | null;
  sourceContext: Awaited<ReturnType<typeof buildAgentSessionSourceContext>>;
  artifacts: Awaited<ReturnType<AgentSessionService["listArtifacts"]>>;
  usageRecords: Awaited<ReturnType<AgentSessionService["listUsageRecords"]>>;
  interventions: Awaited<ReturnType<AgentSessionService["listInterventions"]>>;
  validationSummary: ReturnType<typeof buildAgentSessionValidationSummary>;
}> {
  const agentSessionService = new AgentSessionService(args.db);
  const actionsService = new ActionsService(args.db);
  const [linkedRun, sourceContext, artifacts, usageRecords, interventions] = await Promise.all([
    args.session.linked_run_id
      ? actionsService.findRunById(args.repository.id, args.session.linked_run_id)
      : null,
    buildAgentSessionSourceContext({
      db: args.db,
      repository: args.repository,
      owner: args.owner,
      repo: args.repo,
      session: args.session,
      ...(args.viewerId ? { viewerId: args.viewerId } : {})
    }),
    agentSessionService.listArtifacts(args.repository.id, args.session.id),
    agentSessionService.listUsageRecords(args.repository.id, args.session.id),
    agentSessionService.listInterventions(args.repository.id, args.session.id)
  ]);

  return {
    session: args.session,
    linkedRun: linkedRun
      ? {
          ...linkedRun,
          has_full_logs: true,
          logs_url: `/api/repos/${args.owner}/${args.repo}/actions/runs/${linkedRun.id}/logs`
        }
      : null,
    sourceContext,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      has_full_content: true,
      content_url: `/api/repos/${args.owner}/${args.repo}/agent-sessions/${args.session.id}/artifacts/${artifact.id}/content`
    })),
    usageRecords,
    interventions,
    validationSummary: buildAgentSessionValidationSummary({
      status: linkedRun?.status ?? args.session.status,
      artifacts,
      usageRecords,
      interventions
    })
  };
}

export function createActionLogStorageService(
  env: Pick<AppEnv["Bindings"], "ACTION_LOGS_BUCKET" | "GIT_BUCKET">
): ActionLogStorageService {
  return new ActionLogStorageService(env.ACTION_LOGS_BUCKET ?? env.GIT_BUCKET);
}

export function withActionRunApiMetadata(
  owner: string,
  repo: string,
  run: ActionRunRecord
): ActionRunRecord {
  return {
    ...run,
    has_full_logs: true,
    logs_url: `/api/repos/${owner}/${repo}/actions/runs/${run.id}/logs`
  };
}

export async function buildLatestPullRequestProvenancePayload(args: {
  db: D1Database;
  repository: RepositoryRecord;
  owner: string;
  repo: string;
  pullRequestNumbers: number[];
  viewerId?: string;
}): Promise<
  Array<{
    sourceNumber: number;
    latestSession: Awaited<ReturnType<typeof buildAgentSessionDetailPayload>> | null;
  }>
> {
  if (args.pullRequestNumbers.length === 0) {
    return [];
  }

  const agentSessionService = new AgentSessionService(args.db);
  const latestSessions = await agentSessionService.listLatestSessionsBySource(
    args.repository.id,
    "pull_request",
    args.pullRequestNumbers
  );

  const detailEntries = await Promise.all(
    latestSessions
      .filter((session) => session.source_number !== null)
      .map(async (session) => [
        session.source_number as number,
        await buildAgentSessionDetailPayload({
          db: args.db,
          repository: args.repository,
          owner: args.owner,
          repo: args.repo,
          session,
          ...(args.viewerId ? { viewerId: args.viewerId } : {})
        })
      ] as const)
  );
  const detailBySourceNumber = new Map<
    number,
    Awaited<ReturnType<typeof buildAgentSessionDetailPayload>>
  >(detailEntries);

  return args.pullRequestNumbers.map((sourceNumber) => ({
    sourceNumber,
    latestSession: detailBySourceNumber.get(sourceNumber) ?? null
  }));
}

export async function listRepositoryParticipants(
  repositoryService: RepositoryService,
  repository: RepositoryRecord
): Promise<Array<{ id: string; username: string }>> {
  const collaborators = await repositoryService.listCollaborators(repository.id);
  const participants = [
    { id: repository.owner_id, username: repository.owner_username },
    ...collaborators.map((collaborator) => ({
      id: collaborator.user_id,
      username: collaborator.username
    }))
  ];
  const unique = new Map<string, { id: string; username: string }>();
  for (const participant of participants) {
    unique.set(participant.id, participant);
  }
  return Array.from(unique.values()).sort((left, right) =>
    left.username.localeCompare(right.username)
  );
}

export async function assertAssignableUserIds(args: {
  repositoryService: RepositoryService;
  repository: RepositoryRecord;
  userIds: string[] | undefined;
  field: string;
}): Promise<string[] | undefined> {
  if (!args.userIds) {
    return undefined;
  }
  const participants = await listRepositoryParticipants(args.repositoryService, args.repository);
  const allowedIds = new Set(participants.map((participant) => participant.id));
  for (const userId of args.userIds) {
    if (!allowedIds.has(userId)) {
      throw new HTTPException(400, {
        message: `Field '${args.field}' contains a user that cannot be assigned in this repository`
      });
    }
  }
  return args.userIds;
}

export async function assertReactionSubjectExists(args: {
  db: D1Database;
  repositoryId: string;
  subjectType: ReactionSubjectType;
  subjectId: string;
}): Promise<void> {
  let tableName: "issues" | "issue_comments" | "pull_requests" | "pull_request_reviews";
  switch (args.subjectType) {
    case "issue":
      tableName = "issues";
      break;
    case "issue_comment":
      tableName = "issue_comments";
      break;
    case "pull_request":
      tableName = "pull_requests";
      break;
    case "pull_request_review":
      tableName = "pull_request_reviews";
      break;
  }
  const row = await args.db
    .prepare(`SELECT id FROM ${tableName} WHERE repository_id = ? AND id = ? LIMIT 1`)
    .bind(args.repositoryId, args.subjectId)
    .first<{ id: string }>();
  if (!row) {
    throw new HTTPException(404, { message: "Reaction subject not found" });
  }
}

export const TERMINAL_ACTION_RUN_STATUSES = new Set(["success", "failed", "cancelled"]);
export const ACTION_RUN_LOG_STREAM_POLL_INTERVAL_MS = 1_000;
export const ACTION_RUN_LOG_STREAM_MAX_DURATION_MS = 25_000;
export const ACTION_RUN_LOG_STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

export type SseEventPayload = {
  event: string;
  data: unknown;
};

export function createSseEventChunk(payload: SseEventPayload): string {
  return `event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`;
}

export function buildRunLogStreamEvents(
  previousRun: ActionRunRecord | null,
  currentRun: ActionRunRecord
): SseEventPayload[] {
  if (!previousRun) {
    return [
      {
        event: "snapshot",
        data: {
          run: currentRun
        }
      }
    ];
  }

  if (currentRun.logs !== previousRun.logs) {
    if (currentRun.logs.startsWith(previousRun.logs)) {
      const chunk = currentRun.logs.slice(previousRun.logs.length);
      return [
        {
          event: "append",
          data: {
            runId: currentRun.id,
            chunk,
            status: currentRun.status,
            exitCode: currentRun.exit_code,
            completedAt: currentRun.completed_at,
            updatedAt: currentRun.updated_at
          }
        }
      ];
    }

    return [
      {
        event: "replace",
        data: {
          run: currentRun
        }
      }
    ];
  }

  if (
    currentRun.status !== previousRun.status ||
    currentRun.exit_code !== previousRun.exit_code ||
    currentRun.completed_at !== previousRun.completed_at ||
    currentRun.updated_at !== previousRun.updated_at
  ) {
    return [
      {
        event: "status",
        data: {
          runId: currentRun.id,
          status: currentRun.status,
          exitCode: currentRun.exit_code,
          completedAt: currentRun.completed_at,
          updatedAt: currentRun.updated_at
        }
      }
    ];
  }

  return [];
}

export async function hydrateRunWithFullLogs(args: {
  logStorage: ActionLogStorageService;
  repositoryId: string;
  run: ActionRunRecord;
}): Promise<ActionRunRecord> {
  const logs = await args.logStorage.readRunLogs(args.repositoryId, args.run.id);
  if (logs === null) {
    return args.run;
  }
  return {
    ...args.run,
    logs
  };
}

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(undefined);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(undefined);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}


export function createWorkflowTaskFlowService(
  env: Pick<AppEnv["Bindings"], "DB" | "REPOSITORY_OBJECTS">
): WorkflowTaskFlowService {
  return new WorkflowTaskFlowService(env.DB, createRepositoryObjectClient(env));
}

export async function reconcileIssueNumbers(args: {
  workflowTaskFlowService: WorkflowTaskFlowService;
  repository: RepositoryRecord;
  issueNumbers: readonly number[];
  viewerId?: string;
}): Promise<void> {
  const issueNumbers = Array.from(new Set(args.issueNumbers)).sort((left, right) => left - right);
  if (issueNumbers.length === 0) {
    return;
  }
  await Promise.all(
    issueNumbers.map((issueNumber) =>
      args.workflowTaskFlowService.reconcileIssueTaskStatus({
        repository: args.repository,
        issueNumber,
        ...(args.viewerId ? { viewerId: args.viewerId } : {})
      })
    )
  );
}

export async function reconcileIssueRecords(args: {
  workflowTaskFlowService: WorkflowTaskFlowService;
  repository: RepositoryRecord;
  issues: readonly IssueRecord[];
  viewerId?: string;
}): Promise<IssueRecord[]> {
  if (args.issues.length === 0) {
    return [];
  }
  const reconciled = await Promise.all(
    args.issues.map((issue) =>
      args.workflowTaskFlowService.reconcileIssueTaskStatus({
        repository: args.repository,
        issueNumber: issue.number,
        ...(args.viewerId ? { viewerId: args.viewerId } : {})
      })
    )
  );
  const byNumber = new Map(
    reconciled
      .filter((issue): issue is IssueRecord => issue !== null)
      .map((issue) => [issue.number, issue] as const)
  );
  return args.issues.map((issue) => byNumber.get(issue.number) ?? issue);
}

export function sessionCookieSecure(url: string): boolean {
  return new URL(url).protocol === "https:";
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("UNIQUE constraint failed");
}
