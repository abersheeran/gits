import {
  HTTPException,
  RepositoryMetadataService,
  RepositoryService,
  mustSessionUser,
  requireSession
} from "./deps";

import {
  assertReactionContent,
  assertReactionSubjectExists,
  assertReactionSubjectType,
  assertString,
  findReadableRepositoryOr404,
  listRepositoryParticipants,
  parseJsonObject,
  type ApiRouter
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
