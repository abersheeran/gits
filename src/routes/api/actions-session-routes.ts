import {
  ActionsService,
  AgentSessionService,
  HTTPException,
  RepositoryService,
  mustSessionUser,
  optionalSession,
  requireSession
} from "./deps";

import {
  assertAgentSessionSourceType,
  assertPositiveInteger,
  assertString,
  buildAgentSessionDetailPayload,
  createActionLogStorageService,
  findReadableRepositoryOr404,
  parseActionRunSourceNumbers,
  parseLimit,
  type ApiRouter
} from "./shared";

export function registerActionsSessionRoutes(router: ApiRouter): void {
    router.get("/repos/:owner/:repo/agent-sessions", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const sourceTypeParam = c.req.query("sourceType");
      const sourceNumberParam = c.req.query("sourceNumber");
      if (sourceNumberParam && !sourceTypeParam) {
        throw new HTTPException(400, {
          message: "Query 'sourceType' is required when 'sourceNumber' is provided"
        });
      }

      const agentSessionService = new AgentSessionService(c.env.DB);
      const sessions = await agentSessionService.listSessions({
        repositoryId: repository.id,
        limit: parseLimit(c.req.query("limit"), 30),
        ...(sourceTypeParam ? { sourceType: assertAgentSessionSourceType(sourceTypeParam) } : {}),
        ...(sourceNumberParam
          ? { sourceNumber: assertPositiveInteger(sourceNumberParam, "sourceNumber") }
          : {})
      });
      return c.json({ sessions });
    });

    router.get("/repos/:owner/:repo/agent-sessions/latest", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const sourceType = assertAgentSessionSourceType(c.req.query("sourceType"));
      if (sourceType === "manual") {
        throw new HTTPException(400, {
          message: "Query 'sourceType' cannot be manual for latest source lookups"
        });
      }
      const sourceNumbers = parseActionRunSourceNumbers(c.req.query("numbers"));
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const agentSessionService = new AgentSessionService(c.env.DB);
      const latestSessions = await agentSessionService.listLatestSessionsBySource(
        repository.id,
        sourceType,
        sourceNumbers
      );
      const sessionBySourceNumber = new Map<number, (typeof latestSessions)[number]>();
      for (const session of latestSessions) {
        if (session.source_number !== null) {
          sessionBySourceNumber.set(session.source_number, session);
        }
      }

      return c.json({
        sourceType,
        items: sourceNumbers.map((sourceNumber) => ({
          sourceNumber,
          session: sessionBySourceNumber.get(sourceNumber) ?? null
        }))
      });
    });

    router.get("/repos/:owner/:repo/agent-sessions/:sessionId", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const sessionId = assertString(c.req.param("sessionId"), "sessionId");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const agentSessionService = new AgentSessionService(
        c.env.DB,
        createActionLogStorageService(c.env)
      );
      const session = await agentSessionService.findSessionById(repository.id, sessionId);
      if (!session) {
        throw new HTTPException(404, { message: "Agent session not found" });
      }
      return c.json(
        await buildAgentSessionDetailPayload({
          db: c.env.DB,
          repository,
          owner,
          repo,
          session,
          ...(sessionUser ? { viewerId: sessionUser.id } : {})
        })
      );
    });

    router.get("/repos/:owner/:repo/agent-sessions/:sessionId/artifacts", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const sessionId = assertString(c.req.param("sessionId"), "sessionId");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const agentSessionService = new AgentSessionService(c.env.DB);
      const session = await agentSessionService.findSessionById(repository.id, sessionId);
      if (!session) {
        throw new HTTPException(404, { message: "Agent session not found" });
      }

      const artifacts = await agentSessionService.listArtifacts(repository.id, session.id);
      return c.json({
        artifacts: artifacts.map((artifact) => ({
          ...artifact,
          has_full_content: true,
          content_url: `/api/repos/${owner}/${repo}/agent-sessions/${session.id}/artifacts/${artifact.id}/content`
        }))
      });
    });

    router.get(
      "/repos/:owner/:repo/agent-sessions/:sessionId/artifacts/:artifactId/content",
      optionalSession,
      async (c) => {
        const owner = c.req.param("owner");
        const repo = c.req.param("repo");
        const sessionId = assertString(c.req.param("sessionId"), "sessionId");
        const artifactId = assertString(c.req.param("artifactId"), "artifactId");
        const repositoryService = new RepositoryService(c.env.DB);
        const sessionUser = c.get("sessionUser");
        const repository = await findReadableRepositoryOr404({
          repositoryService,
          owner,
          repo,
          ...(sessionUser ? { userId: sessionUser.id } : {})
        });

        const agentSessionService = new AgentSessionService(
          c.env.DB,
          createActionLogStorageService(c.env)
        );
        const content = await agentSessionService.readArtifactContent(
          repository.id,
          sessionId,
          artifactId
        );
        if (!content) {
          throw new HTTPException(404, { message: "Agent session artifact not found" });
        }
        return c.json({
          artifact: {
            ...content.artifact,
            has_full_content: true,
            content_url: `/api/repos/${owner}/${repo}/agent-sessions/${sessionId}/artifacts/${artifactId}/content`
          },
          content: content.content
        });
      }
    );

    router.get("/repos/:owner/:repo/agent-sessions/:sessionId/timeline", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const sessionId = assertString(c.req.param("sessionId"), "sessionId");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const agentSessionService = new AgentSessionService(c.env.DB);
      const session = await agentSessionService.findSessionById(repository.id, sessionId);
      if (!session) {
        throw new HTTPException(404, { message: "Agent session not found" });
      }

      const actionsService = new ActionsService(c.env.DB);
      const linkedRun = session.linked_run_id
        ? await actionsService.findRunById(repository.id, session.linked_run_id)
        : null;
      const [steps, interventions] = await Promise.all([
        agentSessionService.listSteps(repository.id, session.id),
        agentSessionService.listInterventions(repository.id, session.id)
      ]);
      const events = agentSessionService.buildTimeline({
        session,
        run: linkedRun,
        steps,
        interventions
      });

      return c.json({ events });
    });

    router.post("/repos/:owner/:repo/agent-sessions/:sessionId/cancel", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const sessionId = assertString(c.req.param("sessionId"), "sessionId");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = mustSessionUser(c);
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        userId: sessionUser.id
      });
      const canManageActions = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
      if (!canManageActions) {
        throw new HTTPException(403, { message: "Forbidden" });
      }

      const agentSessionService = new AgentSessionService(c.env.DB);
      const session = await agentSessionService.findSessionById(repository.id, sessionId);
      if (!session) {
        throw new HTTPException(404, { message: "Agent session not found" });
      }
      if (session.status !== "queued") {
        throw new HTTPException(409, { message: "Only queued agent sessions can be cancelled" });
      }

      const actionsService = new ActionsService(c.env.DB);
      const run = session.linked_run_id
        ? await actionsService.findRunById(repository.id, session.linked_run_id)
        : null;
      if (session.linked_run_id && !run) {
        throw new HTTPException(404, { message: "Linked action run not found" });
      }
      if (run && run.status !== "queued") {
        throw new HTTPException(409, { message: "Only queued action runs can be cancelled" });
      }

      if (run) {
        const cancelResult = await actionsService.cancelQueuedRun(repository.id, run.id);
        if (!cancelResult.cancelled) {
          throw new HTTPException(409, { message: "Action run is no longer queued" });
        }
        await agentSessionService.recordIntervention({
          repositoryId: repository.id,
          sessionId: session.id,
          kind: "cancel_requested",
          title: "Cancellation requested",
          detail: `Queued session cancelled by ${sessionUser.username}.`,
          createdBy: sessionUser.id,
          payload: {
            runId: run.id,
            status: "cancelled"
          },
          createdAt: cancelResult.completedAt
        });
      } else {
        await agentSessionService.cancelSession({
          repositoryId: repository.id,
          sessionId: session.id,
          cancelledBy: sessionUser.id
        });
      }

      const updatedSession = await agentSessionService.findSessionById(repository.id, session.id);
      const nextRun = run ? await actionsService.findRunById(repository.id, run.id) : null;
      return c.json({ session: updatedSession, run: nextRun });
    });
}
