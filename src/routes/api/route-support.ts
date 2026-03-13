import {
  ActionLogStorageService,
  AgentSessionService,
  HTTPException,
  IssueService,
  PullRequestService,
  RepositoryService,
  WorkflowTaskFlowService,
  buildAgentSessionValidationSummary,
  createRepositoryObjectClient
} from "./deps";
import type {
  AgentSessionApiRecord,
  AgentSessionRecord,
  AppEnv,
  IssueRecord,
  RepositoryRecord
} from "./deps";


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
  session: AgentSessionApiRecord;
  sourceContext: Awaited<ReturnType<typeof buildAgentSessionSourceContext>>;
  attempts: Awaited<ReturnType<AgentSessionService["listAttempts"]>>;
  activeAttempt: Awaited<ReturnType<AgentSessionService["findActiveAttemptForSession"]>>;
  latestAttempt: Awaited<ReturnType<AgentSessionService["findLatestAttemptForSession"]>>;
  artifacts: Awaited<ReturnType<AgentSessionService["listArtifacts"]>>;
  events: Awaited<ReturnType<AgentSessionService["listAttemptEvents"]>>;
  validationSummary: ReturnType<typeof buildAgentSessionValidationSummary>;
}> {
  const agentSessionService = new AgentSessionService(args.db);
  const [sourceContext, attempts, activeAttempt, latestAttempt, artifacts] = await Promise.all([
    buildAgentSessionSourceContext({
      db: args.db,
      repository: args.repository,
      owner: args.owner,
      repo: args.repo,
      session: args.session,
      ...(args.viewerId ? { viewerId: args.viewerId } : {})
    }),
    agentSessionService.listAttempts(args.repository.id, args.session.id),
    agentSessionService.findActiveAttemptForSession(args.repository.id, args.session.id),
    agentSessionService.findLatestAttemptForSession(args.repository.id, args.session.id),
    agentSessionService.listArtifacts(args.repository.id, args.session.id),
  ]);
  const detailAttempt = latestAttempt ?? activeAttempt;
  const events = detailAttempt
    ? await agentSessionService.listAttemptEvents({
        repositoryId: args.repository.id,
        sessionId: args.session.id,
        attemptId: detailAttempt.id
      })
    : [];

  return {
    session: {
      ...args.session,
      logs: artifacts.find((artifact) => artifact.kind === "session_logs")?.content_text ?? "",
      has_full_logs: true,
      logs_url: `/api/repos/${args.owner}/${args.repo}/agent-sessions/${args.session.id}/logs`
    },
    sourceContext,
    attempts,
    activeAttempt,
    latestAttempt,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      has_full_content: true,
      content_url: `/api/repos/${args.owner}/${args.repo}/agent-sessions/${args.session.id}/artifacts/${artifact.id}/content`
    })),
    events,
    validationSummary: buildAgentSessionValidationSummary({
      status: args.session.status,
      artifacts,
      attempt: detailAttempt,
      events
    })
  };
}

export function createActionLogStorageService(
  env: Pick<AppEnv["Bindings"], "ACTION_LOGS_BUCKET" | "GIT_BUCKET">
): ActionLogStorageService {
  return new ActionLogStorageService(env.ACTION_LOGS_BUCKET ?? env.GIT_BUCKET);
}

export function withAgentSessionApiMetadata(
  owner: string,
  repo: string,
  session: AgentSessionRecord
): AgentSessionApiRecord {
  return {
    ...session,
    logs: "",
    has_full_logs: true,
    logs_url: `/api/repos/${owner}/${repo}/agent-sessions/${session.id}/logs`
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

export const TERMINAL_SESSION_STATUSES = new Set(["success", "failed", "cancelled"]);
export const SESSION_LOG_STREAM_POLL_INTERVAL_MS = 1_000;
export const SESSION_LOG_STREAM_MAX_DURATION_MS = 25_000;
export const SESSION_LOG_STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

export type SseEventPayload = {
  event: string;
  data: unknown;
};

export function createSseEventChunk(payload: SseEventPayload): string {
  return `event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`;
}

export function buildSessionLogStreamEvents(
  previousSession: AgentSessionApiRecord | null,
  currentSession: AgentSessionApiRecord
): SseEventPayload[] {
  if (!previousSession) {
    return [
      {
        event: "snapshot",
        data: {
          session: currentSession
        }
      }
    ];
  }

  if (currentSession.logs !== previousSession.logs) {
    if (currentSession.logs.startsWith(previousSession.logs)) {
      const chunk = currentSession.logs.slice(previousSession.logs.length);
      return [
        {
          event: "append",
          data: {
            sessionId: currentSession.id,
            chunk,
            status: currentSession.status,
            exitCode: currentSession.exit_code,
            completedAt: currentSession.completed_at,
            updatedAt: currentSession.updated_at
          }
        }
      ];
    }

    return [
      {
        event: "replace",
        data: {
          session: currentSession
        }
      }
    ];
  }

  if (
    currentSession.status !== previousSession.status ||
    currentSession.exit_code !== previousSession.exit_code ||
    currentSession.completed_at !== previousSession.completed_at ||
    currentSession.updated_at !== previousSession.updated_at
  ) {
    return [
      {
        event: "status",
        data: {
          sessionId: currentSession.id,
          status: currentSession.status,
          exitCode: currentSession.exit_code,
          completedAt: currentSession.completed_at,
          updatedAt: currentSession.updated_at
        }
      }
    ];
  }

  return [];
}

export async function hydrateSessionWithFullLogs(args: {
  logStorage: ActionLogStorageService;
  repositoryId: string;
  session: AgentSessionRecord;
}): Promise<AgentSessionApiRecord> {
  const attemptId = args.session.latest_attempt_id ?? args.session.active_attempt_id ?? null;
  const logs =
    attemptId === null
      ? null
      : await args.logStorage.readAttemptArtifactLogs(
          args.repositoryId,
          args.session.id,
          attemptId,
          "session_logs"
        );
  if (logs === null) {
    return {
      ...args.session,
      logs: ""
    };
  }
  return {
    ...args.session,
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
