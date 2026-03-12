import {
  AgentSessionService,
  HTTPException,
  RepositoryService,
  mustSessionUser,
  optionalSession,
  requireSession,
  scheduleActionRunExecution
} from "./deps";

import {
  ACTION_RUN_LOG_STREAM_HEARTBEAT_INTERVAL_MS,
  ACTION_RUN_LOG_STREAM_MAX_DURATION_MS,
  ACTION_RUN_LOG_STREAM_POLL_INTERVAL_MS,
  TERMINAL_ACTION_RUN_STATUSES,
  assertAgentSessionSourceType,
  assertPositiveInteger,
  assertString,
  buildAgentSessionDetailPayload,
  buildSessionLogStreamEvents,
  createActionLogStorageService,
  createSseEventChunk,
  delay,
  executionCtxArg,
  findReadableRepositoryOr404,
  hydrateSessionWithFullLogs,
  parseActionRunCommentIds,
  parseActionRunSourceNumbers,
  parseLimit,
  withAgentSessionApiMetadata,
  type ApiRouter,
  type SseEventPayload
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
    return c.json({
      sessions: sessions.map((session) => withAgentSessionApiMetadata(owner, repo, session))
    });
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
        session: sessionBySourceNumber.get(sourceNumber)
          ? withAgentSessionApiMetadata(
              owner,
              repo,
              sessionBySourceNumber.get(sourceNumber) as (typeof latestSessions)[number]
            )
          : null
      }))
    });
  });

  router.get(
    "/repos/:owner/:repo/agent-sessions/latest-by-comments",
    optionalSession,
    async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const commentIds = parseActionRunCommentIds(c.req.query("commentIds"));
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const agentSessionService = new AgentSessionService(c.env.DB);
      const latestSessions = await agentSessionService.listLatestSessionsByCommentIds(
        repository.id,
        commentIds
      );
      const sessionByCommentId = new Map<string, (typeof latestSessions)[number]>();
      for (const session of latestSessions) {
        if (session.source_comment_id) {
          sessionByCommentId.set(session.source_comment_id, session);
        }
      }

      return c.json({
        items: commentIds.map((commentId) => ({
          commentId,
          session: sessionByCommentId.get(commentId)
            ? withAgentSessionApiMetadata(
                owner,
                repo,
                sessionByCommentId.get(commentId) as (typeof latestSessions)[number]
              )
            : null
        }))
      });
    }
  );

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

  router.get(
    "/repos/:owner/:repo/agent-sessions/:sessionId/logs",
    optionalSession,
    async (c) => {
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

      return c.json({
        logs: (await agentSessionService.readSessionLogs(repository.id, session.id)) ?? session.logs
      });
    }
  );

  router.get(
    "/repos/:owner/:repo/agent-sessions/:sessionId/logs/stream",
    optionalSession,
    async (c) => {
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
      const logStorage = createActionLogStorageService(c.env);
      const existingSession = await agentSessionService.findSessionById(repository.id, sessionId);
      if (!existingSession) {
        throw new HTTPException(404, { message: "Agent session not found" });
      }

      const encoder = new TextEncoder();
      const cancelController = new AbortController();
      const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          let closed = false;
          const enqueue = (payload: SseEventPayload): boolean => {
            if (closed || cancelController.signal.aborted) {
              return false;
            }
            try {
              controller.enqueue(encoder.encode(createSseEventChunk(payload)));
              return true;
            } catch {
              closed = true;
              cancelController.abort();
              return false;
            }
          };
          const closeController = () => {
            if (closed) {
              return;
            }
            closed = true;
            try {
              controller.close();
            } catch {
              // Ignore close failures after disconnects.
            }
          };

          let currentSession = await hydrateSessionWithFullLogs({
            logStorage,
            repositoryId: repository.id,
            run: existingSession
          });
          let previousSession: typeof currentSession | null = null;
          const deadline = Date.now() + ACTION_RUN_LOG_STREAM_MAX_DURATION_MS;
          let lastHeartbeatAt = 0;

          if (!closed) {
            try {
              controller.enqueue(encoder.encode("retry: 1000\n\n"));
            } catch {
              closed = true;
              cancelController.abort();
            }
          }

          try {
            while (true) {
              if (cancelController.signal.aborted) {
                break;
              }
              currentSession = await hydrateSessionWithFullLogs({
                logStorage,
                repositoryId: repository.id,
                run: currentSession
              });

              for (const payload of buildSessionLogStreamEvents(previousSession, currentSession)) {
                if (!enqueue(payload)) {
                  break;
                }
              }
              if (cancelController.signal.aborted || closed) {
                break;
              }
              previousSession = currentSession;

              if (TERMINAL_ACTION_RUN_STATUSES.has(currentSession.status)) {
                enqueue({
                  event: "done",
                  data: {
                    sessionId: currentSession.id,
                    status: currentSession.status,
                    exitCode: currentSession.exit_code,
                    completedAt: currentSession.completed_at,
                    updatedAt: currentSession.updated_at
                  }
                });
                break;
              }

              const now = Date.now();
              if (now >= deadline) {
                break;
              }

              if (now - lastHeartbeatAt >= ACTION_RUN_LOG_STREAM_HEARTBEAT_INTERVAL_MS) {
                enqueue({
                  event: "heartbeat",
                  data: {
                    timestamp: now
                  }
                });
                lastHeartbeatAt = now;
              }

              await delay(ACTION_RUN_LOG_STREAM_POLL_INTERVAL_MS, cancelController.signal);
              if (cancelController.signal.aborted) {
                break;
              }

              const nextSession = await agentSessionService.findSessionById(repository.id, sessionId);
              if (!nextSession) {
                enqueue({
                  event: "stream-error",
                  data: {
                    message: "Agent session not found"
                  }
                });
                break;
              }
              currentSession = await hydrateSessionWithFullLogs({
                logStorage,
                repositoryId: repository.id,
                run: nextSession
              });
            }
          } catch (error) {
            if (!cancelController.signal.aborted) {
              enqueue({
                event: "stream-error",
                data: {
                  message: error instanceof Error ? error.message : "Unknown stream error"
                }
              });
            }
          } finally {
            closeController();
          }
        },
        cancel: () => {
          cancelController.abort();
        }
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-content-type-options": "nosniff"
        }
      });
    }
  );

  router.get(
    "/repos/:owner/:repo/agent-sessions/:sessionId/artifacts",
    optionalSession,
    async (c) => {
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
    }
  );

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

  router.get(
    "/repos/:owner/:repo/agent-sessions/:sessionId/timeline",
    optionalSession,
    async (c) => {
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

      const [steps, interventions] = await Promise.all([
        agentSessionService.listSteps(repository.id, session.id),
        agentSessionService.listInterventions(repository.id, session.id)
      ]);
      const events = agentSessionService.buildTimeline({
        session,
        steps,
        interventions
      });

      return c.json({ events });
    }
  );

  router.post(
    "/repos/:owner/:repo/agent-sessions/:sessionId/cancel",
    requireSession,
    async (c) => {
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
      const canManageActions = await repositoryService.isOwnerOrCollaborator(
        repository,
        sessionUser.id
      );
      if (!canManageActions) {
        throw new HTTPException(403, { message: "Forbidden" });
      }

      const agentSessionService = new AgentSessionService(c.env.DB);
      const session = await agentSessionService.findSessionById(repository.id, sessionId);
      if (!session) {
        throw new HTTPException(404, { message: "Agent session not found" });
      }
      if (session.status !== "queued") {
        throw new HTTPException(409, {
          message: "Only queued agent sessions can be cancelled"
        });
      }

      const cancelResult = await agentSessionService.cancelQueuedSession({
        repositoryId: repository.id,
        sessionId: session.id,
        cancelledBy: sessionUser.id
      });
      if (!cancelResult.cancelled) {
        throw new HTTPException(409, { message: "Agent session is no longer queued" });
      }

      const updatedSession = await agentSessionService.findSessionById(repository.id, session.id);
      return c.json({
        session: updatedSession
          ? withAgentSessionApiMetadata(owner, repo, updatedSession)
          : null
      });
    }
  );

  router.post(
    "/repos/:owner/:repo/agent-sessions/:sessionId/rerun",
    requireSession,
    async (c) => {
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
      const canManageActions = await repositoryService.isOwnerOrCollaborator(
        repository,
        sessionUser.id
      );
      if (!canManageActions) {
        throw new HTTPException(403, { message: "Forbidden" });
      }

      const agentSessionService = new AgentSessionService(c.env.DB);
      const sourceSession = await agentSessionService.findSessionById(repository.id, sessionId);
      if (!sourceSession) {
        throw new HTTPException(404, { message: "Agent session not found" });
      }

      const session = await agentSessionService.createSessionExecution({
        repositoryId: repository.id,
        sourceType: sourceSession.source_type,
        sourceNumber: sourceSession.source_number,
        sourceCommentId: sourceSession.source_comment_id,
        origin: "rerun",
        agentType: sourceSession.agent_type,
        instanceType: sourceSession.instance_type,
        prompt: sourceSession.prompt,
        triggerRef: sourceSession.trigger_ref ?? null,
        triggerSha: sourceSession.trigger_sha ?? null,
        workflowId: sourceSession.workflow_id ?? null,
        parentSessionId: sourceSession.id,
        createdBy: sessionUser.id,
        delegatedFromUserId:
          sourceSession.delegated_from_user_id ?? sourceSession.created_by ?? sessionUser.id
      });

      await scheduleActionRunExecution({
        env: c.env,
        ...executionCtxArg(c),
        repository,
        session,
        triggeredByUser: sessionUser,
        requestOrigin: new URL(c.req.url).origin
      });

      return c.json(
        {
          session: withAgentSessionApiMetadata(owner, repo, session)
        },
        202
      );
    }
  );
}
