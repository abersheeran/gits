import {
  ActionsService,
  HTTPException,
  RepositoryService,
  createLinkedAgentSessionForRun,
  mustSessionUser,
  optionalSession,
  requireSession,
  scheduleActionRunExecution
} from "./deps";

import {
  assertActionAgentType,
  assertActionWorkflowTrigger,
  assertOptionalBoolean,
  assertOptionalRegexPattern,
  assertOptionalString,
  assertString,
  executionCtxArg,
  findReadableRepositoryOr404,
  isUniqueConstraintError,
  parseJsonObject,
  type ApiRouter,
  type CreateActionWorkflowInput,
  type DispatchActionWorkflowInput,
  type UpdateActionWorkflowInput
} from "./shared";

export function registerActionsWorkflowRoutes(router: ApiRouter): void {
    router.get("/repos/:owner/:repo/actions/workflows", optionalSession, async (c) => {
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
      const workflows = (await actionsService.listWorkflows(repository.id)).filter(
        (workflow) => !workflow.name.startsWith("__")
      );
      return c.json({ workflows });
    });

    router.post("/repos/:owner/:repo/actions/workflows", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const payload = await parseJsonObject(c.req.raw);
      const input: CreateActionWorkflowInput = {
        name: assertString(payload.name, "name"),
        triggerEvent: assertActionWorkflowTrigger(payload.triggerEvent, "triggerEvent"),
        agentType: assertActionAgentType(payload.agentType, "agentType"),
        prompt: assertString(payload.prompt, "prompt")
      };
      if (payload.pushBranchRegex !== undefined) {
        input.pushBranchRegex = assertOptionalRegexPattern(payload.pushBranchRegex, "pushBranchRegex") ?? null;
      }
      if (payload.pushTagRegex !== undefined) {
        input.pushTagRegex = assertOptionalRegexPattern(payload.pushTagRegex, "pushTagRegex") ?? null;
      }
      if (payload.enabled !== undefined) {
        const enabled = assertOptionalBoolean(payload.enabled, "enabled");
        if (enabled === undefined) {
          throw new HTTPException(400, { message: "Field 'enabled' is required" });
        }
        input.enabled = enabled;
      }

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
      try {
        const workflow = await actionsService.createWorkflow({
          repositoryId: repository.id,
          name: input.name,
          triggerEvent: input.triggerEvent,
          agentType: input.agentType,
          prompt: input.prompt,
          pushBranchRegex: input.pushBranchRegex ?? null,
          pushTagRegex: input.pushTagRegex ?? null,
          enabled: input.enabled ?? true,
          createdBy: sessionUser.id
        });
        return c.json({ workflow }, 201);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new HTTPException(409, { message: "Workflow with same name already exists" });
        }
        throw error;
      }
    });

    router.patch("/repos/:owner/:repo/actions/workflows/:workflowId", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const workflowId = assertString(c.req.param("workflowId"), "workflowId");
      const payload = await parseJsonObject(c.req.raw);
      const patch: UpdateActionWorkflowInput = {};
      if (payload.name !== undefined) {
        patch.name = assertString(payload.name, "name");
      }
      if (payload.triggerEvent !== undefined) {
        patch.triggerEvent = assertActionWorkflowTrigger(payload.triggerEvent, "triggerEvent");
      }
      if (payload.agentType !== undefined) {
        patch.agentType = assertActionAgentType(payload.agentType, "agentType");
      }
      if (payload.prompt !== undefined) {
        patch.prompt = assertString(payload.prompt, "prompt");
      }
      if (payload.pushBranchRegex !== undefined) {
        patch.pushBranchRegex = assertOptionalRegexPattern(payload.pushBranchRegex, "pushBranchRegex") ?? null;
      }
      if (payload.pushTagRegex !== undefined) {
        patch.pushTagRegex = assertOptionalRegexPattern(payload.pushTagRegex, "pushTagRegex") ?? null;
      }
      if (payload.enabled !== undefined) {
        const enabled = assertOptionalBoolean(payload.enabled, "enabled");
        if (enabled === undefined) {
          throw new HTTPException(400, { message: "Field 'enabled' is required" });
        }
        patch.enabled = enabled;
      }
      if (
        patch.name === undefined &&
        patch.triggerEvent === undefined &&
        patch.agentType === undefined &&
        patch.prompt === undefined &&
        patch.pushBranchRegex === undefined &&
        patch.pushTagRegex === undefined &&
        patch.enabled === undefined
      ) {
        throw new HTTPException(400, { message: "No updatable fields provided" });
      }

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
      try {
        const workflow = await actionsService.updateWorkflow(repository.id, workflowId, patch);
        if (!workflow) {
          throw new HTTPException(404, { message: "Workflow not found" });
        }
        return c.json({ workflow });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new HTTPException(409, { message: "Workflow with same name already exists" });
        }
        throw error;
      }
    });

    router.post("/repos/:owner/:repo/actions/workflows/:workflowId/dispatch", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const workflowId = assertString(c.req.param("workflowId"), "workflowId");
      const payload = await parseJsonObject(c.req.raw);
      const input: DispatchActionWorkflowInput = {};
      if (payload.ref !== undefined) {
        const ref = assertOptionalString(payload.ref, "ref");
        if (ref) {
          input.ref = ref;
        }
      }
      if (payload.sha !== undefined) {
        const sha = assertOptionalString(payload.sha, "sha");
        if (sha) {
          input.sha = sha;
        }
      }

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
      const workflow = await actionsService.findWorkflowById(repository.id, workflowId);
      if (!workflow) {
        throw new HTTPException(404, { message: "Workflow not found" });
      }
      if (workflow.enabled !== 1) {
        throw new HTTPException(409, { message: "Workflow is disabled" });
      }
      const repositoryConfig = await actionsService.getRepositoryConfig(repository.id);

      const run = await actionsService.createRun({
        repositoryId: repository.id,
        workflowId: workflow.id,
        triggerEvent: workflow.trigger_event,
        ...(input.ref ? { triggerRef: input.ref } : {}),
        ...(input.sha ? { triggerSha: input.sha } : {}),
        triggeredBy: sessionUser.id,
        agentType: workflow.agent_type,
        instanceType: repositoryConfig.instanceType,
        prompt: workflow.prompt
      });
      const session = await createLinkedAgentSessionForRun({
        db: c.env.DB,
        repositoryId: repository.id,
        run,
        origin: "dispatch",
        createdBy: sessionUser.id,
        delegatedFromUserId: sessionUser.id
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
