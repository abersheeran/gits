import {
  HTTPException,
  RepositoryMetadataService,
  RepositoryService,
  mustSessionUser,
  optionalSession,
  requireSession
} from "./deps";

import {
  assertMilestoneState,
  assertOptionalHexColor,
  assertOptionalNullablePositiveInteger,
  assertOptionalNullableString,
  assertReactionContent,
  assertReactionSubjectExists,
  assertReactionSubjectType,
  assertString,
  findReadableRepositoryOr404,
  isUniqueConstraintError,
  listRepositoryParticipants,
  parseJsonObject,
  type ApiRouter,
  type CreateRepositoryLabelInput,
  type CreateRepositoryMilestoneInput,
  type UpdateRepositoryLabelInput,
  type UpdateRepositoryMilestoneInput
} from "./shared";

export function registerRepositoryMetadataRoutes(router: ApiRouter): void {
  router.get("/repos/:owner/:repo/participants", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const participants = await listRepositoryParticipants(repositoryService, repository);
    return c.json({ participants });
  });

  router.get("/repos/:owner/:repo/labels", optionalSession, async (c) => {
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
    const metadataService = new RepositoryMetadataService(c.env.DB);
    const labels = await metadataService.listLabels(repository.id);
    return c.json({ labels });
  });

  router.post("/repos/:owner/:repo/labels", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const input: CreateRepositoryLabelInput = {
      name: assertString(payload.name, "name"),
      color: assertOptionalHexColor(payload.color, "color") ?? ""
    };
    if (!input.color) {
      throw new HTTPException(400, { message: "Field 'color' is required" });
    }
    if (payload.description !== undefined) {
      input.description = assertOptionalNullableString(payload.description, "description") ?? null;
    }

    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
    if (!canWrite) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const metadataService = new RepositoryMetadataService(c.env.DB);
    try {
      const label = await metadataService.createLabel({
        repositoryId: repository.id,
        name: input.name,
        color: input.color,
        description: input.description ?? null
      });
      return c.json({ label }, 201);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HTTPException(409, { message: "Label with same name already exists" });
      }
      throw error;
    }
  });

  router.patch("/repos/:owner/:repo/labels/:labelId", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const labelId = assertString(c.req.param("labelId"), "labelId");
    const payload = await parseJsonObject(c.req.raw);
    const patch: UpdateRepositoryLabelInput = {};
    if (payload.name !== undefined) {
      patch.name = assertString(payload.name, "name");
    }
    if (payload.color !== undefined) {
      const color = assertOptionalHexColor(payload.color, "color");
      if (!color) {
        throw new HTTPException(400, { message: "Field 'color' is required" });
      }
      patch.color = color;
    }
    if (payload.description !== undefined) {
      patch.description = assertOptionalNullableString(payload.description, "description") ?? null;
    }
    if (patch.name === undefined && patch.color === undefined && patch.description === undefined) {
      throw new HTTPException(400, { message: "No updatable fields provided" });
    }

    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
    if (!canWrite) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const metadataService = new RepositoryMetadataService(c.env.DB);
    try {
      const label = await metadataService.updateLabel(repository.id, labelId, patch);
      if (!label) {
        throw new HTTPException(404, { message: "Label not found" });
      }
      return c.json({ label });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HTTPException(409, { message: "Label with same name already exists" });
      }
      throw error;
    }
  });

  router.delete("/repos/:owner/:repo/labels/:labelId", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const labelId = assertString(c.req.param("labelId"), "labelId");
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
    if (!canWrite) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const metadataService = new RepositoryMetadataService(c.env.DB);
    const label = await metadataService.findLabelById(repository.id, labelId);
    if (!label) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    await metadataService.deleteLabel(repository.id, labelId);
    return c.json({ ok: true });
  });

  router.get("/repos/:owner/:repo/milestones", optionalSession, async (c) => {
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
    const metadataService = new RepositoryMetadataService(c.env.DB);
    const milestones = await metadataService.listMilestones(repository.id);
    return c.json({ milestones });
  });

  router.post("/repos/:owner/:repo/milestones", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const input: CreateRepositoryMilestoneInput = {
      title: assertString(payload.title, "title")
    };
    if (payload.description !== undefined) {
      input.description = assertOptionalNullableString(payload.description, "description") ?? "";
    }
    if (payload.dueAt !== undefined) {
      const dueAt = assertOptionalNullablePositiveInteger(payload.dueAt, "dueAt");
      if (dueAt !== undefined) {
        input.dueAt = dueAt;
      }
    }

    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
    if (!canWrite) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const metadataService = new RepositoryMetadataService(c.env.DB);
    const milestone = await metadataService.createMilestone({
      repositoryId: repository.id,
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {})
    });
    return c.json({ milestone }, 201);
  });

  router.patch("/repos/:owner/:repo/milestones/:milestoneId", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const milestoneId = assertString(c.req.param("milestoneId"), "milestoneId");
    const payload = await parseJsonObject(c.req.raw);
    const patch: UpdateRepositoryMilestoneInput = {};
    if (payload.title !== undefined) {
      patch.title = assertString(payload.title, "title");
    }
    if (payload.description !== undefined) {
      patch.description = assertOptionalNullableString(payload.description, "description") ?? "";
    }
    if (payload.dueAt !== undefined) {
      const dueAt = assertOptionalNullablePositiveInteger(payload.dueAt, "dueAt");
      if (dueAt !== undefined) {
        patch.dueAt = dueAt;
      }
    }
    if (payload.state !== undefined) {
      patch.state = assertMilestoneState(payload.state);
    }
    if (
      patch.title === undefined &&
      patch.description === undefined &&
      patch.dueAt === undefined &&
      patch.state === undefined
    ) {
      throw new HTTPException(400, { message: "No updatable fields provided" });
    }

    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
    if (!canWrite) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const metadataService = new RepositoryMetadataService(c.env.DB);
    const milestone = await metadataService.updateMilestone(repository.id, milestoneId, patch);
    if (!milestone) {
      throw new HTTPException(404, { message: "Milestone not found" });
    }
    return c.json({ milestone });
  });

  router.delete("/repos/:owner/:repo/milestones/:milestoneId", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const milestoneId = assertString(c.req.param("milestoneId"), "milestoneId");
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const canWrite = await repositoryService.canWriteRepository(repository, sessionUser.id);
    if (!canWrite) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const metadataService = new RepositoryMetadataService(c.env.DB);
    const milestone = await metadataService.findMilestoneById(repository.id, milestoneId);
    if (!milestone) {
      throw new HTTPException(404, { message: "Milestone not found" });
    }
    await metadataService.deleteMilestone(repository.id, milestoneId);
    return c.json({ ok: true });
  });

  router.put("/repos/:owner/:repo/reactions", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const subjectType = assertReactionSubjectType(payload.subjectType);
    const subjectId = assertString(payload.subjectId, "subjectId");
    const content = assertReactionContent(payload.content);
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    await assertReactionSubjectExists({
      db: c.env.DB,
      repositoryId: repository.id,
      subjectType,
      subjectId
    });
    const metadataService = new RepositoryMetadataService(c.env.DB);
    await metadataService.addReaction({
      repositoryId: repository.id,
      subjectType,
      subjectId,
      userId: sessionUser.id,
      content
    });
    const reactions = await metadataService.summarizeReactions(
      repository.id,
      subjectType,
      [subjectId],
      sessionUser.id
    );
    return c.json({ reactions: reactions[subjectId] ?? [] });
  });

  router.delete("/repos/:owner/:repo/reactions", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const subjectType = assertReactionSubjectType(payload.subjectType);
    const subjectId = assertString(payload.subjectId, "subjectId");
    const content = assertReactionContent(payload.content);
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    await assertReactionSubjectExists({
      db: c.env.DB,
      repositoryId: repository.id,
      subjectType,
      subjectId
    });
    const metadataService = new RepositoryMetadataService(c.env.DB);
    await metadataService.removeReaction({
      repositoryId: repository.id,
      subjectType,
      subjectId,
      userId: sessionUser.id,
      content
    });
    const reactions = await metadataService.summarizeReactions(
      repository.id,
      subjectType,
      [subjectId],
      sessionUser.id
    );
    return c.json({ reactions: reactions[subjectId] ?? [] });
  });
}
