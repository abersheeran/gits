import {
  ActionsService,
  HTTPException,
  RepositoryService,
  createLinkedAgentSessionForRun,
  mustSessionUser,
  optionalSession,
  requireSession,
  scheduleActionRunExecution,
  type ActionRunRecord
} from "./deps";

import {
  ACTION_RUN_LOG_STREAM_HEARTBEAT_INTERVAL_MS,
  ACTION_RUN_LOG_STREAM_MAX_DURATION_MS,
  ACTION_RUN_LOG_STREAM_POLL_INTERVAL_MS,
  TERMINAL_ACTION_RUN_STATUSES,
  assertActionRunSourceType,
  assertString,
  buildRunLogStreamEvents,
  createActionLogStorageService,
  createSseEventChunk,
  delay,
  executionCtxArg,
  findReadableRepositoryOr404,
  hydrateRunWithFullLogs,
  parseActionRunCommentIds,
  parseActionRunSourceNumbers,
  parseLimit,
  withActionRunApiMetadata,
  type ApiRouter,
  type SseEventPayload
} from "./shared";

export function registerActionsRunRoutes(router: ApiRouter): void {
    router.get("/repos/:owner/:repo/actions/runs", optionalSession, async (c) => {
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

      const actionsService = new ActionsService(c.env.DB);
      const runs = await actionsService.listRuns(repository.id, parseLimit(c.req.query("limit"), 30));
      return c.json({
        runs: runs.map((run) => withActionRunApiMetadata(owner, repo, run))
      });
    });

    router.get("/repos/:owner/:repo/actions/runs/latest", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const sourceType = assertActionRunSourceType(c.req.query("sourceType"));
      const sourceNumbers = parseActionRunSourceNumbers(c.req.query("numbers"));
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const actionsService = new ActionsService(c.env.DB);
      const latestRuns = await actionsService.listLatestRunsBySource(
        repository.id,
        sourceType,
        sourceNumbers
      );
      const runBySourceNumber = new Map<number, (typeof latestRuns)[number]>();
      for (const run of latestRuns) {
        if (run.trigger_source_number !== null) {
          runBySourceNumber.set(run.trigger_source_number, run);
        }
      }

      return c.json({
        sourceType,
        items: sourceNumbers.map((sourceNumber) => ({
          sourceNumber,
          run: runBySourceNumber.get(sourceNumber)
            ? withActionRunApiMetadata(owner, repo, runBySourceNumber.get(sourceNumber) as ActionRunRecord)
            : null
        }))
      });
    });

    router.get("/repos/:owner/:repo/actions/runs/latest-by-comments", optionalSession, async (c) => {
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

      const actionsService = new ActionsService(c.env.DB);
      const latestRuns = await actionsService.listLatestRunsByCommentIds(repository.id, commentIds);
      const runByCommentId = new Map<string, (typeof latestRuns)[number]>();
      for (const run of latestRuns) {
        if (run.trigger_source_comment_id) {
          runByCommentId.set(run.trigger_source_comment_id, run);
        }
      }

      return c.json({
        items: commentIds.map((commentId) => ({
          commentId,
          run: runByCommentId.get(commentId)
            ? withActionRunApiMetadata(owner, repo, runByCommentId.get(commentId) as ActionRunRecord)
            : null
        }))
      });
    });

    router.get("/repos/:owner/:repo/actions/runs/:runId/logs", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const runId = assertString(c.req.param("runId"), "runId");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const actionsService = new ActionsService(c.env.DB);
      const run = await actionsService.findRunById(repository.id, runId);
      if (!run) {
        throw new HTTPException(404, { message: "Action run not found" });
      }

      const logStorage = createActionLogStorageService(c.env);
      const fullLogs = await logStorage.readRunLogs(repository.id, run.id);
      return c.json({
        logs: fullLogs ?? run.logs
      });
    });

    router.get("/repos/:owner/:repo/actions/runs/:runId", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const runId = assertString(c.req.param("runId"), "runId");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const actionsService = new ActionsService(c.env.DB);
      const run = await actionsService.findRunById(repository.id, runId);
      if (!run) {
        throw new HTTPException(404, { message: "Action run not found" });
      }
      return c.json({
        run: withActionRunApiMetadata(owner, repo, run)
      });
    });

    router.get("/repos/:owner/:repo/actions/runs/:runId/logs/stream", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const runId = assertString(c.req.param("runId"), "runId");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const actionsService = new ActionsService(c.env.DB);
      const logStorage = createActionLogStorageService(c.env);
      const existingRun = await actionsService.findRunById(repository.id, runId);
      if (!existingRun) {
        throw new HTTPException(404, { message: "Action run not found" });
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

          let currentRun = await hydrateRunWithFullLogs({
            logStorage,
            repositoryId: repository.id,
            run: existingRun
          });
          let previousRun: ActionRunRecord | null = null;
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
              currentRun = await hydrateRunWithFullLogs({
                logStorage,
                repositoryId: repository.id,
                run: currentRun
              });

              for (const payload of buildRunLogStreamEvents(previousRun, currentRun)) {
                if (!enqueue(payload)) {
                  break;
                }
              }
              if (cancelController.signal.aborted || closed) {
                break;
              }
              previousRun = currentRun;

              if (TERMINAL_ACTION_RUN_STATUSES.has(currentRun.status)) {
                enqueue({
                  event: "done",
                  data: {
                    runId: currentRun.id,
                    status: currentRun.status,
                    exitCode: currentRun.exit_code,
                    completedAt: currentRun.completed_at,
                    updatedAt: currentRun.updated_at
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

              const nextRun = await actionsService.findRunById(repository.id, runId);
              if (!nextRun) {
                enqueue({
                  event: "stream-error",
                  data: {
                    message: "Action run not found"
                  }
                });
                break;
              }
              currentRun = await hydrateRunWithFullLogs({
                logStorage,
                repositoryId: repository.id,
                run: nextRun
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
    });

    router.post("/repos/:owner/:repo/actions/runs/:runId/rerun", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const runId = assertString(c.req.param("runId"), "runId");
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

      const actionsService = new ActionsService(c.env.DB);
      const sourceRun = await actionsService.findRunById(repository.id, runId);
      if (!sourceRun) {
        throw new HTTPException(404, { message: "Action run not found" });
      }

      const run = await actionsService.createRun({
        repositoryId: repository.id,
        workflowId: sourceRun.workflow_id,
        triggerEvent: sourceRun.trigger_event,
        ...(sourceRun.trigger_ref ? { triggerRef: sourceRun.trigger_ref } : {}),
        ...(sourceRun.trigger_sha ? { triggerSha: sourceRun.trigger_sha } : {}),
        ...(sourceRun.trigger_source_type ? { triggerSourceType: sourceRun.trigger_source_type } : {}),
        ...(sourceRun.trigger_source_number !== null
          ? { triggerSourceNumber: sourceRun.trigger_source_number }
          : {}),
        ...(sourceRun.trigger_source_comment_id
          ? { triggerSourceCommentId: sourceRun.trigger_source_comment_id }
          : {}),
        triggeredBy: sessionUser.id,
        agentType: sourceRun.agent_type,
        instanceType: sourceRun.instance_type ?? "lite",
        prompt: sourceRun.prompt
      });
      const session = await createLinkedAgentSessionForRun({
        db: c.env.DB,
        repositoryId: repository.id,
        run,
        origin: "rerun",
        createdBy: sessionUser.id,
        delegatedFromUserId: sourceRun.triggered_by ?? sessionUser.id
      });

      await scheduleActionRunExecution({
        env: c.env,
        ...executionCtxArg(c),
        repository,
        run,
        triggeredByUser: sessionUser,
        requestOrigin: new URL(c.req.url).origin
      });

      return c.json({ run, session }, 202);
    });
}
